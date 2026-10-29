const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const GUIDE_FIELDS = {
  _id: true, slug: true, title: true, summary: true, body: true, contentType: true,
  scenario: true, vehicleIds: true, tags: true, shareTitle: true, status: true,
  publishedAt: true, updatedAt: true
}
const VEHICLE_FIELDS = { brandModel: true, name: true, coverImage: true, imageList: true, status: true }

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

async function readVehicle(id) {
  try {
    const res = await db.collection("vehicles").doc(id).field(VEHICLE_FIELDS).get()
    const item = res && res.data
    if (!item || item.status === "retired") return null
    const images = Array.isArray(item.imageList) ? item.imageList.filter(Boolean) : []
    return {
      id,
      name: String(item.brandModel || item.name || "车辆"),
      cover: String(item.coverImage || images[0] || ""),
      status: String(item.status || "")
    }
  } catch (error) {
    return null
  }
}

exports._test = { toTimestamp, readVehicle }
exports.main = async (event) => {
  const input = event && typeof event === "object" ? event : {}
  const rawId = input.contentId === undefined ? input.slug : input.contentId
  const contentId = typeof rawId === "string" ? rawId.trim() : ""
  if (!ID_PATTERN.test(contentId)) return { ok: false, code: "VALIDATION_ERROR", message: "内容标识格式不正确" }
  try {
    const res = await db.collection("content_guides").where({ slug: contentId }).field(GUIDE_FIELDS).limit(2).get()
    if (!res || !Array.isArray(res.data) || res.data.length > 1) throw new Error("Unexpected content detail result")
    const guide = res.data[0]
    if (res.data.length && (!guide || typeof guide !== "object" || Array.isArray(guide))) {
      throw new Error("Unexpected content detail result")
    }
    const publishedAt = guide ? toTimestamp(guide.publishedAt) : 0
    if (!guide || guide.status !== "published" || publishedAt <= 0 || publishedAt > Date.now()) {
      return { ok: false, code: "NOT_FOUND", message: "内容不存在或尚未发布" }
    }
    if (guide.slug !== contentId) throw new Error("Unexpected content detail identity")
    const vehicleIds = Array.from(new Set((Array.isArray(guide.vehicleIds) ? guide.vehicleIds : [])
      .map((id) => typeof id === "string" ? id.trim() : "").filter((id) => ID_PATTERN.test(id)))).slice(0, 20)
    const vehicles = (await Promise.all(vehicleIds.map(readVehicle))).filter(Boolean)
    const { status, ...publicGuide } = guide
    return {
      ok: true,
      guide: { ...publicGuide, id: guide.slug, vehicleIds },
      vehicles
    }
  } catch (error) {
    console.error({ function: "contentGuideDetail", contentId, errorMessage: String(error && (error.message || error.errMsg) || error) })
    return { ok: false, code: "INTERNAL_ERROR", message: "内容详情加载失败" }
  }
}
