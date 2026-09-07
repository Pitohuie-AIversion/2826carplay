jest.mock("wx-server-sdk")

function loadModule({ openid, roles, events, vehicles, contentGuides }) {
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

  const contentField = jest.fn((id, projection) => ({
    get: jest.fn().mockResolvedValue({
      data: (contentGuides && contentGuides[id]) || null
    })
  }))
  const contentDoc = jest.fn((id) => ({
    field: jest.fn((projection) => contentField(id, projection))
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
      if (name === "content_guides") {
        return { doc: contentDoc }
      }
      if (name === "bookings" || name === "booking_quotes") {
        const query = {
          field: jest.fn(() => query),
          skip: jest.fn(() => query),
          limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ data: [] }) }))
        }
        return query
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
    contentDoc,
    contentField,
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
        { eventType: "pricing_view", vehicleId: "vehicle_1", createdAt: new Date(now - 750) },
        { eventType: "rental_rules_view", vehicleId: "vehicle_1", createdAt: new Date(now - 725) },
        { eventType: "trusted_profile_view", vehicleId: "vehicle_1", createdAt: new Date(now - 715) },
        { eventType: "phone_call", vehicleId: "vehicle_1", createdAt: new Date(now - 710) },
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
      contentId: true,
      channel: true,
      scene: true,
      createdAt: true
    })
    expect(res.metrics).toEqual({
      garage_view: 1,
      vehicle_detail: 2,
      booking_start: 1,
      booking_submit: 1,
      favorite_add: 1,
      pricing_view: 1,
      rental_rules_view: 1,
      trusted_profile_view: 1,
      phone_call: 1,
      share: 0,
      availability_available: 0,
      availability_conflict: 0,
      availability_shortage: 0,
      price_change_view: 0,
      availability_unknown: 0,
      content_view: 0,
      content_vehicle_click: 0,
      share_open: 0,
      content_booking_start: 0,
      content_booking_submit: 0,
      content_booking_confirmed: 0
    })
    expect(res.conversionRate).toBe(50)
    expect(res.topVehicles[0]).toEqual(
      expect.objectContaining({
        vehicleId: "vehicle_1",
        name: "BMW M4",
        detailViews: 2,
        bookingStarts: 1,
        bookingSubmits: 1,
        favorites: 1,
        pricingViews: 1,
        rentalRuleViews: 1,
        trustProfileViews: 1
      })
    )
    expect(res.trustProfileMetrics).toEqual({
      profileViews: 1,
      phoneConsultations: 1,
      bookingStarts: 1,
      phoneConsultationRate: 100,
      bookingStartRate: 100
    })
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

  test("内容归因按内容、车辆和来源汇总到确认预约", async () => {
    const now = Date.now()
    const base = { contentId: "guide_1", vehicleId: "vehicle_1", channel: "wechat_share", scene: "weekend_trip" }
    const mocks = loadModule({
      openid: "admin_openid",
      roles: [{ openid: "admin_openid", role: "admin" }],
      events: [
        { ...base, eventType: "content_view", createdAt: new Date(now - 500) },
        { ...base, eventType: "share_open", createdAt: new Date(now - 400) },
        { ...base, eventType: "content_booking_submit", createdAt: new Date(now - 300) },
        { ...base, eventType: "content_booking_confirmed", createdAt: new Date(now - 200) }
      ],
      vehicles: { vehicle_1: { brandModel: "Test Car" } },
      contentGuides: {
        guide_1: { _id: "guide_1", slug: "g1", title: "周末短途准备清单", contentType: "guide" }
      }
    })
    const res = await mocks.mod.main({ days: 7, topN: 5 })
    expect(res.topN).toBe(5)
    expect(res.contentAnalytics).toMatchObject({
      views: 1,
      shareOpens: 1,
      bookingSubmits: 1,
      confirmedBookings: 1,
      bookingConversionRate: 100,
      confirmedConversionRate: 100
    })
    expect(res.contentAnalytics.topContents[0]).toMatchObject({
      key: "guide_1",
      confirmed: 1,
      title: "周末短途准备清单",
      contentType: "guide"
    })
    expect(mocks.contentField).toHaveBeenCalledWith("guide_1", { slug: true, title: true, contentType: true })
    expect(res.contentAnalytics.topVehicles[0]).toMatchObject({ key: "vehicle_1", bookingSubmits: 1 })
    expect(res.contentAnalytics.topSources[0]).toMatchObject({ channel: "wechat_share", scene: "weekend_trip", confirmed: 1 })
    expect(res.contentTrend).toHaveLength(7)
    expect(res.contentTrend[6]).toMatchObject({
      key: expect.any(String),
      views: 1,
      vehicleClicks: 0,
      submits: 1,
      confirmed: 1,
      total: 3
    })
  })

  test("TOP N 默认 3，合法值 5/10 生效，非法值回退 3；内容下架时返回占位标题", async () => {
    const now = Date.now()
    const sourceTriples = [
      { channel: "qr", scene: "business_reception" },
      { channel: "wechat_share", scene: "weekend_trip" },
      { channel: "official_account", scene: "ev_experience" }
    ]
    const buildEvents = (prefix, count) =>
      Array.from({ length: count }, (_, i) => {
        const src = sourceTriples[i % sourceTriples.length]
        return {
          contentId: `${prefix}_${i}`,
          vehicleId: `v_${i}`,
          channel: src.channel,
          scene: src.scene,
          eventType: "content_view",
          createdAt: new Date(now - (100 + i) * 1000)
        }
      })
    const events = [
      ...buildEvents("c", 8),
      ...Array.from({ length: 5 }, (_, i) => {
        const src = sourceTriples[i % sourceTriples.length]
        return {
          contentId: "c_0",
          vehicleId: `v_${i}`,
          channel: src.channel,
          scene: src.scene,
          eventType: "content_vehicle_click",
          createdAt: new Date(now - (200 + i) * 1000)
        }
      })
    ]
    const vehicles = {}
    for (let i = 0; i < 8; i += 1) {
      vehicles[`v_${i}`] = { brandModel: `车辆${i}` }
    }
    const mocks = loadModule({
      openid: "admin_openid",
      roles: [{ openid: "admin_openid", role: "admin" }],
      events,
      vehicles,
      contentGuides: {}
    })
    const defaultRes = await mocks.mod.main({ days: 7 })
    expect(defaultRes.topN).toBe(3)
    expect(defaultRes.contentAnalytics.topContents).toHaveLength(3)
    expect(defaultRes.contentAnalytics.topContents[0].title).toBe("已下架或未发布内容")
    expect(defaultRes.contentAnalytics.topContents[0].contentType).toBe("")

    const top5Res = await mocks.mod.main({ days: 7, topN: 5 })
    expect(top5Res.topN).toBe(5)
    expect(top5Res.contentAnalytics.topContents).toHaveLength(5)
    expect(top5Res.topVehicles).toHaveLength(5)
    expect(top5Res.contentAnalytics.topSources.length).toBeGreaterThanOrEqual(3)

    const top10Res = await mocks.mod.main({ days: 7, topN: 10 })
    expect(top10Res.topN).toBe(10)
    expect(top10Res.contentAnalytics.topContents).toHaveLength(8)

    const invalidRes = await mocks.mod.main({ days: 7, topN: 7 })
    expect(invalidRes.topN).toBe(3)
    expect(invalidRes.contentAnalytics.topContents).toHaveLength(3)
  })

  test("内容每日趋势长度与 days 参数对齐，30 天 30 条，每日四字段齐全，峰值正确标记", async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-08-05T08:00:00.000Z"))
    const events = [
      { contentId: "c1", eventType: "content_view", createdAt: new Date("2026-08-03T01:00:00.000Z") },
      { contentId: "c1", eventType: "content_view", createdAt: new Date("2026-08-03T12:00:00.000Z") },
      { contentId: "c1", eventType: "content_vehicle_click", createdAt: new Date("2026-08-03T12:10:00.000Z") },
      { contentId: "c1", eventType: "content_view", createdAt: new Date("2026-08-04T00:30:00.000Z") },
      { contentId: "c2", eventType: "content_booking_submit", createdAt: new Date("2026-08-04T10:50:00.000Z") },
      { contentId: "c2", eventType: "content_booking_confirmed", createdAt: new Date("2026-08-04T13:00:00.000Z") }
    ]
    const mocks = loadModule({
      openid: "admin_openid",
      roles: [{ openid: "admin_openid", role: "admin" }],
      events,
      vehicles: {},
      contentGuides: {}
    })
    const short = await mocks.mod.main({ days: 7 })
    expect(short.contentTrend).toHaveLength(7)
    const day2 = short.contentTrend.find((item) => item.key === "2026-08-03")
    expect(day2).toMatchObject({ views: 2, vehicleClicks: 1, submits: 0, confirmed: 0, total: 3 })
    const day3 = short.contentTrend.find((item) => item.key === "2026-08-04")
    expect(day3).toMatchObject({ views: 1, vehicleClicks: 0, submits: 1, confirmed: 1, total: 3 })
    const monthLong = await mocks.mod.main({ days: 30, topN: 5 })
    expect(monthLong.contentTrend).toHaveLength(30)
    expect(monthLong.topN).toBe(5)
  })

  test("场景维度漏斗按 4 枚举分桶并计算浏览→预约→确认三档转化率", async () => {
    const now = Date.now()
    const buildEvent = (scene, eventType) => ({
      contentId: `guide_${scene}_01`,
      vehicleId: "car_scene_1",
      channel: scene === "ev_experience" ? "qr" : "wechat_share",
      scene,
      eventType,
      createdAt: new Date(now - 1000)
    })
    const events = [
      ...Array.from({ length: 100 }, () => buildEvent("weekend_trip", "content_view")),
      ...Array.from({ length: 30 }, () => buildEvent("weekend_trip", "share_open")),
      ...Array.from({ length: 20 }, () => buildEvent("weekend_trip", "content_vehicle_click")),
      ...Array.from({ length: 15 }, () => buildEvent("weekend_trip", "content_booking_start")),
      ...Array.from({ length: 10 }, () => buildEvent("weekend_trip", "content_booking_submit")),
      ...Array.from({ length: 3 }, () => buildEvent("weekend_trip", "content_booking_confirmed")),
      ...Array.from({ length: 50 }, () => buildEvent("business_reception", "content_view")),
      ...Array.from({ length: 5 }, () => buildEvent("business_reception", "content_booking_submit")),
      ...Array.from({ length: 2 }, () => buildEvent("business_reception", "content_booking_confirmed")),
      buildEvent("handover_tips", "content_view"),
      buildEvent("../bad_scene", "content_view")
    ]
    const mocks = loadModule({
      openid: "admin_openid",
      roles: [{ openid: "admin_openid", role: "admin" }],
      events,
      vehicles: {},
      contentGuides: {}
    })
    const res = await mocks.mod.main({ days: 7 })
    expect(res.ok).toBe(true)
    expect(Array.isArray(res.sceneFunnels)).toBe(true)
    expect(res.sceneFunnels).toHaveLength(4)
    const weekend = res.sceneFunnels.find((item) => item.scene === "weekend_trip")
    expect(weekend).toMatchObject({
      views: 100,
      shareOpens: 30,
      vehicleClicks: 20,
      bookingStarts: 15,
      bookingSubmits: 10,
      confirmed: 3,
      viewToSubmitRate: 10,
      submitToConfirmRate: 30,
      viewToConfirmRate: 3
    })
    const business = res.sceneFunnels.find((item) => item.scene === "business_reception")
    expect(business).toMatchObject({ views: 50, bookingSubmits: 5, confirmed: 2, viewToConfirmRate: 4 })
    const group = res.sceneFunnels.find((item) => item.scene === "group_travel")
    expect(group).toMatchObject({ views: 0, bookingSubmits: 0, confirmed: 0, viewToSubmitRate: 0, submitToConfirmRate: 0, viewToConfirmRate: 0 })
    const ev = res.sceneFunnels.find((item) => item.scene === "ev_experience")
    expect(ev).toMatchObject({ views: 0 })
    res.sceneFunnels.forEach((item) => {
      expect(["weekend_trip", "business_reception", "group_travel", "ev_experience"]).toContain(item.scene)
      expect(item).not.toHaveProperty("handover_tips")
    })
  })
})
