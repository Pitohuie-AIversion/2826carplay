jest.mock("wx-server-sdk")

const REQUIRED_COLLECTIONS = [
  "vehicles",
  "bookings",
  "roles",
  "app_configs",
  "audit_logs",
  "error_logs",
  "favorites",
  "pending_file_deletions",
  "privacy_requests",
  "analytics_events"
]

function createMockDb({
  roles,
  unavailable = [],
  config = null,
  counts = {},
  countErrors = []
}) {
  const collectionReads = {}
  REQUIRED_COLLECTIONS.forEach((name) => {
    collectionReads[name] = jest.fn()
    if (unavailable.includes(name)) {
      collectionReads[name].mockRejectedValue(new Error("collection not exist"))
    } else {
      collectionReads[name].mockResolvedValue({ data: [] })
    }
  })

  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limit) => ({
      get: jest.fn().mockResolvedValue({
        data: roles.filter((item) => item.openid === filter.openid).slice(0, limit)
      })
    }))
  }))
  const configWhere = jest.fn(() => ({
    limit: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ data: config ? [config] : [] })
    }))
  }))
  const collectionCounts = {}
  REQUIRED_COLLECTIONS.forEach((name) => {
    collectionCounts[name] = countErrors.includes(name)
      ? jest.fn().mockRejectedValue(new Error("count failed"))
      : jest.fn().mockResolvedValue({ total: Number(counts[name]) || 0 })
  })

  const collection = jest.fn((name) => {
    const base = {
      count: collectionCounts[name],
      limit: jest.fn(() => ({
        get: collectionReads[name]
      }))
    }
    if (name === "roles") {
      base.where = rolesWhere
    }
    if (name === "app_configs") {
      base.where = configWhere
    }
    return base
  })

  return {
    db: { collection },
    collection,
    collectionReads,
    collectionCounts,
    configWhere
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
    mod = require("../cloudfunctions/systemHealthCheck/index")
  })
  return mod
}

describe("cloudfunctions/systemHealthCheck integration", () => {
  const originalTemplateId = process.env.BOOKING_STATUS_TEMPLATE_ID

  afterEach(() => {
    if (originalTemplateId === undefined) {
      delete process.env.BOOKING_STATUS_TEMPLATE_ID
    } else {
      process.env.BOOKING_STATUS_TEMPLATE_ID = originalTemplateId
    }
  })

  test("管理员可完成只读检查并识别已配置订阅模板", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      config: {
        key: "operation_settings",
        value: { bookingStatusTemplateId: "template_123456" }
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.summary).toEqual({
      total: 18,
      passed: 18,
      warnings: 0,
      failed: 0,
      ready: true
    })
    expect(res.checks.find((item) => item.key === "booking_status_template").status).toBe(
      "pass"
    )
    REQUIRED_COLLECTIONS.forEach((name) => {
      expect(mocks.collectionReads[name]).toHaveBeenCalledTimes(1)
    })
  })

  test("缺少集合时标记为阻塞项但保留其他检查结果", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      unavailable: ["privacy_requests"],
      config: {
        key: "operation_settings",
        value: {}
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.summary.ready).toBe(false)
    expect(res.summary.failed).toBe(1)
    expect(res.checks.find((item) => item.key === "collection_privacy_requests")).toMatchObject({
      status: "fail",
      message: "集合不存在或当前环境不可访问"
    })
    expect(res.checks.find((item) => item.key === "booking_status_template").status).toBe(
      "warning"
    )
    warnSpy.mockRestore()
  })

  test("未保存运营配置时返回提醒而不是阻塞", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.summary.ready).toBe(true)
    expect(res.summary.warnings).toBe(2)
    expect(res.checks.find((item) => item.key === "operation_settings").status).toBe(
      "warning"
    )
  })

  test("记录规模接近功能读取上限时返回针对性提醒", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      config: {
        key: "operation_settings",
        value: { bookingStatusTemplateId: "template_123456" }
      },
      counts: {
        audit_logs: 1800,
        analytics_events: 5000
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.summary.ready).toBe(true)
    expect(res.summary.warnings).toBe(2)
    expect(res.checks.find((item) => item.key === "volume_audit_logs")).toMatchObject({
      status: "warning",
      count: 1800,
      featureLimit: 2000
    })
    expect(
      res.checks.find((item) => item.key === "volume_analytics_events").message
    ).toContain("匿名数据清理")
  })

  test("数量统计失败时不影响集合可用性检查", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      config: {
        key: "operation_settings",
        value: { bookingStatusTemplateId: "template_123456" }
      },
      countErrors: ["error_logs"]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.summary.failed).toBe(0)
    expect(res.checks.find((item) => item.key === "collection_error_logs").status).toBe(
      "pass"
    )
    expect(res.checks.find((item) => item.key === "volume_error_logs")).toMatchObject({
      status: "warning",
      message: "记录数量读取失败，请到云控制台确认数据规模"
    })
    warnSpy.mockRestore()
  })

  test("普通用户无法执行上线检查", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "user_openid", role: "user" }]
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main()

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "仅管理员可执行上线检查"
    })
    REQUIRED_COLLECTIONS.forEach((name) => {
      expect(mocks.collectionReads[name]).not.toHaveBeenCalled()
      expect(mocks.collectionCounts[name]).not.toHaveBeenCalled()
    })
  })
})
