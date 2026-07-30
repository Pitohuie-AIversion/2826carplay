jest.mock("wx-server-sdk")

function createMockDb({ current, updateResult = { stats: { updated: 1 } } }) {
  const bookingGet = jest.fn().mockResolvedValue({ data: current })
  const bookingDoc = jest.fn(() => ({ get: bookingGet }))
  const bookingUpdate = jest.fn().mockResolvedValue(updateResult)
  const bookingWhere = jest.fn(() => ({ update: bookingUpdate }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "bookings") {
        return {
          doc: bookingDoc,
          where: bookingWhere
        }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      if (name === "error_logs") {
        return { add: jest.fn().mockResolvedValue({ _id: "error_1" }) }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    bookingDoc,
    bookingWhere,
    bookingUpdate,
    auditAdd,
    serverDateValue
  }
}

async function loadModule(openid, mockDb) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingUpdateMyContact/index")
  })
  return mod
}

describe("cloudfunctions/bookingUpdateMyContact integration", () => {
  test("用户可修改自己进行中预约的联系信息", async () => {
    const mocks = createMockDb({
      current: {
        _id: "booking_1",
        openid: "user_openid",
        status: "pending",
        userName: "张三",
        phone: "13800000000",
        city: "杭州",
        note: ""
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      id: "booking_1",
      userName: "张三",
      phone: "13900000000",
      city: "杭州",
      note: "下午联系"
    })

    expect(res).toEqual({
      ok: true,
      id: "booking_1",
      status: "pending",
      updated: true,
      changedKeys: ["phone", "note"],
      message: "联系信息已更新"
    })
    expect(mocks.bookingWhere).toHaveBeenCalledWith({
      _id: "booking_1",
      openid: "user_openid",
      status: "pending"
    })
    expect(mocks.bookingUpdate).toHaveBeenCalledWith({
      data: {
        userName: "张三",
        phone: "13900000000",
        city: "杭州",
        note: "下午联系",
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        action: "bookingUpdateMyContact",
        bookingId: "booking_1",
        changedKeys: ["phone", "note"],
        createdAt: mocks.serverDateValue
      }
    })
    expect(JSON.stringify(mocks.auditAdd.mock.calls)).not.toContain("13900000000")
    expect(JSON.stringify(mocks.auditAdd.mock.calls)).not.toContain("下午联系")
  })

  test("无变化时不写数据库和审计日志", async () => {
    const mocks = createMockDb({
      current: {
        _id: "booking_1",
        openid: "user_openid",
        status: "contacted",
        userName: "张三",
        phone: "13800000000",
        city: "杭州",
        note: ""
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      id: "booking_1",
      userName: "张三",
      phone: "13800000000",
      city: "杭州",
      note: ""
    })

    expect(res.updated).toBe(false)
    expect(res.changedKeys).toEqual([])
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("手机号格式错误时拒绝更新", async () => {
    const mocks = createMockDb({
      current: {
        _id: "booking_1",
        openid: "user_openid",
        status: "pending"
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      id: "booking_1",
      userName: "张三",
      phone: "123",
      city: "杭州",
      note: ""
    })

    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.bookingDoc).not.toHaveBeenCalled()
  })

  test("不能修改别人的预约", async () => {
    const mocks = createMockDb({
      current: {
        _id: "booking_1",
        openid: "other_openid",
        status: "pending"
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      id: "booking_1",
      userName: "张三",
      phone: "13800000000",
      city: "杭州",
      note: ""
    })

    expect(res.code).toBe("FORBIDDEN")
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
  })

  test("已完成预约不可修改", async () => {
    const mocks = createMockDb({
      current: {
        _id: "booking_1",
        openid: "user_openid",
        status: "completed"
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      id: "booking_1",
      userName: "张三",
      phone: "13800000000",
      city: "杭州",
      note: ""
    })

    expect(res.code).toBe("STATUS_NOT_ALLOWED")
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
  })

  test("并发状态变化不会被联系信息更新覆盖", async () => {
    const mocks = createMockDb({
      current: {
        _id: "booking_1",
        openid: "user_openid",
        status: "pending",
        userName: "张三",
        phone: "13800000000",
        city: "杭州",
        note: ""
      },
      updateResult: { stats: { updated: 0 } }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      id: "booking_1",
      userName: "李四",
      phone: "13900000000",
      city: "上海",
      note: ""
    })

    expect(res.code).toBe("STATUS_CONFLICT")
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })
})
