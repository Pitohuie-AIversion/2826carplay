jest.mock("wx-server-sdk")

function createMockDb({ rolesData, bookingData }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const bookingsGet = jest.fn().mockResolvedValue({ data: bookingData })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const bookingsLimit = jest.fn(() => ({ get: bookingsGet }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return { limit: bookingsLimit }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    rolesLimit,
    bookingsLimit,
    bookingsGet
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
    expect(mocks.bookingsLimit).not.toHaveBeenCalled()
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
    expect(mocks.bookingsLimit).not.toHaveBeenCalled()
  })
})
