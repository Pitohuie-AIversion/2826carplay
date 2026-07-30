jest.mock("wx-server-sdk")

function createMockDb({ rolesData, eventData, removeResults = {} }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const rolesWhere = jest.fn(() => ({
    limit: jest.fn(() => ({ get: rolesGet }))
  }))
  const eventGet = jest.fn().mockResolvedValue({ data: eventData })
  const eventLimit = jest.fn(() => ({ get: eventGet }))
  const eventWhere = jest.fn(() => ({ limit: eventLimit }))
  const eventRemove = jest.fn((id) => {
    const result = removeResults[id]
    if (result instanceof Error) {
      return Promise.reject(result)
    }
    return Promise.resolve({
      stats: {
        removed: result === undefined ? 1 : result
      }
    })
  })
  const eventDoc = jest.fn((id) => ({
    remove: () => eventRemove(id)
  }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const errorAdd = jest.fn().mockResolvedValue({ _id: "error_1" })
  const serverDateValue = { __type: "serverDate" }
  const lt = jest.fn((value) => ({ __op: "lt", value }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "analytics_events") {
        return {
          where: eventWhere,
          doc: eventDoc
        }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      if (name === "error_logs") {
        return { add: errorAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    command: { lt },
    serverDate: jest.fn(() => serverDateValue)
  }

  return {
    db,
    rolesWhere,
    eventGet,
    eventLimit,
    eventWhere,
    eventRemove,
    eventDoc,
    auditAdd,
    errorAdd,
    lt,
    serverDateValue
  }
}

async function loadFunctionWith({ openid, mockDb }) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/analyticsCleanup/index")
  })
  return mod
}

describe("cloudfunctions/analyticsCleanup integration", () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test("管理员按 90 天边界分批清理并写审计日志", async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-07-29T08:00:00.000Z"))
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      eventData: [{ _id: "event_1" }, { _id: "event_2" }]
    })
    const mod = await loadFunctionWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({ limit: 999 })
    const cutoff = new Date("2026-04-30T08:00:00.000Z")

    expect(res).toEqual({
      ok: true,
      retentionDays: 90,
      cutoffDate: cutoff.toISOString(),
      processed: 2,
      deleted: 2,
      failed: 0,
      hasMore: false,
      message: "匿名事件清理完成"
    })
    expect(mocks.lt).toHaveBeenCalledWith(cutoff)
    expect(mocks.eventWhere).toHaveBeenCalledWith({
      createdAt: {
        __op: "lt",
        value: cutoff
      }
    })
    expect(mocks.eventLimit).toHaveBeenCalledWith(100)
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "admin_openid",
        action: "analyticsCleanup",
        retentionDays: 90,
        cutoffDate: cutoff.toISOString(),
        processed: 2,
        deleted: 2,
        failed: 0,
        createdAt: mocks.serverDateValue
      }
    })
  })

  test("单条删除失败时继续处理其余记录", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      eventData: [{ _id: "event_1" }, { _id: "event_2" }],
      removeResults: {
        event_2: new Error("remove failed")
      }
    })
    const mod = await loadFunctionWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.processed).toBe(2)
    expect(res.deleted).toBe(1)
    expect(res.failed).toBe(1)
    expect(mocks.eventRemove).toHaveBeenCalledTimes(2)
    expect(mocks.errorAdd).toHaveBeenCalledWith({
      data: expect.objectContaining({
        function: "analyticsCleanup",
        stage: "removeRecords",
        retentionDays: 90,
        failed: 1,
        errorMessage: "remove failed",
        createdAt: mocks.serverDateValue
      })
    })
  })

  test("非管理员不能读取或删除匿名事件", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "member" }],
      eventData: [{ _id: "event_1" }]
    })
    const mod = await loadFunctionWith({
      openid: "user_openid",
      mockDb: mocks.db
    })

    const res = await mod.main()

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.eventGet).not.toHaveBeenCalled()
    expect(mocks.eventRemove).not.toHaveBeenCalled()
  })
})
