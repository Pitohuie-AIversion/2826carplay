jest.mock("wx-server-sdk")

function createMockDb({ rolesData, auditData, orderedError = null }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({
        data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
      })
    }))
  }))

  const auditLimit = jest.fn((limitValue) => ({
    get: jest.fn().mockResolvedValue({ data: auditData.slice(0, limitValue) })
  }))
  const auditSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({ data: auditData.slice(offset, offset + limitValue) })
    }))
  }))
  const auditOrderedSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: orderedError
        ? jest.fn().mockRejectedValue(orderedError)
        : jest.fn().mockResolvedValue({ data: auditData.slice(offset, offset + limitValue) })
    }))
  }))
  const auditOrderBy = jest.fn(() => ({ skip: auditOrderedSkip }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "audit_logs") {
        return { limit: auditLimit, skip: auditSkip, orderBy: auditOrderBy }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    auditLimit,
    auditSkip,
    auditOrderBy,
    auditOrderedSkip
  }
}

async function loadAuditLogListWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/auditLogList/index")
  })

  return mod
}

describe("cloudfunctions/auditLogList integration", () => {
  test("admin 可查询并分页", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData: [
        { _id: "a1", action: "roleUpsert", openid: "admin_openid", targetOpenid: "u1", createdAt: "2026-07-16T00:00:00.000Z" },
        { _id: "a2", action: "operationConfigUpdate", openid: "admin_openid", changedKeys: ["brandName"], createdAt: "2026-07-16T01:00:00.000Z" }
      ]
    })

    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ page: 0, pageSize: 1 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(2)
    expect(res.list).toHaveLength(1)
    expect(res.hasMore).toBe(true)
  })

  test("action 可筛选", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData: [
        { _id: "a1", action: "roleUpsert", openid: "admin_openid", createdAt: "2026-07-16T00:00:00.000Z" },
        { _id: "a2", action: "operationConfigUpdate", openid: "admin_openid", createdAt: "2026-07-16T01:00:00.000Z" }
      ]
    })

    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ action: "roleUpsert" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].action).toBe("roleUpsert")
  })

  test("隐私申请审计记录返回申请标识且可搜索", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData: [
        {
          _id: "a1",
          action: "privacyRequestUpdateStatus",
          openid: "admin_openid",
          requestId: "privacy_100",
          requestType: "deletion",
          fromStatus: "processing",
          toStatus: "completed",
          createdAt: "2026-07-16T00:00:00.000Z"
        }
      ]
    })

    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ keyword: "privacy_100" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0]).toEqual(
      expect.objectContaining({
        requestId: "privacy_100",
        requestType: "deletion",
        fromStatus: "processing",
        toStatus: "completed"
      })
    )
  })

  test("匿名数据清理审计返回保留周期和处理数量", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData: [
        {
          _id: "a_cleanup",
          action: "analyticsCleanup",
          openid: "admin_openid",
          retentionDays: 90,
          cutoffDate: "2026-04-30T08:00:00.000Z",
          processed: 100,
          deleted: 98,
          failed: 2,
          createdAt: "2026-07-29T08:00:00.000Z"
        }
      ]
    })

    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ action: "analyticsCleanup" })

    expect(res.ok).toBe(true)
    expect(res.list[0]).toEqual(
      expect.objectContaining({
        action: "analyticsCleanup",
        retentionDays: 90,
        cutoffDate: "2026-04-30T08:00:00.000Z",
        processed: 100,
        deleted: 98,
        failed: 2
      })
    )
  })

  test("隐私数据核验审计只返回分类数量和部分结果标记", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData: [
        {
          _id: "a_inventory",
          action: "privacyRequestDataInventory",
          openid: "admin_openid",
          requestId: "privacy_200",
          requestType: "access",
          bookingCount: 2,
          favoriteCount: 3,
          privacyRequestCount: 1,
          partial: true,
          createdAt: "2026-07-30T08:00:00.000Z"
        }
      ]
    })

    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ action: "privacyRequestDataInventory" })

    expect(res.ok).toBe(true)
    expect(res.list[0]).toEqual(
      expect.objectContaining({
        requestId: "privacy_200",
        requestType: "access",
        bookingCount: 2,
        favoriteCount: 3,
        privacyRequestCount: 1,
        partial: true
      })
    )
  })

  test("日志导出审计返回筛选和截断摘要", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData: [
        {
          _id: "a_log_export",
          action: "logExportCsv",
          openid: "admin_openid",
          logType: "error",
          filter: "vehicleUpdate",
          total: 500,
          matchedTotal: 620,
          sourceTruncated: false,
          truncated: true,
          createdAt: "2026-07-30T08:00:00.000Z"
        }
      ]
    })

    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ action: "logExportCsv" })

    expect(res.ok).toBe(true)
    expect(res.list[0]).toEqual(
      expect.objectContaining({
        logType: "error",
        filter: "vehicleUpdate",
        total: 500,
        matchedTotal: 620,
        sourceTruncated: false,
        truncated: true
      })
    )
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "user_openid", role: "user" }],
      auditData: []
    })

    const mod = await loadAuditLogListWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({})

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.auditSkip).not.toHaveBeenCalled()
  })

  test("超过 500 条审计日志后仍可读取后续分页", async () => {
    const auditData = Array.from({ length: 550 }, (_, index) => ({
      _id: `a${index}`,
      action: "vehicleUpdate",
      openid: "admin_openid",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    }))
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData
    })
    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({ page: 27, pageSize: 20 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(550)
    expect(res.list).toHaveLength(10)
    expect(res.hasMore).toBe(false)
    expect(res.truncated).toBe(false)
    expect(mocks.auditOrderBy).toHaveBeenCalledWith("createdAt", "desc")
    expect(mocks.auditOrderedSkip).toHaveBeenCalledWith(500)
  })

  test("缺少 createdAt 索引时自动降级读取", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData: [
        {
          _id: "a1",
          action: "roleUpsert",
          openid: "admin_openid",
          createdAt: "2026-07-16T00:00:00.000Z"
        }
      ],
      orderedError: new Error("missing createdAt index")
    })
    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({})

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(mocks.auditOrderedSkip).toHaveBeenCalledWith(0)
    expect(mocks.auditSkip).toHaveBeenCalledWith(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
