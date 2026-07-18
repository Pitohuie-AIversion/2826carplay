jest.mock("wx-server-sdk")

function createMockDb({ currentData, updateResult }) {
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = jest.fn().mockResolvedValue(updateResult)
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

  const bookingsDoc = jest.fn(() => ({
    get: currentGet,
    update
  }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "bookings") {
        return { doc: bookingsDoc }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    bookingsDoc,
    currentGet,
    update,
    auditAdd,
    serverDateValue
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
})
