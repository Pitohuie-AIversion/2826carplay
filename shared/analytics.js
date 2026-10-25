const { sanitizeAttribution } = require("./contentAttribution")

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
  "kf_chat",
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
const CONTENT_EVENTS = ["content_view", "content_vehicle_click", "share_open", "content_booking_start", "content_booking_submit"]
const CONTENT_ID_REQUIRED_EVENTS = ["content_view", "content_vehicle_click", "content_booking_start", "content_booking_submit"]
const TRACK_COOLDOWN_MS = 5000
const recentEvents = new Map()

function trackEvent(eventType, vehicleId, context) {
  const type = String(eventType || "").trim()
  const targetVehicleId = String(vehicleId || "").trim()
  const source = CONTENT_EVENTS.includes(type) ? sanitizeAttribution(context) : {}
  if (
    !ALLOWED_EVENTS.includes(type) ||
    (CONTENT_ID_REQUIRED_EVENTS.includes(type) && !source.contentId) ||
    typeof wx === "undefined" ||
    !wx.cloud ||
    typeof wx.cloud.callFunction !== "function"
  ) {
    return
  }

  const eventKey = `${type}:${targetVehicleId}:${source.contentId || ""}:${source.channel || ""}:${source.scene || ""}`
  const now = Date.now()
  const previousEvent = recentEvents.get(eventKey)
  if (previousEvent && now - previousEvent.trackedAt < TRACK_COOLDOWN_MS) {
    return
  }
  const currentEvent = { trackedAt: now }
  recentEvents.set(eventKey, currentEvent)
  const releaseCooldown = () => {
    if (recentEvents.get(eventKey) === currentEvent) recentEvents.delete(eventKey)
  }

  const data = {
    eventType: type,
    vehicleId: targetVehicleId
  }
  ;["contentId", "channel", "scene"].forEach((key) => {
    const value = String(source[key] || "").trim()
    if (value) {
      data[key] = value
    }
  })

  try {
    wx.cloud.callFunction({
      name: "analyticsTrack",
      data,
      fail: releaseCooldown
    })
  } catch (error) {
    releaseCooldown()
  }
}

module.exports = {
  trackEvent
}
