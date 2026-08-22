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
const CONTENT_TYPES = ["route", "vehicle_advice", "handover_guide", "vehicle_tip"]
const SCENARIOS = ["weekend_trip", "business_reception", "group_travel", "ev_experience"]
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function toTimestamp(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value.toDate === "function") return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

exports.main = async (event) => {
  const input = event && typeof event === "object" ? event : {}
  const scenario = SCENARIOS.includes(String(input.scenario || "")) ? String(input.scenario) : ""
  const contentType = CONTENT_TYPES.includes(String(input.contentType || "")) ? String(input.contentType) : ""
  const vehicleId = ID_PATTERN.test(String(input.vehicleId || "")) ? String(input.vehicleId) : ""
  const requestedLimit = Number(input.limit)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 20) : 6

  try {
    const res = await db.collection("content_guides").where({ status: "published" }).field(PUBLIC_FIELDS).limit(100).get()
    const now = Date.now()
    const list = (res && Array.isArray(res.data) ? res.data : [])
      .filter((item) => {
        const publishedAt = toTimestamp(item.publishedAt)
        return item.status !== "draft" && item.status !== "archived" && publishedAt > 0 && publishedAt <= now &&
          (!scenario || item.scenario === scenario) &&
          (!contentType || item.contentType === contentType) &&
          (!vehicleId || (Array.isArray(item.vehicleIds) && item.vehicleIds.includes(vehicleId)))
      })
      .sort((left, right) => toTimestamp(right.publishedAt) - toTimestamp(left.publishedAt))
      .slice(0, limit)
      .map((item) => {
        const { status, ...publicItem } = item
        return { ...publicItem, id: item.slug || item._id }
      })

    return { ok: true, list }
  } catch (error) {
    console.error({ function: "contentGuideList", errorMessage: String(error && (error.message || error.errMsg) || error) })
    return { ok: false, code: "INTERNAL_ERROR", message: "内容列表加载失败" }
  }
}
