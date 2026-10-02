function normalizeCity(value) {
  return String(value || "").trim().replace(/市$/, "")
}

function getCityHubs(city, serviceHubs = []) {
  const normalizedCity = normalizeCity(city)
  if (!normalizedCity || !Array.isArray(serviceHubs)) return []
  return serviceHubs.filter((hub) => hub && normalizeCity(hub.city) === normalizedCity).map((hub) => ({ ...hub }))
}

function getDefaultHub(city, serviceHubs = []) {
  return getCityHubs(city, serviceHubs)[0] || null
}

function resolveServiceHub(location, city, serviceHubs = []) {
  const value = String(location || "").trim()
  if (!value || !Array.isArray(serviceHubs)) return null
  const hubs = normalizeCity(city) ? getCityHubs(city, serviceHubs) : serviceHubs.filter(Boolean)
  const matches = hubs.filter((hub) => [hub.id, hub.name, hub.address].some((field) => String(field || "").trim() === value))
  if (matches.length) return matches.length === 1 ? { ...matches[0] } : null
  // A city alone is sufficient only when its single saved store is unambiguous.
  const cityHubs = getCityHubs(value, hubs)
  const stores = cityHubs.filter((hub) => hub.type === "store")
  return stores.length === 1 ? { ...stores[0] } : null
}

function hasHubCoordinates(hub) {
  if (!hub) return false
  const coordinates = [hub.latitude, hub.longitude]
  if (coordinates.some((value) => (typeof value !== "number" && typeof value !== "string") || String(value).trim() === "")) return false
  const [latitude, longitude] = coordinates.map(Number)
  return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
}

function formatLocationDisplay(location, city = "") {
  const loc = String(location || "").trim()
  const cityText = String(city || "").trim()
  if (!loc) return cityText ? `${cityText} · 取车地点待确认` : "取车地点待确认"
  if (cityText && !loc.startsWith(cityText)) return `${cityText} · ${loc}`
  return loc
}

function normalizeBookingLocation(value) {
  return String(value || "").trim().slice(0, 60)
}

module.exports = { normalizeCity, getCityHubs, getDefaultHub, resolveServiceHub, hasHubCoordinates, formatLocationDisplay, normalizeBookingLocation }
