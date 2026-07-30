jest.mock("wx-server-sdk")

function createLogQuery(records, orderedError) {
  const orderedSkip = jest.fn((offset) => ({
    limit: jest.fn((limit) => ({
      get: orderedError
        ? jest.fn().mockRejectedValue(orderedError)
        : jest.fn().mockResolvedValue({ data: records.slice(offset, offset + limit) })
    }))
  }))
  const fallbackSkip = jest.fn((offset) => ({
    limit: jest.fn((limit) => ({
      get: jest.fn().mockResolvedValue({ data: records.slice(offset, offset + limit) })
    }))
  }))
  return {
    orderBy: jest.fn(() => ({ skip: orderedSkip })),
    skip: fallbackSkip,
    orderedSkip,
    fallbackSkip
  }
}

function createMockDb({ roles, auditLogs = [], errorLogs = [], orderedError = null }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limit) => ({
      get: jest.fn().mockResolvedValue({
        data: roles.filter((item) => item.openid === filter.openid).slice(0, limit)
      })
    }))
  }))
  const auditQuery = createLogQuery(auditLogs, orderedError)
  const errorQuery = createLogQuery(errorLogs, orderedError)
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_export" })
  const collection = jest.fn((name) => {
    if (name === "roles") {
      return { where: rolesWhere }
    }
    if (name === "audit_logs") {
      return {
        orderBy: auditQuery.orderBy,
        skip: auditQuery.skip,
        add: auditAdd
      }
    }
    if (name === "error_logs") {
      return {
        orderBy: errorQuery.orderBy,
        skip: errorQuery.skip
      }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })

  return {
    db: {
      collection,
      serverDate: jest.fn(() => ({ serverDate: true }))
    },
    auditAdd,
    auditQuery,
    errorQuery
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
    mod = require("../cloudfunctions/logExportCsv/index")
  })
  return mod
}

describe("cloudfunctions/logExportCsv integration", () => {
  test("管理员可按操作筛选并导出审计日志", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      auditLogs: [
        {
          _id: "a1",
          action: "vehicleCreate",
          openid: "admin_openid",
          vehicleId: "vehicle_1",
          createdAt: "2026-07-30T08:00:00.000Z"
        },
        {
          _id: "a2",
          action: "roleUpsert",
          openid: "admin_openid",
          targetOpenid: "target_1",
          createdAt: "2026-07-29T08:00:00.000Z"
        }
      ]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      logType: "audit",
      filter: "vehicleCreate",
      keyword: "vehicle_1"
    })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.matchedTotal).toBe(1)
    expect(res.csvText).toContain("车辆ID")
    expect(res.csvText).toContain("vehicle_1")
    expect(res.csvText).not.toContain("target_1")
    expect(res.fileName).toMatch(/^audit-logs-\d{8}-\d{4}\.csv$/)
    const auditData = mocks.auditAdd.mock.calls[0][0].data
    expect(auditData).toMatchObject({
      openid: "admin_openid",
      action: "logExportCsv",
      logType: "audit",
      filter: "vehicleCreate",
      total: 1
    })
    expect(auditData.keyword).toBeUndefined()
  })

  test("错误日志导出防止表格公式并排除堆栈", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", roles: ["admin"] }],
      errorLogs: [
        {
          _id: "e1",
          function: "vehicleUpdate",
          errorCode: "UPDATE_FAILED",
          errorMessage: "=HYPERLINK(\"https://example.com\")",
          stack: "sensitive stack content",
          createdAt: "2026-07-30T08:00:00.000Z"
        }
      ]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      logType: "error"
    })

    expect(res.ok).toBe(true)
    expect(res.csvText).toContain(`"'=HYPERLINK(""https://example.com"")"`)
    expect(res.csvText).not.toContain("sensitive stack content")
  })

  test("匹配记录超过 500 条时明确返回截断", async () => {
    const auditLogs = Array.from({ length: 501 }, (_, index) => ({
      _id: `a_${index}`,
      action: "vehicleUpdate",
      vehicleId: `vehicle_${index}`,
      createdAt: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`
    }))
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      auditLogs
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      logType: "audit",
      limit: 500
    })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(500)
    expect(res.matchedTotal).toBe(501)
    expect(res.truncated).toBe(true)
    expect(res.sourceTruncated).toBe(false)
  })

  test("非管理员不可导出日志", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "user_openid", role: "user" }],
      auditLogs: [{ _id: "a1", action: "roleUpsert" }]
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({ logType: "audit" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.auditQuery.orderBy).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })
})
