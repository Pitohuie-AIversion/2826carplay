jest.mock("wx-server-sdk")

function buildLoadModuleContext({ openid, roles, events }) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })

  const rolesGet = jest.fn().mockResolvedValue({
    data: roles.filter((item) => item.openid === openid)
  })
  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))
  const rolesWhereCaptures = []
  const rolesWhereWithCapture = jest.fn((filter) => {
    rolesWhereCaptures.push({ openid: filter.openid })
    return { limit: rolesLimit }
  })

  const eventFieldCaptures = []
  const eventOrderBy = jest.fn()
  function createEventQuery(offset) {
    const query = {
      field: jest.fn((projection) => {
        eventFieldCaptures.push(projection)
        return query
      }),
      orderBy: jest.fn((...args) => {
        eventOrderBy(...args)
        return query
      }),
      skip: jest.fn(() => createEventQuery(offset + 100)),
      limit: jest.fn((limitValue) => ({
        get: jest.fn().mockResolvedValue({
          data: events.slice(offset, offset + limitValue)
        })
      }))
    }
    return query
  }

  const vehicleDoc = jest.fn((id) => ({
    field: jest.fn((projection) => ({
      get: jest.fn().mockResolvedValue({
        data: id ? { brandModel: "示例车型" } : null
      })
    }))
  }))
  const contentDoc = jest.fn((id) => ({
    field: jest.fn((projection) => ({
      get: jest.fn().mockResolvedValue({
        data: id ? { slug: "demo-slug", title: "示例标题", contentType: "guide" } : null
      })
    }))
  }))
  const emptyQuery = () => {
    const query = {
      field: jest.fn(() => query),
      skip: jest.fn(() => query),
      limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ data: [] }) }))
    }
    return query
  }
  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") return { where: rolesWhereWithCapture }
      if (name === "analytics_events") return createEventQuery(0)
      if (name === "vehicles") return { doc: vehicleDoc }
      if (name === "content_guides") return { doc: contentDoc }
      if (name === "bookings" || name === "booking_quotes") return emptyQuery()
      throw new Error(`Unexpected collection ${name}`)
    }),
    serverDate: jest.fn(() => ({ __type: "serverDate" }))
  }
  cloud.__setMockDb(db)
  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/analyticsOverview/index.js")
  })
  return {
    mod,
    cloud,
    rolesWhereWithCapture,
    rolesWhereCaptures,
    vehicleDoc,
    contentDoc,
    eventOrderBy,
    eventFieldCaptures
  }
}

function buildEvents(now) {
  const baseEvents = []
  const eventTypes = ["content_view", "share_open", "content_vehicle_click", "content_booking_start", "content_booking_submit", "content_booking_confirmed"]
  for (let i = 0; i < 120; i++) {
    baseEvents.push({
      eventType: eventTypes[i % eventTypes.length],
      vehicleId: `V${i % 8}`,
      contentId: `C-${i % 6}`,
      channel: (i % 2) ? "wechat_share" : "direct",
      scene: (i % 5) === 0 ? "" : ["weekend_trip", "business_reception", "group_travel", "ev_experience"][i % 4],
      createdAt: new Date(now - (i * 60 * 1000))
    })
  }
  return baseEvents
}

describe("A2 analyticsOverview 权限边界（双账号）", () => {
  test("A2-1 普通用户（无 admin role / 无 booking_manage 权限）调用 → ok=false code=FORBIDDEN，绝不查询 analytics_events", async () => {
    const now = Date.now()
    const events = buildEvents(now)
    const { mod, eventFieldCaptures, rolesWhereCaptures } = buildLoadModuleContext({
      openid: "normal_user_openid_acceptance",
      roles: [{ openid: "admin_openid_acceptance", role: "admin" }],
      events
    })
    const res = await mod.main({ days: 7 })
    expect(res).toEqual({ ok: false, code: "FORBIDDEN", message: "权限不足" })
    expect(eventFieldCaptures).toHaveLength(0)
    expect(rolesWhereCaptures.map((c) => c.openid)).toEqual(["normal_user_openid_acceptance"])
  })

  test("A2-2 管理员（role=admin）调用 → ok=true，返回 sceneFunnels 4 桶 + contentAnalytics.topSources 存在 channel/scene 归因", async () => {
    const now = Date.now()
    const events = buildEvents(now)
    const { mod } = buildLoadModuleContext({
      openid: "admin_openid_acceptance",
      roles: [{ openid: "admin_openid_acceptance", role: "admin" }],
      events
    })
    const res = await mod.main({ days: 7 })
    expect(res.ok).toBe(true)
    expect(res.sceneFunnels).toHaveLength(4)
    const scenes = res.sceneFunnels.map((item) => item.scene)
    expect(scenes).toEqual(["weekend_trip", "business_reception", "group_travel", "ev_experience"])
    res.sceneFunnels.forEach((item) => {
      expect(item).toHaveProperty("views")
      expect(item).toHaveProperty("shareOpens")
      expect(item).toHaveProperty("vehicleClicks")
      expect(item).toHaveProperty("bookingStarts")
      expect(item).toHaveProperty("bookingSubmits")
      expect(item).toHaveProperty("confirmed")
      expect(item).toHaveProperty("viewToSubmitRate")
      expect(item).toHaveProperty("submitToConfirmRate")
      expect(item).toHaveProperty("viewToConfirmRate")
    })
    expect(Array.isArray(res.contentAnalytics.topSources)).toBe(true)
    expect(res.contentAnalytics.topSources.length > 0).toBe(true)
    res.contentAnalytics.topSources.forEach((item) => {
      expect(typeof item.channel).toBe("string")
      expect(["direct", "wechat_share", "moments", "qr", "official_account", "campaign", ""].includes(item.channel)).toBe(true)
    })
  })

  test("A2-3 roles.where 返回空数组（未知 openid）→ FORBIDDEN，绝不访问 analytics_events 或 bookings 集合", async () => {
    const { mod, eventFieldCaptures, vehicleDoc, contentDoc } = buildLoadModuleContext({
      openid: "ghost_openid_no_role",
      roles: [],
      events: buildEvents(Date.now())
    })
    const res = await mod.main({ days: 30, topN: 5 })
    expect(res).toEqual({ ok: false, code: "FORBIDDEN", message: "权限不足" })
    expect(eventFieldCaptures).toHaveLength(0)
    expect(vehicleDoc).not.toHaveBeenCalled()
    expect(contentDoc).not.toHaveBeenCalled()
  })

  test("A2-4 运营权限（permissions=[\"booking_manage\"] 非 admin role）同样可查看 analyticsOverview，sceneFunnels 依旧返回 4 桶", async () => {
    const now = Date.now()
    const { mod } = buildLoadModuleContext({
      openid: "ops_booking_manager_openid_acceptance",
      roles: [{ openid: "ops_booking_manager_openid_acceptance", permissions: ["booking_manage"] }],
      events: buildEvents(now)
    })
    const res = await mod.main({ days: 7, topN: 3 })
    expect(res.ok).toBe(true)
    expect(res.days).toBe(7)
    expect(res.topN).toBe(3)
    expect(res.sceneFunnels).toHaveLength(4)
    expect(res.sceneFunnels[0].scene).toBe("weekend_trip")
    expect(typeof res.conversionRate).toBe("number")
    expect(res.truncated === false || res.truncated === true).toBe(true)
  })
})
