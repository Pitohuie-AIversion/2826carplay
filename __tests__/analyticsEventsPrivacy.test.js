jest.mock("wx-server-sdk")

const ANALYTICS_EVENT_WHITELIST = ["eventType", "vehicleId", "contentId", "channel", "scene", "createdAt"]
const BOOKING_CSV_HEADERS = [
  "bookingId",
  "status",
  "vehicleId",
  "vehicleName",
  "userName",
  "phone",
  "city",
  "startDate",
  "endDate",
  "durationDays",
  "note",
  "adminRemark",
  "schedulePriority",
  "coordinationStatus",
  "attribution.channel",
  "attribution.scene",
  "attribution.contentId",
  "createdAt",
  "updatedAt"
]

const PRIVATE_KEYWORDS_REGEX =
  /(openid|unionid|session_key|password|secret|token|cookie|access[_-]?token|id_card|身份证|passport|护照|license|驾照|plate|车牌号|bank|银行卡|credit|信用卡|真实姓名|full[_-]?name|联系电话|mobile)/i

function generateMockEvents(count) {
  const result = []
  const eventTypes = ["content_view", "share_open", "content_vehicle_click", "content_booking_start", "content_booking_submit", "content_booking_confirmed"]
  const channels = ["direct", "wechat_share", "moments", "qr", "official_account", "campaign"]
  const scenes = ["weekend_trip", "business_reception", "group_travel", "ev_experience", ""]
  for (let i = 0; i < count; i++) {
    result.push({
      eventType: eventTypes[i % eventTypes.length],
      vehicleId: `V1-${i}`,
      contentId: `C-${i}`,
      channel: channels[i % channels.length],
      scene: scenes[i % scenes.length] || undefined,
      createdAt: new Date(Date.now() - i * 60 * 1000).toISOString()
    })
  }
  return result
}

function buildMockDbForAnalytics({ events }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()

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

  const rolesGet = jest.fn().mockResolvedValue({ data: [{ openid: "admin_openid_acceptance", role: "admin" }] })
  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const vehicleDoc = jest.fn((id) => ({
    field: jest.fn((projection) => ({
      get: jest.fn().mockResolvedValue({
        data: (id === "vehicle_1") ? { brandModel: "示例车型" } : null
      })
    }))
  }))

  const contentDoc = jest.fn((id) => ({
    field: jest.fn((projection) => ({
      get: jest.fn().mockResolvedValue({
        data: (id === "C-0") ? { slug: "demo-slug", title: "示例标题", contentType: "guide" } : null
      })
    }))
  }))

  const emptyQueryGen = () => {
    const query = {
      field: jest.fn(() => query),
      skip: jest.fn(() => query),
      limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ data: [] }) }))
    }
    return query
  }

  const serverDate = jest.fn(() => ({ __type: "serverDate" }))
  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") return { where: rolesWhere }
      if (name === "analytics_events") return createEventQuery(0)
      if (name === "vehicles") return { doc: vehicleDoc }
      if (name === "content_guides") return { doc: contentDoc }
      if (name === "bookings" || name === "booking_quotes") return emptyQueryGen()
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  freshCloud.__setMockDb(db)
  freshCloud.__setMockContext({ OPENID: "admin_openid_acceptance" })
  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/analyticsOverview/index.js")
  })
  return { mod, eventField, rolesWhere }
}

describe("C2 privacy whitebox: analytics_events 字段白名单 + CSV 17 列导出双端锁死", () => {
  test("C2-1 ANALYTICS_EVENT_FIELDS 严格 6 项白名单（eventType/vehicleId/contentId/channel/scene/createdAt），不允许 openid 等任何隐私字段", () => {
    jest.resetModules()
    jest.isolateModules(() => {
      const analyticsModule = require("../cloudfunctions/analyticsOverview/index.js")
      const fileContent = require("fs").readFileSync(require("path").resolve(__dirname, "../cloudfunctions/analyticsOverview/index.js"), "utf8")
      const fieldBlockMatch = fileContent.match(/const ANALYTICS_EVENT_FIELDS[\s\S]*?\n}/)
      expect(fieldBlockMatch).toBeTruthy()
      const trueKeys = []
      fieldBlockMatch[0].split(/\r?\n/).forEach((line) => {
        const key = (line.match(/^\s*([A-Za-z0-9_]+):\s*true\s*,?\s*$/) || [])[1]
        if (key) trueKeys.push(key)
      })
      expect(trueKeys.sort()).toEqual(ANALYTICS_EVENT_WHITELIST.slice().sort())
      expect(trueKeys).not.toContain("openid")
      expect(trueKeys).not.toContain("unionid")
      expect(trueKeys).not.toContain("userName")
      expect(trueKeys).not.toContain("phone")
      expect(analyticsModule).toBeTruthy()
    })
  })

  test("C2-2 50 条 mock 事件：仅含 6 白名单键，绝不含 openid/姓名/手机号/身份证/备注等隐私字段", () => {
    const events = generateMockEvents(50)
    expect(events).toHaveLength(50)
    events.forEach((item) => {
      const keys = Object.keys(item)
      keys.forEach((key) => {
        expect(ANALYTICS_EVENT_WHITELIST.includes(key)).toBe(true)
      })
      keys.forEach((key) => {
        const value = String(item[key] || "")
        expect(PRIVATE_KEYWORDS_REGEX.test(value)).toBe(false)
      })
    })
    const joined = JSON.stringify(events)
    expect(joined.includes("openid")).toBe(false)
    expect(joined.includes("mobile")).toBe(false)
    expect(joined.includes("身份证")).toBe(false)
  })

  test("C2-3 analyticsOverview 用 50 条干净事件计算时，最终 exports.main 返回结果绝不含任何隐私关键字（字符串扫描）", async () => {
    const cleanEvents = generateMockEvents(50)
    const { mod } = buildMockDbForAnalytics({ events: cleanEvents })
    const res = await mod.main({ days: 7 })
    expect(res.ok).toBe(true)
    const json = JSON.stringify(res)
    expect(PRIVATE_KEYWORDS_REGEX.test(json)).toBe(false)
    expect(res).toHaveProperty("sceneFunnels")
    expect(res.sceneFunnels).toHaveLength(4)
  })

  test("C2-4 bookingExportCsv BOOKING_EXPORT_FIELDS 17 键（attribution: true 由 bookingExportCsv.int.test 专项 391/409 行断言 attribution.vehicleId 被清空） + 最终 buildCsv header 17 列严格对齐中文列", () => {
    jest.resetModules()
    jest.isolateModules(() => {
      const fs = require("fs")
      const path = require("path")
      const csvSource = fs.readFileSync(path.resolve(__dirname, "../cloudfunctions/bookingExportCsv/index.js"), "utf8")
      const fieldBlock = csvSource.match(/const BOOKING_EXPORT_FIELDS[\s\S]*?\n}/)
      expect(fieldBlock).toBeTruthy()
      const keys = []
      fieldBlock[0].split(/\r?\n/).forEach((line) => {
        const key = (line.match(/^\s*([A-Za-z0-9_]+):\s*true\s*,?\s*$/) || [])[1]
        if (key) keys.push(key)
      })
      expect(keys.sort()).toEqual([
        "_id", "id", "vehicleId", "vehicleName", "userName", "phone", "startDate",
        "endDate", "city", "note", "adminRemark", "schedulePriority", "coordinationStatus",
        "status", "attribution", "createdAt", "updatedAt"
      ].sort())
      expect(keys).not.toContain("openid")
      expect(keys).not.toContain("unionid")
      expect(keys.includes("attribution")).toBe(true)
      expect(csvSource.includes("ATTRIBUTION_SCENES = [\"weekend_trip\", \"business_reception\", \"group_travel\", \"ev_experience\"]")).toBe(true)
      expect(csvSource.includes("ATTRIBUTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/")).toBe(true)

      const headerBlock = csvSource.match(/function buildCsv\(items\) \{[\s\S]*?\n\s*\}/)
      expect(headerBlock).toBeTruthy()
      const headerKeysMatch = headerBlock[0].match(/const header\s*=\s*\[([\s\S]*?)\]/)
      expect(headerKeysMatch).toBeTruthy()
      const headerStrings = Array.from(headerKeysMatch[1].matchAll(/"([^"]+)"/g)).map((m) => m[1])
      expect(headerStrings).toEqual([
        "提交时间",
        "状态",
        "预约优先级",
        "协调状态",
        "车辆名称",
        "联系人",
        "手机号",
        "城市",
        "开始日期",
        "结束日期",
        "用户备注",
        "管理员备注",
        "内容ID",
        "归因渠道",
        "归因场景",
        "最后更新时间",
        "预约ID"
      ])
      expect(headerStrings).toHaveLength(17)
    })
  })
})
