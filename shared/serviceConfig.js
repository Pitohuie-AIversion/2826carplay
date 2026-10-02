const SERVICE_TEXT_LIMITS = { serviceHoursText: 120, emergencyPhone: 20, wxKfCorpId: 64, wxKfExtInfo: 512 }
const HUB_TEXT_LIMITS = { id: 64, city: 20, name: 60, address: 200, feeText: 100 }
const HUB_TYPES = ["store", "hub", "delivery"]
const MAX_SERVICE_HUBS = 30
const MAX_CITIES = 20
const MAX_CITY_LENGTH = 20

function validateCityOptions(value) {
  if (value === undefined) return null
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || item.trim().length > MAX_CITY_LENGTH)) {
    return { field: "cityOptions", message: "每个城市名称限20字" }
  }
  if (new Set(value.map((item) => item.trim()).filter(Boolean)).size > MAX_CITIES) {
    return { field: "cityOptions", message: "服务城市最多20个" }
  }
  return null
}

function isCustomerServiceCorpId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{6,64}$/.test(value.trim())
}

function isPhone(value) {
  const digits = value.replace(/\D/g, "").length
  return /^\+?[0-9-]{6,20}$/.test(value) && digits >= 6 && digits <= 15
}

function coordinate(value) {
  if (value === undefined || value === null || (typeof value === "string" && !value.trim())) return null
  if (typeof value !== "number" && typeof value !== "string") return NaN
  return Number(value)
}

function isCustomerServiceUrl(value) {
  if (typeof value !== "string") return false
  const match = /^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)(?::(\d{1,5}))?(?:[/?#][^\s]*)?$/i.exec(value.trim())
  if (!match || (match[2] && (Number(match[2]) < 1 || Number(match[2]) > 65535))) return false
  return match[1].split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label))
}

function validateServiceConfig(input) {
  const source = input || {}
  for (const [key, max] of Object.entries(SERVICE_TEXT_LIMITS)) {
    if (source[key] !== undefined && (typeof source[key] !== "string" || source[key].trim().length > max)) {
      return { field: key, message: `字段长度不能超过 ${max} 字` }
    }
  }
  if (String(source.emergencyPhone || "").trim() && !isPhone(source.emergencyPhone.trim())) return { field: "emergencyPhone", message: "救援电话格式不正确" }
  const corp = String(source.wxKfCorpId || "").trim()
  const ext = String(source.wxKfExtInfo || "").trim()
  if (Boolean(corp) !== Boolean(ext) || (corp && !isCustomerServiceCorpId(corp))) {
    return { field: "wxKfCorpId", message: "客服企业ID与链接参数需成对填写" }
  }
  if (ext && !isCustomerServiceUrl(ext)) return { field: "wxKfExtInfo", message: "微信客服链接须为 HTTPS 地址" }
  if (source.serviceHubs === undefined) return null
  if (!Array.isArray(source.serviceHubs) || source.serviceHubs.length > MAX_SERVICE_HUBS) {
    return { field: "serviceHubs", message: "服务网点最多 30 个" }
  }
  const ids = new Set()
  const names = new Set()
  for (const hub of source.serviceHubs) {
    const error = { field: "serviceHubs", message: "网点需填写唯一编号、城市、名称及真实地址" }
    if (!hub || typeof hub !== "object") return error
    for (const [key, max] of Object.entries(HUB_TEXT_LIMITS)) {
      if (typeof hub[key] !== "string" || hub[key].trim().length > max || (key !== "feeText" && !hub[key].trim())) return error
    }
    const nameKey = `${hub.city.trim()}:${hub.name.trim()}`
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(hub.id.trim()) || ids.has(hub.id.trim()) || names.has(nameKey)) return error
    ids.add(hub.id.trim())
    names.add(nameKey)
    if (!HUB_TYPES.includes(hub.type)) return { field: "serviceHubs", message: "网点类型不合法" }
    const lat = coordinate(hub.latitude)
    const lng = coordinate(hub.longitude)
    if ((lat === null) !== (lng === null) || (lat !== null && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180))) {
      return { field: "serviceHubs", message: "经纬度需成对填写且在合法范围内" }
    }
  }
  return null
}

function normalizeServiceConfig(input) {
  const source = input || {}
  const result = {}
  for (const [key, max] of Object.entries(SERVICE_TEXT_LIMITS)) result[key] = String(source[key] || "").trim().slice(0, max)
  const hubs = Array.isArray(source.serviceHubs) ? source.serviceHubs : []
  result.serviceHubs = validateServiceConfig({ serviceHubs: hubs }) ? [] : hubs.map((hub) => ({
    ...Object.fromEntries(Object.keys(HUB_TEXT_LIMITS).map((key) => [key, hub[key].trim()])),
    type: hub.type,
    latitude: coordinate(hub.latitude),
    longitude: coordinate(hub.longitude)
  }))
  return result
}

module.exports = { SERVICE_TEXT_LIMITS, HUB_TEXT_LIMITS, HUB_TYPES, MAX_SERVICE_HUBS, MAX_CITIES, MAX_CITY_LENGTH, isCustomerServiceCorpId, isCustomerServiceUrl, validateCityOptions, validateServiceConfig, normalizeServiceConfig }
