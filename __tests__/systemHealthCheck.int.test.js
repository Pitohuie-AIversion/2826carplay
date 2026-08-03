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
  countErrors = [],
  qualityData = {}
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
  const configGet = jest.fn().mockResolvedValue({ data: config ? [config] : [] })
  const configField = jest.fn(() => ({
    limit: jest.fn(() => ({ get: configGet }))
  }))
  const configWhere = jest.fn(() => ({
    field: configField,
    limit: jest.fn(() => ({ get: configGet }))
  }))
  const collectionCounts = {}
  const collectionFields = {}
  REQUIRED_COLLECTIONS.forEach((name) => {
    collectionCounts[name] = countErrors.includes(name)
      ? jest.fn().mockRejectedValue(new Error("count failed"))
      : jest.fn().mockResolvedValue({ total: Number(counts[name]) || 0 })
  })

  const collection = jest.fn((name) => {
    const records = Array.isArray(qualityData[name])
      ? qualityData[name]
      : name === "roles"
        ? roles
        : []
    collectionFields[name] = collectionFields[name] || jest.fn(() => ({
      limit: jest.fn(() => ({ get: collectionReads[name] })),
      skip: jest.fn((offset) => ({
        limit: jest.fn((limit) => ({
          get: jest
            .fn()
            .mockResolvedValue({ data: records.slice(offset, offset + limit) })
        }))
      }))
    }))
    const base = {
      count: collectionCounts[name],
      limit: jest.fn(() => ({
        get: collectionReads[name]
      })),
      field: collectionFields[name]
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
    collectionFields,
    configWhere,
    configField
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
      total: 20,
      passed: 20,
      warnings: 0,
      failed: 0,
      ready: true
    })
    expect(res.checks.find((item) => item.key === "booking_status_template").status).toBe(
      "pass"
    )
    REQUIRED_COLLECTIONS.forEach((name) => {
      expect(mocks.collectionReads[name]).toHaveBeenCalledTimes(1)
      expect(mocks.collectionFields[name]).toHaveBeenCalledWith({ _id: true })
    })
    expect(mocks.configField).toHaveBeenCalledWith({ value: true })
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

  test("历史车牌或权限账号存在缺失和重复时标记为阻塞项且不返回原值", async () => {
    const mocks = createMockDb({
      roles: [
        { _id: "role_admin", openid: "admin_openid", role: "admin" },
        { _id: "role_1", openid: "duplicate_openid", role: "operator" },
        { _id: "role_2", openid: "duplicate_openid", role: "member" },
        { _id: "role_3", openid: "", role: "member" }
      ],
      config: {
        key: "operation_settings",
        value: { bookingStatusTemplateId: "template_123456" }
      },
      counts: {
        vehicles: 4,
        roles: 4
      },
      qualityData: {
        vehicles: [
          { _id: "vehicle_1", plateNumber: "京A12345" },
          { _id: "vehicle_2", plateNumber: "京a12345" },
          { _id: "vehicle_3", plateNumber: "" },
          { _id: "vehicle_4", plateNumber: "沪B12345" }
        ]
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.summary.ready).toBe(false)
    expect(res.summary.failed).toBe(2)
    expect(res.checks.find((item) => item.key === "vehicle_plate_uniqueness")).toMatchObject({
      status: "fail",
      missingCount: 1,
      duplicateGroups: 1,
      duplicateRecords: 2
    })
    expect(res.checks.find((item) => item.key === "role_openid_uniqueness")).toMatchObject({
      status: "fail",
      missingCount: 1,
      duplicateGroups: 1,
      duplicateRecords: 2
    })
    expect(JSON.stringify(res.checks)).not.toContain("京A12345")
    expect(JSON.stringify(res.checks)).not.toContain("duplicate_openid")
  })

  test("历史数据超过安全扫描上限时提醒在控制台全量核验", async () => {
    const qualityData = {
      vehicles: Array.from({ length: 2000 }, (_, index) => ({
        _id: `vehicle_${index}`,
        plateNumber: `测试${index}`
      }))
    }
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      config: {
        key: "operation_settings",
        value: { bookingStatusTemplateId: "template_123456" }
      },
      counts: {
        vehicles: 2001,
        roles: 1
      },
      qualityData
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.summary.ready).toBe(true)
    expect(res.checks.find((item) => item.key === "vehicle_plate_uniqueness")).toMatchObject({
      status: "warning",
      count: 2000,
      total: 2001
    })
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
