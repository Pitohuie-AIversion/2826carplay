jest.mock("wx-server-sdk")

function loadModule({ openid = "admin_openid", roles = [{ role: "admin" }], booking = null, beforeTransaction }) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })

  const rolesGet = jest.fn().mockResolvedValue({ data: roles })
  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))
  const bookingGet = jest.fn().mockResolvedValue({ data: booking })
  const bookingUpdate = jest.fn(async ({ data }) => { Object.assign(booking, data); return { stats: { updated: 1 } } })
  const bookingsDoc = jest.fn(() => {
    const doc = { get: bookingGet, update: bookingUpdate }
    doc.field = () => doc
    return doc
  })
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const serverDateValue = { __type: "serverDate" }

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return { doc: bookingsDoc }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      if (name === "error_logs") {
        return { add: jest.fn().mockResolvedValue({ _id: "error_1" }) }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate: jest.fn(() => serverDateValue),
    runTransaction: jest.fn(async (callback) => {
      if (beforeTransaction) beforeTransaction(booking)
      return callback({ collection: (name) => ({ doc: db.collection(name).doc }) })
    })
  }
  cloud.__setMockDb(db)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingUpdateCoordination/index")
  })
  return {
    mod,
    rolesWhere,
    bookingUpdate,
    auditAdd,
    serverDateValue
  }
}

describe("cloudfunctions/bookingUpdateCoordination integration", () => {
  test("旧协调页面不覆盖其他字段，旧字段基线也不能覆盖新安排", async () => {
    const booking = { status: "contacted", schedulePriority: "priority", coordinationStatus: "coordinating" }
    const mocks = loadModule({ booking })
    expect(await mocks.mod.main({ id: "booking_1", coordinationStatus: "resolved", expectedValues: { coordinationStatus: "coordinating" } })).toMatchObject({ ok: true })
    expect(booking.schedulePriority).toBe("priority")
    expect(await mocks.mod.main({ id: "booking_1", coordinationStatus: "pending", expectedValues: { coordinationStatus: "coordinating" } })).toMatchObject({ ok: false, code: "VERSION_CONFLICT" })
    expect(booking.coordinationStatus).toBe("resolved")
    expect(mocks.bookingUpdate).toHaveBeenCalledTimes(1)
  })

  test("事务开始前预约结束时不再修改协调字段", async () => {
    const mocks = loadModule({ booking: { status: "confirmed", schedulePriority: "normal" }, beforeTransaction: (booking) => { booking.status = "completed" } })
    expect(await mocks.mod.main({ id: "booking_1", schedulePriority: "priority" })).toMatchObject({ ok: false, code: "BOOKING_NOT_EDITABLE" })
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("标签可显式清空，单独保存标签不会覆盖原协调字段", async () => {
    const mocks = loadModule({ booking: { status: "contacted", schedulePriority: "priority", coordinationStatus: "coordinating", tags: ["高意向"] } })
    expect(await mocks.mod.main({ id: "booking_1", tags: [] })).toMatchObject({ ok: true, tags: [], schedulePriority: "priority", coordinationStatus: "coordinating" })
    const data = mocks.bookingUpdate.mock.calls[0][0].data
    expect(data.tags).toEqual([])
    expect(data).not.toHaveProperty("schedulePriority")
    expect(data).not.toHaveProperty("coordinationStatus")
  })

  test("首次清空自动推导标签也要保存空数组，避免刷新后再次推导", async () => {
    const mocks = loadModule({ booking: { status: "contacted", coordinationStatus: "pending" } })
    expect(await mocks.mod.main({ id: "booking_1", tags: [] })).toMatchObject({ ok: true, changed: true, tags: [] })
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({ data: expect.objectContaining({ tags: [] }) })
  })

  test.each([["未知标签"], ["老客户", "高意向", "需要送车", "长租意向", "车损敏感", "跨城用车"]])("拒绝不受支持或过多标签 %j", async (...tags) => {
    const mocks = loadModule({ booking: { status: "contacted" } })
    expect(await mocks.mod.main({ id: "booking_1", tags })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
  })
  test("预约管理员可更新优先级和协调状态并写入审计日志", async () => {
    const mocks = loadModule({
      openid: "manager_openid",
      roles: [{ role: "booking_manager" }],
      booking: {
        _id: "booking_1",
        status: "contacted",
        schedulePriority: "normal",
        coordinationStatus: "pending"
      }
    })

    const res = await mocks.mod.main({
      id: "booking_1",
      schedulePriority: "standby",
      coordinationStatus: "coordinating"
    })

    expect(res).toEqual({
      ok: true,
      id: "booking_1",
      schedulePriority: "standby",
      coordinationStatus: "coordinating",
      changed: true,
      message: "协调安排已更新"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "manager_openid" })
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      data: {
        schedulePriority: "standby",
        coordinationStatus: "coordinating",
        coordinationUpdatedAt: mocks.serverDateValue,
        coordinationUpdatedBy: "manager_openid",
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "bookingUpdateCoordination",
        bookingId: "booking_1",
        fromPriority: "normal",
        toPriority: "standby",
        fromCoordinationStatus: "pending",
        toCoordinationStatus: "coordinating"
      })
    })
  })

  test("相同安排重复保存不会重复写入", async () => {
    const mocks = loadModule({
      booking: {
        _id: "booking_1",
        status: "pending",
        schedulePriority: "priority",
        coordinationStatus: "resolved"
      }
    })

    const res = await mocks.mod.main({
      id: "booking_1",
      schedulePriority: "priority",
      coordinationStatus: "resolved"
    })

    expect(res.ok).toBe(true)
    expect(res.changed).toBe(false)
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("普通用户、非法枚举和已结束预约不可更新", async () => {
    const forbidden = loadModule({
      openid: "user_openid",
      roles: [{ role: "user" }],
      booking: { _id: "booking_1", status: "pending" }
    })
    expect((await forbidden.mod.main({
      id: "booking_1",
      schedulePriority: "normal",
      coordinationStatus: "pending"
    })).code).toBe("FORBIDDEN")

    const invalid = loadModule({
      booking: { _id: "booking_1", status: "pending" }
    })
    expect((await invalid.mod.main({
      id: "booking_1",
      schedulePriority: "top",
      coordinationStatus: "pending"
    })).code).toBe("VALIDATION_ERROR")
    expect(invalid.bookingUpdate).not.toHaveBeenCalled()

    const completed = loadModule({
      booking: { _id: "booking_1", status: "completed" }
    })
    expect((await completed.mod.main({
      id: "booking_1",
      schedulePriority: "normal",
      coordinationStatus: "resolved"
    })).code).toBe("BOOKING_NOT_EDITABLE")
    expect(completed.bookingUpdate).not.toHaveBeenCalled()
  })
})
