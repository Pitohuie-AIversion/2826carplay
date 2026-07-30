jest.mock("wx-server-sdk")

function createPagedWhere(records, error) {
  const where = jest.fn(() => ({
    skip: jest.fn((offset) => ({
      limit: jest.fn((limit) => ({
        get: error
          ? jest.fn().mockRejectedValue(error)
          : jest.fn().mockResolvedValue({
              data: records.slice(offset, offset + limit)
            })
      }))
    }))
  }))
  return where
}

function createMockDb({
  roles,
  request,
  bookings = [],
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
  const requestsWhere = createPagedWhere(
    privacyRequests,
    unavailable.includes("privacy_requests") ? new Error("collection not found") : null
  )
  const requestGet = request
    ? jest.fn().mockResolvedValue({ data: request })
    : jest.fn().mockRejectedValue(new Error("document not found"))
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
    if (name === "privacy_requests") {
      return {
        doc: jest.fn(() => ({ get: requestGet })),
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
    expect(res.categories.bookings.list[0]).toMatchObject({
      id: "booking_1",
      userName: "用户甲",
      phone: "13800000000"
    })
    expect(res.categories.bookings.list[0].handledBy).toBeUndefined()
    expect(res.categories.privacyRequests.list[0].handledBy).toBeUndefined()
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
