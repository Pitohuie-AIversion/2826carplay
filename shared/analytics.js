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
const TRACK_COOLDOWN_MS = 5000
const recentEvents = new Map()

function trackEvent(eventType, vehicleId, context) {
  const type = String(eventType || "").trim()
  const targetVehicleId = String(vehicleId || "").trim()
  const source = context && typeof context === "object" ? context : {}
  if (
    !ALLOWED_EVENTS.includes(type) ||
    !wx.cloud ||
    typeof wx.cloud.callFunction !== "function"
  ) {
    return
  }

  const eventKey = `${type}:${targetVehicleId}:${source.contentId || ""}:${source.channel || ""}:${source.scene || ""}`
  const now = Date.now()
  const lastTrackedAt = recentEvents.get(eventKey) || 0
  if (now - lastTrackedAt < TRACK_COOLDOWN_MS) {
    return
  }
  recentEvents.set(eventKey, now)

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
      fail: () => {
        recentEvents.delete(eventKey)
      }
    })
  } catch (error) {
    recentEvents.delete(eventKey)
  }
}

module.exports = {
  trackEvent
}
