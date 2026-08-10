const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const BATCH_SIZE = 100
const MAX_SCAN_RECORDS = 1000
const MAX_RANGE_DAYS = 90
const INQUIRY_STATUSES = ["pending", "contacted", "quoted", "adjustment_requested"]
const AVAILABILITY_VEHICLE_FIELDS = { status: true, priceDay: true }

function createError(code, message, details) {
  const result = { ok: false, code: String(code || "VALIDATION_ERROR"), message: String(message || "参数错误") }
  if (details !== undefined) result.details = details
  return result
}

function isValidDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value
}

function getTodayInChina() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function enumerateDates(startDate, endDate) {
  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate) || endDate < startDate) return []
  const dates = []
  const end = Date.parse(`${endDate}T00:00:00.000Z`)
  for (let time = Date.parse(`${startDate}T00:00:00.000Z`); time <= end && dates.length <= MAX_RANGE_DAYS; time += 86400000) {
    dates.push(new Date(time).toISOString().slice(0, 10))
  }
  return dates
}

function dayDocumentId(vehicleId, date) {
  const vehicleHash = crypto.createHash("sha256").update(String(vehicleId || "")).digest("hex").slice(0, 24)
  return `day_${vehicleHash}_${String(date || "").replace(/-/g, "")}`
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    vehicleId: String(payload.vehicleId || payload.carId || "").trim(),
    startDate: String(payload.startDate || "").trim(),
    endDate: String(payload.endDate || "").trim()
  }
}

function validateInput(input) {
  const errors = []
  if (!input.vehicleId || input.vehicleId.length > 128) errors.push({ field: "vehicleId", message: "车辆 ID 格式不正确" })
  if (!isValidDateOnly(input.startDate)) errors.push({ field: "startDate", message: "取车日期格式不正确" })
  else if (input.startDate < getTodayInChina()) errors.push({ field: "startDate", message: "取车日期不能早于今天" })
  if (!isValidDateOnly(input.endDate)) errors.push({ field: "endDate", message: "还车日期格式不正确" })
  if (isValidDateOnly(input.startDate) && isValidDateOnly(input.endDate) && input.endDate < input.startDate) errors.push({ field: "endDate", message: "还车日期不能早于取车日期" })
  const dates = enumerateDates(input.startDate, input.endDate)
  if (dates.length > MAX_RANGE_DAYS) errors.push({ field: "endDate", message: `单次查询最多 ${MAX_RANGE_DAYS} 天` })
  return { errors, dates }
}

function documentMissing(error) {
  const message = String(error && (error.errMsg || error.message) || error || "").toLowerCase()
  return message.includes("not exist") || message.includes("not found") || message.includes("document_not_found") || message.includes("-502005")
}

async function getDayOrNull(id) {
  try {
    const res = await db.collection("vehicle_calendar_days").doc(id).field({ date: true, kind: true, blockId: true }).get()
    return res && res.data ? res.data : null
  } catch (error) {
    if (documentMissing(error)) return null
    throw error
  }
}

function isOverlappingInquiry(item, input) {
  if (!INQUIRY_STATUSES.includes(String(item && item.status || "pending"))) return false
  const startDate = String(item && item.startDate || "").trim()
  const endDate = String(item && (item.endDate || item.startDate) || "").trim()
  return Boolean(startDate && endDate && startDate <= input.endDate && endDate >= input.startDate)
}

async function queryVehicleInquiries(vehicleId) {
  const countResult = await db.collection("bookings").where({ vehicleId }).count()
  const total = Math.max(0, Number(countResult && countResult.total || 0))
  const scanCount = Math.min(total, MAX_SCAN_RECORDS)
  const list = []
  for (let offset = 0; offset < scanCount; offset += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, scanCount - offset)
    const res = await db.collection("bookings").where({ vehicleId }).field({ startDate: true, endDate: true, status: true }).skip(offset).limit(batchSize).get()
    const batch = res && Array.isArray(res.data) ? res.data : []
    list.push(...batch)
    if (batch.length < batchSize) break
  }
  return { list, truncated: total > MAX_SCAN_RECORDS }
}

async function queryPriceRules(vehicleId, input) {
  const res = await db.collection("vehicle_price_rules").where({ vehicleId, status: "active" }).field({ label: true, startDate: true, endDate: true, dailyPrice: true }).limit(100).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.filter((item) => String(item.startDate || "") <= input.endDate && String(item.endDate || "") >= input.startDate)
}

function buildPriceSummary(baseDailyRate, dates, rules) {
  const base = Number.isInteger(baseDailyRate) && baseDailyRate > 0 ? baseDailyRate : 0
  const daily = dates.map((date) => {
    const matched = rules.filter((item) => item.startDate <= date && item.endDate >= date).sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0]
    const rate = matched && Number.isInteger(matched.dailyPrice) ? matched.dailyPrice : base
    return { date, dailyRate: rate, label: matched ? String(matched.label || "特殊日期价") : "基础日租" }
  })
  const known = daily.length > 0 && daily.every((item) => item.dailyRate > 0)
  return {
    baseDailyRate: base,
    baseDailyRateText: base > 0 ? `￥${base}` : "待顾问确认",
    specialDayCount: daily.filter((item) => item.label !== "基础日租").length,
    estimatedTotal: known ? daily.reduce((sum, item) => sum + item.dailyRate, 0) : 0,
    estimatedTotalText: known ? `￥${daily.reduce((sum, item) => sum + item.dailyRate, 0)}` : "待顾问报价",
    daily
  }
}

exports.main = async (event) => {
  const context = cloud.getWXContext()
  const openid = String(context && context.OPENID || "").trim()
  const input = normalizeEvent(event)
  try {
    if (!openid) return createError("UNAUTHORIZED", "未获取到用户身份")
    const validation = validateInput(input)
    if (validation.errors.length) return createError("VALIDATION_ERROR", "参数校验失败", { errors: validation.errors })
    const vehicleRes = await db.collection("vehicles").doc(input.vehicleId).field(AVAILABILITY_VEHICLE_FIELDS).get()
    const vehicle = vehicleRes && vehicleRes.data ? vehicleRes.data : null
    if (!vehicle) return createError("NOT_FOUND", "车辆不存在")
    if (["maintenance", "retired"].includes(String(vehicle.status || ""))) return createError("NOT_AVAILABLE", "车辆维修或已停用，暂不可预约")

    const [days, inquiryResult, priceRules] = await Promise.all([
      Promise.all(validation.dates.map((date) => getDayOrNull(dayDocumentId(input.vehicleId, date)))),
      queryVehicleInquiries(input.vehicleId),
      queryPriceRules(input.vehicleId, input)
    ])
    const occupiedDays = days.filter(Boolean)
    const inquiryCount = inquiryResult.list.filter((item) => isOverlappingInquiry(item, input)).length
    const available = occupiedDays.length === 0
    let message = "所选日期当前可预约"
    if (!available) message = `所选日期有 ${occupiedDays.length} 天不可用，可更换日期后提交`
    else if (inquiryCount > 0) message = `档期可预约，另有 ${inquiryCount} 条同期咨询；普通咨询不会锁车`
    else if (inquiryResult.truncated) message = "档期可预约；同期咨询较多，请等待顾问确认具体安排"

    return {
      ok: true,
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.endDate,
      available,
      conflictCount: occupiedDays.length,
      occupiedDayCount: occupiedDays.length,
      inquiryCount,
      truncated: inquiryResult.truncated,
      priceSummary: buildPriceSummary(vehicle.priceDay, validation.dates, priceRules),
      message
    }
  } catch (error) {
    console.error({ function: "vehicleAvailabilityCheck", vehicleId: input.vehicleId, startDate: input.startDate, endDate: input.endDate, errorMessage: String(error && (error.message || error.errMsg) || error), createdAt: new Date().toISOString() })
    return createError("INTERNAL_ERROR", "档期查询失败，请稍后重试")
  }
}

module.exports._test = { enumerateDates, dayDocumentId, buildPriceSummary, isOverlappingInquiry }
