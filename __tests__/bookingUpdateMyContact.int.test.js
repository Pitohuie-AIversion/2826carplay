jest.mock("wx-server-sdk")

function createMockDb({ current, beforeTransaction }) {
  let stored = current && { ...current }
  const bookingGet = jest.fn(async () => ({ data: stored && { ...stored } }))
  const bookingDoc = jest.fn(() => ({ get: bookingGet }))
  const bookingUpdate = jest.fn(async ({ data }) => { stored = { ...stored, ...data }; return { stats: { updated: 1 } } })
  const bookingWhere = jest.fn(() => ({ update: bookingUpdate }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  let queue = Promise.resolve()
  const db = {
    runTransaction: jest.fn((callback) => {
      const result = queue.then(() => {
        if (beforeTransaction) stored = beforeTransaction(stored)
        return callback({ collection: () => ({ doc: () => ({ get: bookingGet, update: bookingUpdate }) }) })
      })
      queue = result.catch(() => {})
      return result
    }),
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
  const contact = { userName: "张三", phone: "13800000000", city: "杭州", note: "原备注" }
  const initial = { _id: "booking_1", openid: "user_openid", status: "pending", ...contact, pickupLocation: "原取车点", location: "原地址", returnLocation: "还车点" }

  test("相同编辑基线同时改城市和电话仅允许一份写入，旧草稿不会覆盖新内容", async () => {
    const mocks = createMockDb({ current: initial })
    const mod = await loadModule("user_openid", mocks.db)
    const payload = { id: "booking_1", ...contact, expectedValues: contact }
    const results = await Promise.all([
      mod.main({ ...payload, city: "上海", note: "新的约定" }),
      mod.main({ ...payload, phone: "13900000000" })
    ])
    expect(results[0]).toMatchObject({ ok: true, contact: { city: "上海", note: "新的约定", pickupLocation: "", location: "", returnLocation: "还车点" } })
    expect(results[1]).toMatchObject({ ok: false, code: "CONTACT_CONFLICT" })
    expect(mocks.bookingUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
  })

  test("预查后联系信息或还车地址被更新，事务读取最新值再校验和回填", async () => {
    const mocks = createMockDb({ current: initial, beforeTransaction: (record) => ({ ...record, returnLocation: "新还车点" }) })
    const mod = await loadModule("user_openid", mocks.db)
    const result = await mod.main({ id: "booking_1", ...contact, phone: "13900000000", note: "", expectedValues: contact })
    expect(result).toMatchObject({ ok: true, contact: { phone: "13900000000", note: "", pickupLocation: "原取车点", returnLocation: "新还车点" } })
    expect(mocks.bookingUpdate.mock.calls[0][0].data).not.toHaveProperty("returnLocation")
  })

  test("保存回执丢失的同内容重试不重复审计，旧基线改内容拒绝", async () => {
    const mocks = createMockDb({ current: initial })
    const mod = await loadModule("user_openid", mocks.db)
    const input = { id: "booking_1", ...contact, city: "上海", expectedValues: contact }
    expect(await mod.main(input)).toMatchObject({ ok: true, updated: true })
    expect(await mod.main(input)).toMatchObject({ ok: true, updated: false, contact: { city: "上海", pickupLocation: "" } })
    expect(await mod.main({ ...input, note: "新内容" })).toMatchObject({ ok: false, code: "CONTACT_CONFLICT" })
    expect(mocks.bookingUpdate).toHaveBeenCalledTimes(1)
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
  })

  test.each([undefined, {}, { ...contact, note: null }])("缺失或不完整基线 %p 不允许覆盖联系信息", async (expectedValues) => {
    const mocks = createMockDb({ current: initial })
    const mod = await loadModule("user_openid", mocks.db)
    expect(await mod.main({ id: "booking_1", ...contact, city: "上海", expectedValues })).toMatchObject({ ok: false, code: "CONTACT_VERSION_REQUIRED" })
    expect(mocks.bookingUpdate).not.toHaveBeenCalled()
  })

  test("更换取车城市清除旧城市网点，单独修改联系人保留地点", async () => {
    for (const city of ["上海", "杭州市"]) {
      const mocks = createMockDb({ current: { _id: "booking_1", openid: "user_openid", status: "pending", userName: "张三", phone: "13800000000", city: "杭州", note: "", pickupLocation: "杭州已约定门店", location: "杭州历史取车地址", returnLocation: "杭州约定还车点" } })
      const mod = await loadModule("user_openid", mocks.db)
      const res = await mod.main({ id: "booking_1", userName: "张三", phone: "13800000000", city, note: "", expectedValues: { userName: "张三", phone: "13800000000", city: "杭州", note: "" } })
      expect(res.ok).toBe(true)
      const data = mocks.bookingUpdate.mock.calls[0][0].data
      if (city === "上海") expect(data).toMatchObject({ pickupLocation: "", location: "" })
      else expect(data).not.toHaveProperty("pickupLocation")
      expect(data).not.toHaveProperty("returnLocation")
    }
  })
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
      note: "下午联系",
      expectedValues: { userName: "张三", phone: "13800000000", city: "杭州", note: "" }
    })

    expect(res).toMatchObject({
      ok: true,
      id: "booking_1",
      status: "pending",
      updated: true,
      changedKeys: ["phone", "note"],
      message: "联系信息已更新"
    })
    expect(mocks.db.runTransaction).toHaveBeenCalledTimes(1)
    expect(res.contact).toEqual({ userName: "张三", phone: "13900000000", city: "杭州", note: "下午联系", pickupLocation: "", returnLocation: "", location: "" })
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
      beforeTransaction: (record) => ({ ...record, status: "confirmed" })
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
