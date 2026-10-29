const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const PUBLIC_FIELDS = {
  _id: true,
  slug: true,
  title: true,
  summary: true,
  contentType: true,
  scenario: true,
  vehicleIds: true,
  tags: true,
  shareTitle: true,
  status: true,
  publishedAt: true,
  updatedAt: true
}
const CONTENT_TYPES = ["route", "guide", "vehicle_advice", "handover_guide", "vehicle_tip"]
const SCENARIOS = ["weekend_trip", "business_reception", "group_travel", "ev_experience", "handover_tips"]
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const BATCH_SIZE = 100
const MAX_CANDIDATES = 2000

function toTimestamp(value) {
  try {
    let parsed
    if (value instanceof Date) parsed = value.getTime()
    else if (value && typeof value.toDate === "function") {
      const date = value.toDate()
      parsed = date instanceof Date ? date.getTime() : NaN
    } else if (typeof value === "string" || typeof value === "number") parsed = new Date(value).getTime()
    return Number.isFinite(parsed) ? parsed : 0
  } catch (ignored) {
    return 0
  }
}

exports.main = async (event) => {
  const input = event && typeof event === "object" ? event : {}
  const scenario = SCENARIOS.includes(input.scenario) ? input.scenario : ""
  const contentType = CONTENT_TYPES.includes(input.contentType) ? input.contentType : ""
  const vehicleId = typeof input.vehicleId === "string" && ID_PATTERN.test(input.vehicleId) ? input.vehicleId : ""
  const requestedLimit = Number(input.limit)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 6

  try {
    const criteria = { status: "published" }
    if (scenario) criteria.scenario = scenario
    if (contentType) criteria.contentType = contentType
    if (vehicleId) criteria.vehicleIds = db.command.elemMatch(db.command.eq(vehicleId))
    const now = Date.now()
    const ranked = []
    const seen = Object.create(null)
    let offset = 0
    while (true) {
      const batchLimit = Math.min(BATCH_SIZE, MAX_CANDIDATES + 1 - offset)
      const res = await db.collection("content_guides").where(criteria).field(PUBLIC_FIELDS)
        .orderBy("_id", "asc").skip(offset).limit(batchLimit).get()
      if (!res || !Array.isArray(res.data) || res.data.length > batchLimit) throw new Error("Unexpected content list result")
      offset += res.data.length
      if (offset > MAX_CANDIDATES) {
        return { ok: false, code: "QUERY_LIMIT_EXCEEDED", message: "匹配内容较多，暂时无法加载推荐" }
      }
      for (const item of res.data) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue
        const id = item._id
        if (!(typeof id === "string" && id.length > 0) && !(typeof id === "number" && Number.isFinite(id))) {
          throw new Error("Unexpected content document ID")
        }
        const key = JSON.stringify([typeof id, id])
        if (seen[key]) throw new Error("Repeated content document across list pages")
        seen[key] = true
        const publishedAt = toTimestamp(item.publishedAt)
        if (item.status === "published" && publishedAt > 0 && publishedAt <= now &&
            (!scenario || item.scenario === scenario) &&
            (!contentType || item.contentType === contentType) &&
            (!vehicleId || (Array.isArray(item.vehicleIds) && item.vehicleIds.includes(vehicleId)))) {
          ranked.push({ item, publishedAt })
        }
      }
      ranked.sort((left, right) => right.publishedAt - left.publishedAt)
      if (ranked.length > limit) ranked.length = limit
      if (res.data.length < batchLimit) break
    }
    const list = ranked.map(({ item }) => {
      const { status, ...publicItem } = item
      return { ...publicItem, id: item.slug || item._id }
    })

    return { ok: true, list }
  } catch (error) {
    console.error({ function: "contentGuideList", errorMessage: String(error && (error.message || error.errMsg) || error) })
    return { ok: false, code: "INTERNAL_ERROR", message: "内容列表加载失败" }
  }
}
