jest.mock("wx-server-sdk")

function loadModule({ openid, roles, events, vehicles }) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })

  const rolesGet = jest.fn().mockResolvedValue({
    data: roles.filter((item) => item.openid === openid)
  })
  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const eventOrderBy = jest.fn()
  const eventSkip = jest.fn()
  const eventField = jest.fn()
  function createEventQuery(offset) {
    const query = {
      field: jest.fn((projection) => {
        eventField(projection)
        return query
      }),
      orderBy: jest.fn((...args) => {
        eventOrderBy(...args)
        return query
      }),
      skip: jest.fn((nextOffset) => {
        eventSkip(nextOffset)
        return createEventQuery(nextOffset)
      }),
      limit: jest.fn((limitValue) => ({
        get: jest.fn().mockResolvedValue({
          data: events.slice(offset, offset + limitValue)
        })
      }))
    }
    return query
  }

  const vehicleField = jest.fn((id, projection) => ({
    get: jest.fn().mockResolvedValue({
      data: vehicles[id] || null
    })
  }))
  const vehicleDoc = jest.fn((id) => ({
    field: jest.fn((projection) => vehicleField(id, projection))
  }))

  cloud.__setMockDb({
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "analytics_events") {
        return createEventQuery(0)
      }
      if (name === "vehicles") {
        return { doc: vehicleDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  })

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/analyticsOverview/index")
  })
  return {
    mod,
    rolesWhere,
    vehicleDoc,
    vehicleField,
    eventField,
    eventOrderBy,
    eventSkip
  }
}

describe("cloudfunctions/analyticsOverview integration", () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test("运营人员可查看汇总漏斗和热门车型", async () => {
    const now = Date.now()
    const mocks = loadModule({
      openid: "ops_openid",
      roles: [{ openid: "ops_openid", permissions: ["booking_manage"] }],
      events: [
        { eventType: "garage_view", vehicleId: "", createdAt: new Date(now - 1000) },
        { eventType: "vehicle_detail", vehicleId: "vehicle_1", createdAt: new Date(now - 900) },
        { eventType: "vehicle_detail", vehicleId: "vehicle_1", createdAt: new Date(now - 800) },
        { eventType: "booking_start", vehicleId: "vehicle_1", createdAt: new Date(now - 700) },
        { eventType: "booking_submit", vehicleId: "vehicle_1", createdAt: new Date(now - 600) },
        { eventType: "favorite_add", vehicleId: "vehicle_1", createdAt: new Date(now - 500) }
      ],
      vehicles: {
        vehicle_1: {
          _id: "vehicle_1",
          brandModel: "BMW M4",
          vin: "NOT_RETURNED"
        }
      }
    })

    const res = await mocks.mod.main({ days: 7 })

    expect(res.ok).toBe(true)
    expect(mocks.eventField).toHaveBeenCalledWith({
      eventType: true,
      vehicleId: true,
      createdAt: true
    })
    expect(res.metrics).toEqual({
      garage_view: 1,
      vehicle_detail: 2,
      booking_start: 1,
      booking_submit: 1,
      favorite_add: 1
    })
    expect(res.conversionRate).toBe(50)
    expect(res.topVehicles[0]).toEqual(
      expect.objectContaining({
        vehicleId: "vehicle_1",
        name: "BMW M4",
        detailViews: 2,
        bookingStarts: 1,
        bookingSubmits: 1,
        favorites: 1
      })
    )
    expect(res.topVehicles[0]).not.toHaveProperty("vin")
    expect(mocks.vehicleField).toHaveBeenCalledWith("vehicle_1", {
      brandModel: true
    })
    expect(res.trend).toHaveLength(7)
  })

  test("普通用户不可读取分析结果", async () => {
    const mocks = loadModule({
      openid: "user_openid",
      roles: [{ openid: "user_openid", role: "member" }],
      events: [],
      vehicles: {}
    })

    const res = await mocks.mod.main({ days: 30 })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.vehicleDoc).not.toHaveBeenCalled()
  })

  test("每日趋势按中国标准时间归属自然日", async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-07-29T16:30:00.000Z"))
    const mocks = loadModule({
      openid: "admin_openid",
      roles: [{ openid: "admin_openid", role: "admin" }],
      events: [
        {
          eventType: "garage_view",
          vehicleId: "",
          createdAt: new Date("2026-07-29T15:59:00.000Z")
        },
        {
          eventType: "vehicle_detail",
          vehicleId: "vehicle_1",
          createdAt: new Date("2026-07-29T16:01:00.000Z")
        }
      ],
      vehicles: {
        vehicle_1: { brandModel: "测试车辆" }
      }
    })

    const res = await mocks.mod.main({ days: 7 })

    expect(res.ok).toBe(true)
    expect(res.trend).toHaveLength(7)
    expect(res.trend[5]).toEqual({
      key: "2026-07-29",
      label: "07-29",
      value: 1
    })
    expect(res.trend[6]).toEqual({
      key: "2026-07-30",
      label: "07-30",
      value: 1
    })
  })

  test("超过单批上限时继续分批读取", async () => {
    const now = Date.now()
    const events = Array.from({ length: 250 }, (_, index) => ({
      eventType: "garage_view",
      vehicleId: "",
      createdAt: new Date(now - index * 1000)
    }))
    const mocks = loadModule({
      openid: "admin_openid",
      roles: [{ openid: "admin_openid", role: "admin" }],
      events,
      vehicles: {}
    })

    const res = await mocks.mod.main({ days: 7 })

    expect(res.ok).toBe(true)
    expect(res.metrics.garage_view).toBe(250)
    expect(mocks.eventOrderBy).toHaveBeenCalledWith("createdAt", "desc")
    expect(mocks.eventSkip).toHaveBeenCalledWith(100)
    expect(mocks.eventSkip).toHaveBeenCalledWith(200)
  })
})
