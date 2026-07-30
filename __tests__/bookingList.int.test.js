jest.mock("wx-server-sdk")

function createMockDb({ rolesData, bookingData, orderedError = null }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const bookingsLimit = jest.fn((limitValue) => ({
    get: jest.fn().mockResolvedValue({ data: bookingData.slice(0, limitValue) })
  }))
  const bookingsSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({ data: bookingData.slice(offset, offset + limitValue) })
    }))
  }))
  const bookingsOrderedSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: orderedError
        ? jest.fn().mockRejectedValue(orderedError)
        : jest.fn().mockResolvedValue({ data: bookingData.slice(offset, offset + limitValue) })
    }))
  }))
  const bookingsOrderBy = jest.fn(() => ({ skip: bookingsOrderedSkip }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return {
          limit: bookingsLimit,
          skip: bookingsSkip,
          orderBy: bookingsOrderBy
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    rolesLimit,
    bookingsLimit,
    bookingsSkip,
    bookingsOrderBy,
    bookingsOrderedSkip
  }
}

async function loadBookingListWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingList/index")
  })

  return mod
}

describe("cloudfunctions/bookingList integration", () => {
  test("admin 可按状态筛选", async () => {
    const now = Date.now()
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: [
        {
          _id: "b1",
          vehicleName: "MX-5",
          userName: "张三",
          phone: "13800000000",
          city: "杭州",
          adminRemark: "已联系，周末到店",
          status: "pending",
          createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          _id: "b2",
          vehicleName: "S2000",
          userName: "李四",
          phone: "13900000000",
          city: "上海",
          status: "completed",
          createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString()
        }
      ]
    })

    const mod = await loadBookingListWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({ status: "completed", keyword: "" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].id).toBe("b2")
    expect(res.dashboard).toEqual({
      total: 2,
      pending: 1,
      contacted: 0,
      completed: 1,
      cancelled: 0,
      recentCreated7d: 1
    })
    expect(res.recentCreatedList).toEqual([
      {
        id: "b1",
        vehicleName: "MX-5",
        userName: "张三",
        city: "杭州",
        startDate: "",
        endDate: "",
        status: "pending",
        createdAt: expect.any(String)
      }
    ])
  })

  test("关键词可命中管理员备注", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: [
        {
          _id: "b1",
          vehicleName: "MX-5",
          adminRemark: "客户周末到店",
          status: "pending",
          createdAt: "2026-07-13T00:00:00.000Z"
        }
      ]
    })

    const mod = await loadBookingListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "all", keyword: "到店" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].adminRemark).toBe("客户周末到店")
  })

  test("booking_manager 可查询预约列表", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "booking_manager" }],
      bookingData: [
        {
          _id: "b1",
          vehicleName: "MX-5",
          status: "pending",
          createdAt: "2026-07-13T00:00:00.000Z"
        }
      ]
    })

    const mod = await loadBookingListWith({ openid: "booking_manager_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "all" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].id).toBe("b1")
  })

  test("非法状态筛选返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: []
    })

    const mod = await loadBookingListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "invalid_status" })

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.bookingsOrderBy).not.toHaveBeenCalled()
  })

  test("非管理员查询返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      bookingData: []
    })

    const mod = await loadBookingListWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "all" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.bookingsOrderBy).not.toHaveBeenCalled()
  })

  test("超过 500 条后仍可读取后续预约分页", async () => {
    const bookingData = Array.from({ length: 550 }, (_, index) => ({
      _id: `b${index}`,
      vehicleName: `Vehicle ${index}`,
      userName: `User ${index}`,
      status: "pending",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    }))
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData
    })
    const mod = await loadBookingListWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({
      status: "all",
      limit: 2000,
      page: 27,
      pageSize: 20
    })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(550)
    expect(res.list).toHaveLength(10)
    expect(res.hasMore).toBe(false)
    expect(res.truncated).toBe(false)
    expect(mocks.bookingsOrderedSkip).toHaveBeenCalledWith(500)
  })

  test("缺少 createdAt 索引时自动降级读取", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: [
        {
          _id: "b1",
          vehicleName: "MX-5",
          status: "pending",
          createdAt: "2026-07-13T00:00:00.000Z"
        }
      ],
      orderedError: new Error("missing createdAt index")
    })
    const mod = await loadBookingListWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({ status: "all", limit: 2000 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(mocks.bookingsOrderedSkip).toHaveBeenCalledWith(0)
    expect(mocks.bookingsSkip).toHaveBeenCalledWith(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test("可组合筛选候补与协调中预约，历史记录使用安全默认值", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "booking_manager" }],
      bookingData: [
        {
          _id: "b_standby",
          vehicleName: "MX-5",
          status: "contacted",
          schedulePriority: "standby",
          coordinationStatus: "coordinating",
          createdAt: "2026-07-15T00:00:00.000Z"
        },
        {
          _id: "b_legacy",
          vehicleName: "S2000",
          status: "pending",
          createdAt: "2026-07-14T00:00:00.000Z"
        },
        {
          _id: "b_completed",
          vehicleName: "M4",
          status: "completed",
          createdAt: "2026-07-13T00:00:00.000Z"
        }
      ]
    })
    const mod = await loadBookingListWith({
      openid: "booking_manager_openid",
      mockDb: mocks.db
    })

    const standby = await mod.main({
      status: "all",
      schedulePriority: "standby",
      coordinationStatus: "coordinating"
    })
    expect(standby.list.map((item) => item.id)).toEqual(["b_standby"])

    const legacy = await mod.main({
      status: "pending",
      schedulePriority: "normal",
      coordinationStatus: "pending"
    })
    expect(legacy.list.map((item) => item.id)).toEqual(["b_legacy"])

    const completed = await mod.main({
      status: "completed",
      coordinationStatus: "resolved"
    })
    expect(completed.list.map((item) => item.id)).toEqual(["b_completed"])
  })

  test("非法优先级或协调状态返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: []
    })
    const mod = await loadBookingListWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    expect((await mod.main({ schedulePriority: "top" })).code).toBe("VALIDATION_ERROR")
    expect((await mod.main({ coordinationStatus: "unknown" })).code).toBe("VALIDATION_ERROR")
  })
})
