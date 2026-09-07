const CHANNELS = ["direct", "wechat_share", "moments", "qr", "official_account", "campaign"]
const SCENES = ["weekend_trip", "business_reception", "group_travel", "ev_experience"]
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function normalizeEnum(value, allowed) {
  const text = String(value || "").trim().slice(0, 32)
  return allowed.includes(text) ? text : ""
}

function normalizeId(value) {
  const text = String(value || "").trim()
  return ID_PATTERN.test(text) ? text : ""
}

function sanitizeAttribution(input) {
  const source = input && typeof input === "object" ? input : {}
  return {
    channel: normalizeEnum(source.channel, CHANNELS),
    scene: normalizeEnum(source.scene, SCENES),
    contentId: normalizeId(source.contentId),
    vehicleId: normalizeId(source.vehicleId || source.carId)
  }
}

function hasAttribution(input) {
  const source = sanitizeAttribution(input)
  return Boolean(source.channel || source.scene || source.contentId)
}

function isShareLanding() {
  try {
    if (typeof getCurrentPages !== "function") return true
    const pages = getCurrentPages()
    return !Array.isArray(pages) || pages.length <= 1
  } catch (error) {
    return true
  }
}

function buildQuery(input) {
  const source = sanitizeAttribution(input)
  return Object.keys(source)
    .filter((key) => source[key])
    .map((key) => `${key}=${encodeURIComponent(source[key])}`)
    .join("&")
}

module.exports = {
  CHANNELS,
  SCENES,
  sanitizeAttribution,
  hasAttribution,
  isShareLanding,
  buildQuery
}
