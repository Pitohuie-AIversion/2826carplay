jest.mock("wx-server-sdk")

function createPagedWhere(records, error) {
  const skip = jest.fn((offset) => ({
    limit: jest.fn((limit) => ({
      get: error
        ? jest.fn().mockRejectedValue(error)
        : jest.fn().mockResolvedValue({
            data: records.slice(offset, offset + limit)
          })
    }))
  }))
  const field = jest.fn(() => ({ skip }))
  const where = jest.fn(() => ({ field }))
  where.field = field
  return where
}

function createMockDb({
  roles,
  request,
  bookings = [],
  quotes = [],
  handovers = [],
  favorites = [],
  privacyRequests = [],
  unavailable = []
}) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limit) => ({
      get: jest.fn().mockResolvedValue({
        data: roles.filter((item) => item.openid === filter.openid).slice(0, limit)
      })
    }))
  }))
  const bookingsWhere = createPagedWhere(
    bookings,
    unavailable.includes("bookings") ? new Error("collection not found") : null
  )
  const favoritesWhere = createPagedWhere(
    favorites,
    unavailable.includes("favorites") ? new Error("collection not found") : null
  )
  const quotesWhere = jest.fn((filter) => ({
    field: jest.fn(() => ({
      limit: jest.fn((limit) => ({
        get: unavailable.includes("booking_quotes")
          ? jest.fn().mockRejectedValue(new Error("collection not found"))
          : jest.fn().mockResolvedValue({
              data: quotes.filter((item) => item.bookingId === filter.bookingId).slice(0, limit)
            })
      }))
    }))
  }))
  const handoversWhere = jest.fn((filter) => ({
    field: jest.fn(() => ({
      limit: jest.fn((limit) => ({
        get: unavailable.includes("booking_handovers")
          ? jest.fn().mockRejectedValue(new Error("collection not found"))
          : jest.fn().mockResolvedValue({
              data: handovers.filter((item) => item.bookingId === filter.bookingId).slice(0, limit)
            })
      }))
    }))
  }))
  const requestsWhere = createPagedWhere(
    privacyRequests,
    unavailable.includes("privacy_requests") ? new Error("collection not found") : null
  )
  const requestGet = request
    ? jest.fn().mockResolvedValue({ data: request })
    : jest.fn().mockRejectedValue(new Error("document not found"))
  const exportStateUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const requestField = jest.fn(() => ({ get: requestGet }))
  const privacyDoc = jest.fn(() => ({
    get: requestGet,
    field: requestField,
    update: exportStateUpdate
  }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const serverDateValue = { serverDate: true }

  const collection = jest.fn((name) => {
    if (name === "roles") {
      return { where: rolesWhere }
    }
    if (name === "bookings") {
      return { where: bookingsWhere }
    }
    if (name === "favorites") {
      return { where: favoritesWhere }
    }
    if (name === "booking_quotes") {
      return { where: quotesWhere }
    }
    if (name === "booking_handovers") {
      return { where: handoversWhere }
    }
    if (name === "privacy_requests") {
      return {
        doc: privacyDoc,
        where: requestsWhere
      }
    }
    if (name === "audit_logs") {
      return { add: auditAdd }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })

  return {
    db: {
      collection,
      serverDate: jest.fn(() => serverDateValue)
    },
    bookingsWhere,
    favoritesWhere,
    requestsWhere,
    requestGet,
    requestField,
    exportStateUpdate,
    auditAdd
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
    mod = require("../cloudfunctions/privacyRequestDataInventory/index")
  })
  return mod
}

describe("cloudfunctions/privacyRequestDataInventory integration", () => {
  test("管理员可按申请核验用户相关数据且审计日志不记录用户身份", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      request: {
        _id: "request_1",
        openid: "user_openid",
        type: "access",
        status: "processing",
        description: "查询我的资料",
        createdAt: "2026-07-20T00:00:00.000Z"
      },
      bookings: [
        {
          _id: "booking_1",
          openid: "user_openid",
          vehicleName: "示例车辆",
          userName: "用户甲",
          phone: "13800000000",
          city: "杭州",
          note: "联系备注",
          createdAt: "2026-07-21T00:00:00.000Z",
          handledBy: "should_not_return"
        }
      ],
      quotes: [
        {
          _id: "quote_1",
          bookingId: "booking_1",
          vehicleId: "vehicle_1",
          vehicleName: "示例车辆",
          totalCents: 128000,
          customerNote: "用户可见说明",
          adjustmentNote: "取消取送车",
          version: 1,
          status: "adjustment_requested",
          createdAt: "2026-07-21T01:00:00.000Z"
        }
      ],
      handovers: [{
        _id: "booking_1__pickup__v1",
        bookingId: "booking_1",
        stage: "pickup",
        version: 1,
        status: "confirmed",
        mileageKm: 12000,
        energyType: "fuel",
        energyLevelPercent: 80,
        damageNote: "未发现已知损伤",
        additionalNote: "钥匙一把",
        photos: [{ fileId: "cloud://private-photo" }],
        createdAt: "2026-07-21T02:00:00.000Z"
      }],
      favorites: [
        {
          _id: "favorite_1",
          openid: "user_openid",
          vehicleId: "vehicle_1",
          createdAt: "2026-07-19T00:00:00.000Z"
        }
      ],
      privacyRequests: [
        {
          _id: "request_1",
          openid: "user_openid",
          type: "access",
          status: "processing",
          description: "查询我的资料",
          handledBy: "admin_secret"
        }
      ]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({ requestId: "request_1" })

    expect(res.ok).toBe(true)
    expect(res.partial).toBe(false)
    expect(res.categories.bookings.count).toBe(1)
    expect(res.categories.quotes.count).toBe(1)
    expect(res.categories.handovers.count).toBe(1)
    expect(res.categories.handovers.list[0]).toMatchObject({
      id: "booking_1__pickup__v1",
      mileageKm: 12000,
      damageNote: "未发现已知损伤"
    })
    expect(res.categories.handovers.list[0]).not.toHaveProperty("photos")
    expect(res.categories.quotes.list[0]).toMatchObject({
      id: "quote_1",
      totalCents: 128000,
      adjustmentNote: "取消取送车"
    })
    expect(res.categories.bookings.list[0]).toMatchObject({
      id: "booking_1",
      userName: "用户甲",
      phone: "13800000000"
    })
    expect(res.categories.bookings.list[0].handledBy).toBeUndefined()
    expect(res.categories.privacyRequests.list[0].handledBy).toBeUndefined()
    const requestFieldSpec = mocks.requestField.mock.calls[0][0]
    expect(requestFieldSpec).toEqual(expect.objectContaining({
      openid: true,
      type: true,
      status: true,
      description: true
    }))
    expect(requestFieldSpec).not.toHaveProperty("handledBy")
    expect(requestFieldSpec).not.toHaveProperty("dataExportedBy")
    const bookingFieldSpec = mocks.bookingsWhere.field.mock.calls[0][0]
    expect(bookingFieldSpec).toEqual(expect.objectContaining({
      vehicleName: true,
      phone: true,
      note: true,
      createdAt: true
    }))
    expect(bookingFieldSpec).not.toHaveProperty("openid")
    expect(bookingFieldSpec).not.toHaveProperty("handledBy")
    expect(mocks.favoritesWhere.field.mock.calls[0][0]).not.toHaveProperty("openid")
    expect(mocks.requestsWhere.field.mock.calls[0][0]).not.toHaveProperty("handledBy")
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
    const auditData = mocks.auditAdd.mock.calls[0][0].data
    expect(auditData).toMatchObject({
      openid: "admin_openid",
      action: "privacyRequestDataInventory",
      requestId: "request_1",
      bookingCount: 1,
      favoriteCount: 1,
      privacyRequestCount: 1,
      partial: false
    })
    expect(JSON.stringify(auditData)).not.toContain("user_openid")
    expect(JSON.stringify(auditData)).not.toContain("13800000000")
  })

  test("查询信息申请可导出完整 CSV 且审计日志不记录个人信息", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      request: {
        _id: "request_export",
        openid: "user_openid",
        type: "access",
        status: "processing"
      },
      bookings: [
        {
          _id: "booking_export",
          openid: "user_openid",
          vehicleId: "vehicle_1",
          vehicleName: "示例车辆",
          userName: "用户甲",
          phone: "13800000000",
          city: "杭州",
          note: "  @SUM(1,1)",
          status: "pending",
          handledBy: "admin_secret"
        }
      ],
      favorites: [
        {
          _id: "favorite_export",
          openid: "user_openid",
          vehicleId: "vehicle_1"
        }
      ],
      privacyRequests: [
        {
          _id: "request_export",
          openid: "user_openid",
          type: "access",
          status: "processing",
          description: "+cmd",
          handledBy: "admin_secret"
        }
      ]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      requestId: "request_export",
      mode: "export"
    })

    expect(res.ok).toBe(true)
    expect(res.fileName).toMatch(/^privacy-data-request_export-\d{8}-\d{4}\.csv$/)
    expect(res.csvText.startsWith("\ufeff")).toBe(true)
    expect(res.csvText).toContain("用户OpenID")
    expect(res.csvText).toContain("user_openid")
    expect(res.csvText).toContain("13800000000")
    expect(res.csvText).toContain(`"'  @SUM(1,1)"`)
    expect(res.csvText).toContain(`'+cmd`)
    expect(res.csvText).toContain("匿名分析事件不保存 OpenID")
    expect(res.csvText).not.toContain("handledBy")
    expect(res.csvText).not.toContain("admin_secret")
    expect(mocks.exportStateUpdate).toHaveBeenCalledWith({
      data: {
        dataExportedAt: { serverDate: true },
        dataExportedBy: "admin_openid",
        updatedAt: { serverDate: true }
      }
    })

    const auditData = mocks.auditAdd.mock.calls[0][0].data
    expect(auditData).toMatchObject({
      openid: "admin_openid",
      action: "privacyRequestDataExportCsv",
      requestId: "request_export",
      bookingCount: 1,
      favoriteCount: 1,
      privacyRequestCount: 1,
      partial: false
    })
    expect(JSON.stringify(auditData)).not.toContain("user_openid")
    expect(JSON.stringify(auditData)).not.toContain("13800000000")
    expect(JSON.stringify(auditData)).not.toContain("+cmd")
  })

  test("更正和删除申请不可导出个人数据", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      request: {
        _id: "request_correction",
        openid: "user_openid",
        type: "correction",
        status: "processing"
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      requestId: "request_correction",
      mode: "export"
    })

    expect(res).toEqual({
      ok: false,
      code: "REQUEST_TYPE_NOT_EXPORTABLE",
      message: "仅查询信息申请可导出个人数据"
    })
    expect(mocks.bookingsWhere).not.toHaveBeenCalled()
    expect(mocks.favoritesWhere).not.toHaveBeenCalled()
    expect(mocks.requestsWhere).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("单个集合不可用时保留其他分类并标记为部分结果", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", roles: ["admin"] }],
      request: {
        _id: "request_2",
        openid: "user_openid",
        type: "deletion",
        status: "pending"
      },
      bookings: [{ _id: "booking_1", openid: "user_openid" }],
      unavailable: ["favorites"]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({ requestId: "request_2" })

    expect(res.ok).toBe(true)
    expect(res.partial).toBe(true)
    expect(res.unavailable).toEqual(["favorites"])
    expect(res.categories.bookings.count).toBe(1)
    expect(res.categories.favorites.count).toBe(0)
    expect(mocks.auditAdd.mock.calls[0][0].data.partial).toBe(true)
    warnSpy.mockRestore()
  })

  test("普通用户不可核验其他用户数据", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "user_openid", role: "user" }],
      request: {
        _id: "request_1",
        openid: "subject_openid"
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({ requestId: "request_1" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.requestGet).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("单类记录超过 200 条时标记清单不完整", async () => {
    const bookings = Array.from({ length: 201 }, (_, index) => ({
      _id: `booking_${index}`,
      openid: "user_openid",
      createdAt: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`
    }))
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      request: {
        _id: "request_large",
        openid: "user_openid",
        type: "access",
        status: "processing"
      },
      bookings
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({ requestId: "request_large" })

    expect(res.ok).toBe(true)
    expect(res.partial).toBe(true)
    expect(res.truncated).toEqual(["bookings"])
    expect(res.categories.bookings.count).toBe(200)
    expect(res.categories.bookings.truncated).toBe(true)
    expect(mocks.auditAdd.mock.calls[0][0].data.partial).toBe(true)
  })

  test("清单不完整时拒绝生成残缺 CSV", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      request: {
        _id: "request_partial",
        openid: "user_openid",
        type: "access",
        status: "processing"
      },
      unavailable: ["favorites"]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      requestId: "request_partial",
      mode: "export"
    })

    expect(res).toEqual({
      ok: false,
      code: "INVENTORY_INCOMPLETE",
      message: "相关数据不完整，暂不能导出"
    })
    expect(mocks.auditAdd).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test("申请不存在时不读取用户数据", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      request: null
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({ requestId: "missing_request" })

    expect(res).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "隐私申请不存在"
    })
    expect(mocks.bookingsWhere).not.toHaveBeenCalled()
    expect(mocks.favoritesWhere).not.toHaveBeenCalled()
    expect(mocks.requestsWhere).not.toHaveBeenCalled()
  })
})
