const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const DEDUP_WINDOW_MS = 5 * 1000
const MAX_RECENT_EVENT_KEYS = 1000
const INSTANCE_DEDUP_SECRET = crypto.randomBytes(32)
const recentEventWrites = new Map()
const ALLOWED_EVENTS = [
  "garage_view",
  "vehicle_detail",
  "booking_start",
  "booking_submit",
  "favorite_add",
  "pricing_view",
  "rental_rules_view",
  "trusted_profile_view",
  "phone_call",
  "share",
  "availability_available",
  "availability_conflict",
  "availability_shortage",
  "price_change_view",
  "availability_unknown",
  "content_view",
  "content_vehicle_click",
  "share_open",
  "content_booking_start",
  "content_booking_submit"
]
const OPTIONAL_VEHICLE_EVENTS = ["phone_call", "share"]
const CONTENT_EVENTS = ["content_view", "content_vehicle_click", "share_open", "content_booking_start", "content_booking_submit"]
const CONTENT_VEHICLE_EVENTS = ["content_vehicle_click", "content_booking_start", "content_booking_submit"]
const CHANNELS = ["direct", "wechat_share", "moments", "qr", "official_account", "campaign"]
const SCENES = ["weekend_trip", "business_reception", "group_travel", "ev_experience"]
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const VEHICLE_EVENTS = ALLOWED_EVENTS.filter(
  (item) => item !== "garage_view" && !OPTIONAL_VEHICLE_EVENTS.includes(item) && !CONTENT_EVENTS.includes(item)
)

function buildEventDocumentId(openid, eventType, eventKey, now) {
  const windowId = Math.floor(now / DEDUP_WINDOW_MS)
  const digest = crypto
    .createHmac("sha256", INSTANCE_DEDUP_SECRET)
    .update(`${openid}|${eventType}|${eventKey}|${windowId}`)
    .digest("hex")
    .slice(0, 32)
  return `analytics_${digest}`
}

function pruneRecentEventWrites(now) {
  recentEventWrites.forEach((item, key) => {
    if (!item || item.expiresAt <= now) {
      recentEventWrites.delete(key)
    }
  })

  while (recentEventWrites.size >= MAX_RECENT_EVENT_KEYS) {
    const oldestKey = recentEventWrites.keys().next().value
    if (!oldestKey) {
      break
    }
    recentEventWrites.delete(oldestKey)
  }
}

async function writeAnonymousEvent(openid, eventType, source) {
  const now = Date.now()
  pruneRecentEventWrites(now)
  const eventKey = CONTENT_EVENTS.includes(eventType)
    ? [source.vehicleId, source.contentId, source.channel, source.scene].join("|")
    : ""
  const documentId = buildEventDocumentId(openid, eventType, eventKey, now)
  const existed = recentEventWrites.get(documentId)
  if (existed) {
    await existed.promise
    return
  }

  const writePromise = db.collection("analytics_events").doc(documentId).set({
    data: {
      eventType,
      vehicleId: eventType === "garage_view" ? "" : source.vehicleId,
      ...(source.contentId ? { contentId: source.contentId } : {}),
      ...(source.channel ? { channel: source.channel } : {}),
      ...(source.scene ? { scene: source.scene } : {}),
      createdAt: db.serverDate()
    }
  })
  recentEventWrites.set(documentId, {
    expiresAt: now + DEDUP_WINDOW_MS,
    promise: writePromise
  })

  try {
    await writePromise
  } catch (error) {
    const current = recentEventWrites.get(documentId)
    if (current && current.promise === writePromise) {
      recentEventWrites.delete(documentId)
    }
    throw error
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = event && typeof event === "object" ? event : {}
  const eventType = String(input.eventType || "").trim()
  const vehicleId = String(input.vehicleId || "").trim()
  const contentId = String(input.contentId || "").trim()
  const channel = String(input.channel || "").trim()
  const scene = String(input.scene || "").trim()

  try {
    if (!openid) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "未获取到用户身份"
      }
    }
    if (!ALLOWED_EVENTS.includes(eventType)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "统计事件类型不合法"
      }
    }
    if (VEHICLE_EVENTS.includes(eventType) && (!vehicleId || vehicleId.length > 128)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "车辆 ID 格式不正确"
      }
    }
    if (OPTIONAL_VEHICLE_EVENTS.includes(eventType) && vehicleId.length > 128) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "车辆 ID 格式不正确"
      }
    }
    if (CONTENT_EVENTS.includes(eventType)) {
      if ((eventType !== "share_open" && !ID_PATTERN.test(contentId)) ||
        (contentId && !ID_PATTERN.test(contentId)) ||
        (CONTENT_VEHICLE_EVENTS.includes(eventType) && !ID_PATTERN.test(vehicleId)) ||
        (vehicleId && !ID_PATTERN.test(vehicleId)) ||
        (channel && !CHANNELS.includes(channel)) ||
        (scene && !SCENES.includes(scene))) {
        return { ok: false, code: "VALIDATION_ERROR", message: "内容归因参数格式不正确" }
      }
    } else if (contentId || channel || scene) {
      return { ok: false, code: "VALIDATION_ERROR", message: "该事件不接受内容归因参数" }
    }

    await writeAnonymousEvent(openid, eventType, { vehicleId, contentId, channel, scene })

    return {
      ok: true
    }
  } catch (error) {
    console.warn({
      function: "analyticsTrack",
      eventType,
      vehicleId,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "统计记录失败"
    }
  }
}
