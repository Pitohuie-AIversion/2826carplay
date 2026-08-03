jest.mock("wx-server-sdk")

function createMockDb({ rolesData, errorData }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({
        data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
      })
    }))
  }))

  const errorLimit = jest.fn((limitValue) => ({
    get: jest.fn().mockResolvedValue({ data: errorData.slice(0, limitValue) })
  }))
  const errorSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({ data: errorData.slice(offset, offset + limitValue) })
    }))
  }))
  const errorOrderBy = jest.fn(() => ({ skip: errorSkip }))
  const errorField = jest.fn(() => ({
    limit: errorLimit,
    skip: errorSkip,
    orderBy: errorOrderBy
  }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "error_logs") {
        return {
          limit: errorLimit,
          skip: errorSkip,
          orderBy: errorOrderBy,
          field: errorField
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    errorLimit,
    errorSkip,
    errorOrderBy,
    errorField
  }
}

async function loadErrorLogListWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/errorLogList/index")
  })

  return mod
}

describe("cloudfunctions/errorLogList integration", () => {
  test("admin 可查询并分页", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      errorData: [
        { _id: "e1", function: "roleUpsert", openid: "admin_openid", errorMessage: "x", createdAt: "2026-07-16T00:00:00.000Z" },
        { _id: "e2", function: "operationConfigUpdate", openid: "admin_openid", errorMessage: "y", createdAt: "2026-07-16T01:00:00.000Z" }
      ]
    })

    const mod = await loadErrorLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ page: 0, pageSize: 1 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(2)
    expect(res.list).toHaveLength(1)
    expect(res.hasMore).toBe(true)
    expect(mocks.errorField).toHaveBeenCalledWith({
      _id: true,
      function: true,
      stage: true,
      vehicleId: true,
      bookingId: true,
      targetStatus: true,
      errorCode: true,
      errorMessage: true,
      occurredAt: true,
      createdAt: true
    })
    expect(res.list[0]).not.toHaveProperty("openid")
    expect(res.list[0]).not.toHaveProperty("targetOpenid")
  })

  test("func 可筛选", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      errorData: [
        { _id: "e1", function: "roleUpsert", openid: "admin_openid", errorMessage: "x", createdAt: "2026-07-16T00:00:00.000Z" },
        { _id: "e2", function: "operationConfigUpdate", openid: "admin_openid", errorMessage: "y", createdAt: "2026-07-16T01:00:00.000Z" }
      ]
    })

    const mod = await loadErrorLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ func: "roleUpsert" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].function).toBe("roleUpsert")
  })

  test("订阅通知故障返回目标状态和错误码并支持搜索", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      errorData: [
        {
          _id: "e_notify",
          function: "bookingUpdateStatus",
          stage: "subscribeMessage",
          bookingId: "booking_88",
          targetStatus: "contacted",
          errorCode: "50002",
          errorMessage: `api unavailable ${"x".repeat(400)}`,
          stack: "Error: api unavailable at /workspace/private/source.js:42:7",
          createdAt: "2026-07-29T08:00:00.000Z"
        }
      ]
    })

    const mod = await loadErrorLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ keyword: "50002" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0]).toEqual(
      expect.objectContaining({
        stage: "subscribeMessage",
        bookingId: "booking_88",
        targetStatus: "contacted",
        errorCode: "50002"
      })
    )
    expect(res.list[0]).not.toHaveProperty("stack")
    expect(res.list[0].errorMessage).toHaveLength(300)
  })

  test("历史错误日志中的身份字段不会被读取或返回", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      errorData: [
        {
          _id: "e_legacy",
          function: "roleUpsert",
          openid: "legacy_operator_secret",
          targetOpenid: "legacy_target_secret",
          errorMessage: "save failed",
          createdAt: "2026-07-16T00:00:00.000Z"
        }
      ]
    })
    const mod = await loadErrorLogListWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({})
    const fields = mocks.errorField.mock.calls[0][0]

    expect(fields).not.toHaveProperty("openid")
    expect(fields).not.toHaveProperty("targetOpenid")
    expect(JSON.stringify(res.list)).not.toContain("legacy_operator_secret")
    expect(JSON.stringify(res.list)).not.toContain("legacy_target_secret")
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "user_openid", role: "user" }],
      errorData: []
    })

    const mod = await loadErrorLogListWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({})

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.errorSkip).not.toHaveBeenCalled()
  })

  test("超过 500 条错误日志后仍可读取后续分页", async () => {
    const errorData = Array.from({ length: 550 }, (_, index) => ({
      _id: `e${index}`,
      function: "vehicleUpdate",
      openid: "admin_openid",
      errorMessage: `error-${index}`,
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    }))
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      errorData
    })
    const mod = await loadErrorLogListWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({ page: 27, pageSize: 20 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(550)
    expect(res.list).toHaveLength(10)
    expect(res.hasMore).toBe(false)
    expect(res.truncated).toBe(false)
    expect(mocks.errorOrderBy).toHaveBeenCalledWith("createdAt", "desc")
    expect(mocks.errorSkip).toHaveBeenCalledWith(500)
  })
})
