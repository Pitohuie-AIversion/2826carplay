const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const GUIDE_FIELDS = {
  _id: true, slug: true, title: true, summary: true, body: true, contentType: true,
  scenario: true, vehicleIds: true, tags: true, shareTitle: true, status: true,
  publishedAt: true, updatedAt: true
}
const VEHICLE_FIELDS = { brandModel: true, name: true, coverImage: true, images: true, status: true }

function toTimestamp(value) {
  if (!value) return 0
  if (value instanceof Date) return value.getTime()
  if (typeof value.toDate === "function") return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

async function readVehicle(id) {
  try {
    const res = await db.collection("vehicles").doc(id).field(VEHICLE_FIELDS).get()
    const item = res && res.data
    if (!item || item.status === "retired") return null
    const images = Array.isArray(item.images) ? item.images : []
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

exports.main = async (event) => {
  const contentId = String(event && (event.contentId || event.slug) || "").trim()
  if (!ID_PATTERN.test(contentId)) return { ok: false, code: "VALIDATION_ERROR", message: "内容标识格式不正确" }
  try {
    const res = await db.collection("content_guides").where({ slug: contentId }).field(GUIDE_FIELDS).limit(2).get()
    const guide = res && Array.isArray(res.data) ? res.data[0] : null
    if (!guide || guide.status !== "published" || toTimestamp(guide.publishedAt) <= 0 || toTimestamp(guide.publishedAt) > Date.now()) {
      return { ok: false, code: "NOT_FOUND", message: "内容不存在或尚未发布" }
    }
    const vehicleIds = (Array.isArray(guide.vehicleIds) ? guide.vehicleIds : []).filter((id) => ID_PATTERN.test(String(id))).slice(0, 20)
    const vehicles = (await Promise.all(vehicleIds.map(readVehicle))).filter(Boolean)
    const { status, ...publicGuide } = guide
    return {
      ok: true,
      guide: { ...publicGuide, id: guide.slug || guide._id },
      vehicles
    }
  } catch (error) {
    console.error({ function: "contentGuideDetail", contentId, errorMessage: String(error && (error.message || error.errMsg) || error) })
    return { ok: false, code: "INTERNAL_ERROR", message: "内容详情加载失败" }
  }
}
