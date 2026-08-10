jest.mock("wx-server-sdk")

function createMockDb({ currentData, updateResult }) {
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = jest.fn().mockResolvedValue(updateResult)
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const dayRemove = jest.fn().mockResolvedValue({ stats: { removed: 1 } })
  const blockUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })

  const bookingsDoc = jest.fn(() => ({
    get: currentGet
  }))
  const bookingsWhere = jest.fn(() => ({ update }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "bookings") {
        return {
          doc: bookingsDoc,
          where: bookingsWhere
        }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      if (name === "vehicle_calendar_days") {
        return {
          where: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ data: [{ _id: "day_1", bookingId: "booking_1" }] }) })) })),
          doc: jest.fn(() => ({ remove: dayRemove }))
        }
      }
      if (name === "vehicle_availability_blocks") {
        return { doc: jest.fn(() => ({ update: blockUpdate })) }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate,
    runTransaction: jest.fn((callback) => callback(db))
  }

  return {
    db,
    bookingsDoc,
    bookingsWhere,
    currentGet,
    update,
    auditAdd,
    serverDateValue,
    dayRemove,
    blockUpdate
  }
}

async function loadBookingCancelWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingCancel/index")
  })

  return mod
}

describe("cloudfunctions/bookingCancel integration", () => {
  test("用户可取消自己的 pending 预约", async () => {
    const mocks = createMockDb({
      currentData: {
        _id: "booking_1",
        openid: "user_openid",
        status: "pending"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const bookingCancel = await loadBookingCancelWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await bookingCancel.main({ id: "booking_1" })

    expect(res).toEqual({
      ok: true,
      id: "booking_1",
      status: "cancelled",
      message: "预约已取消"
    })
    expect(mocks.bookingsDoc).toHaveBeenCalledWith("booking_1")
    expect(mocks.bookingsWhere).toHaveBeenCalledWith({
      _id: "booking_1",
      openid: "user_openid",
      status: "pending"
    })
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        status: "cancelled",
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        action: "bookingCancel",
        bookingId: "booking_1",
        vehicleId: "",
        fromStatus: "pending",
        toStatus: "cancelled",
        createdAt: mocks.serverDateValue
      }
    })
  })

  test("completed 预约不可取消", async () => {
    const mocks = createMockDb({
      currentData: {
        _id: "booking_1",
        openid: "user_openid",
        status: "completed"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const bookingCancel = await loadBookingCancelWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await bookingCancel.main({ id: "booking_1" })

    expect(res.ok).toBe(false)
    expect(res.code).toBe("STATUS_NOT_ALLOWED")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("取消已确认预约时同步释放按日占用", async () => {
    const mocks = createMockDb({
      currentData: { _id: "booking_1", openid: "user_openid", vehicleId: "vehicle_1", status: "confirmed" },
      updateResult: { stats: { updated: 1 } }
    })
    const bookingCancel = await loadBookingCancelWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await bookingCancel.main({ id: "booking_1" })
    expect(res.ok).toBe(true)
    expect(mocks.dayRemove).toHaveBeenCalledTimes(1)
    expect(mocks.blockUpdate).toHaveBeenCalledWith({ data: expect.objectContaining({ status: "released", releaseReason: "用户取消已确认预约" }) })
  })

  test("不能取消别人的预约", async () => {
    const mocks = createMockDb({
      currentData: {
        _id: "booking_1",
        openid: "other_openid",
        status: "pending"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const bookingCancel = await loadBookingCancelWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await bookingCancel.main({ id: "booking_1" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "只能取消自己的预约"
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("后台并发更新状态后取消请求不会覆盖新状态", async () => {
    const mocks = createMockDb({
      currentData: {
        _id: "booking_1",
        openid: "user_openid",
        status: "contacted"
      },
      updateResult: { stats: { updated: 0 } }
    })

    const bookingCancel = await loadBookingCancelWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await bookingCancel.main({ id: "booking_1" })

    expect(res).toEqual({
      ok: false,
      code: "STATUS_CONFLICT",
      message: "预约状态已发生变化，请刷新后重试"
    })
    expect(mocks.bookingsWhere).toHaveBeenCalledWith({
      _id: "booking_1",
      openid: "user_openid",
      status: "contacted"
    })
  })
})
