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
    const res = await db.collection("content_guides").where({ status: "published" }).field(PUBLIC_FIELDS).limit(100).get()
    if (!res || !Array.isArray(res.data)) throw new Error("Unexpected content list result")
    const now = Date.now()
    const list = res.data
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({ item, publishedAt: toTimestamp(item.publishedAt) }))
      .filter(({ item, publishedAt }) => {
        return item.status === "published" && publishedAt > 0 && publishedAt <= now &&
          (!scenario || item.scenario === scenario) &&
          (!contentType || item.contentType === contentType) &&
          (!vehicleId || (Array.isArray(item.vehicleIds) && item.vehicleIds.includes(vehicleId)))
      })
      .sort((left, right) => right.publishedAt - left.publishedAt)
      .slice(0, limit)
      .map(({ item }) => {
        const { status, ...publicItem } = item
        return { ...publicItem, id: item.slug || item._id }
      })

    return { ok: true, list }
  } catch (error) {
    console.error({ function: "contentGuideList", errorMessage: String(error && (error.message || error.errMsg) || error) })
    return { ok: false, code: "INTERNAL_ERROR", message: "内容列表加载失败" }
  }
}
