const ALLOWED_EVENTS = [
  "garage_view",
  "vehicle_detail",
  "booking_start",
  "booking_submit",
  "favorite_add",
  "pricing_view",
  "rental_rules_view",
  "phone_call",
  "share",
  "availability_available",
  "availability_conflict",
  "availability_unknown"
]
const TRACK_COOLDOWN_MS = 5000
const recentEvents = new Map()

function trackEvent(eventType, vehicleId) {
  const type = String(eventType || "").trim()
  const targetVehicleId = String(vehicleId || "").trim()
  if (
    !ALLOWED_EVENTS.includes(type) ||
    !wx.cloud ||
    typeof wx.cloud.callFunction !== "function"
  ) {
    return
  }

  const eventKey = `${type}:${targetVehicleId}`
  const now = Date.now()
  const lastTrackedAt = recentEvents.get(eventKey) || 0
  if (now - lastTrackedAt < TRACK_COOLDOWN_MS) {
    return
  }
  recentEvents.set(eventKey, now)

  try {
    wx.cloud.callFunction({
      name: "analyticsTrack",
      data: {
        eventType: type,
        vehicleId: targetVehicleId
      },
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
