const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const ALLOWED_BLOCK_KINDS = ["maintenance", "hold", "unavailable"]
const MAX_RANGE_DAYS = 90
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const VEHICLE_FIELDS = { brandModel: true, plateNumber: true, status: true, priceDay: true }
const BOOKING_FIELDS = { _id: true, vehicleId: true, vehicleName: true, startDate: true, endDate: true, status: true }

function createError(code, message, details) {
  const result = { ok: false, code: String(code || "VALIDATION_ERROR"), message: String(message || "参数校验失败") }
  if (details !== undefined) result.details = details
  return result
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : []
}

function hasAccess(record) {
  if (!record || typeof record !== "object") return false
  if (record.role === "admin" || record.isAdmin === true || record.admin === true || normalizeArray(record.roles).includes("admin")) return true
  const values = normalizeArray([record.role].concat(record.roles || [], record.permissions || []))
  return values.includes("booking_manage") || values.includes("booking_manager")
}

async function canManage(openid) {
  if (!openid) return false
  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  return Boolean(res && Array.isArray(res.data) && res.data.some(hasAccess))
}

function isValidDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) return false
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])))
  return date.toISOString().slice(0, 10) === value
}

function enumerateDates(startDate, endDate) {
  if (!isValidDate(startDate) || !isValidDate(endDate) || endDate < startDate) return []
  const dates = []
  const endTime = Date.parse(`${endDate}T00:00:00.000Z`)
  for (let time = Date.parse(`${startDate}T00:00:00.000Z`); time <= endTime && dates.length <= MAX_RANGE_DAYS; time += 86400000) {
    dates.push(new Date(time).toISOString().slice(0, 10))
  }
  return dates
}

function hashId(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, 24)
}

function dayDocumentId(vehicleId, date) {
  return `day_${hashId(vehicleId)}_${String(date || "").replace(/-/g, "")}`
}

function documentMissing(error) {
  const message = String(error && (error.errMsg || error.message) || error || "").toLowerCase()
  return message.includes("not exist") || message.includes("not found") || message.includes("document_not_found") || message.includes("-502005")
}

async function getDocOrNull(collection, id, fields) {
  try {
    let query = collection.doc(id)
    if (fields) query = query.field(fields)
    const res = await query.get()
    return res && res.data ? res.data : null
  } catch (error) {
    if (documentMissing(error)) return null
    throw error
  }
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    action: String(payload.action || "").trim(),
    id: String(payload.id || payload.blockId || payload.ruleId || "").trim(),
    vehicleId: String(payload.vehicleId || "").trim(),
    kind: String(payload.kind || "").trim(),
    label: String(payload.label || "").trim().slice(0, 40),
    startDate: String(payload.startDate || "").trim(),
    endDate: String(payload.endDate || "").trim(),
    reason: String(payload.reason || "").trim().slice(0, 200),
    dailyPrice: Number(payload.dailyPrice)
  }
}

function validateRangeInput(input, requireKind) {
  const errors = []
  if (!input.vehicleId || input.vehicleId.length > 128) errors.push({ field: "vehicleId", message: "请选择车辆" })
  const allowedKinds = requireKind === "update" ? ALLOWED_BLOCK_KINDS.concat("booking") : ALLOWED_BLOCK_KINDS
  if (requireKind && !allowedKinds.includes(input.kind)) errors.push({ field: "kind", message: "不可用类型不合法" })
  if (!isValidDate(input.startDate)) errors.push({ field: "startDate", message: "开始日期格式不正确" })
  if (!isValidDate(input.endDate) || input.endDate < input.startDate) errors.push({ field: "endDate", message: "结束日期格式不正确" })
  const dates = enumerateDates(input.startDate, input.endDate)
  if (!dates.length || dates.length > MAX_RANGE_DAYS) errors.push({ field: "endDate", message: `单次区间最多 ${MAX_RANGE_DAYS} 天` })
  if (!input.reason) errors.push({ field: "reason", message: "请填写调整原因" })
  return { errors, dates }
}

async function assertVehicleAvailable(collection, vehicleId) {
  const vehicle = await getDocOrNull(collection, vehicleId, VEHICLE_FIELDS)
  if (!vehicle) return { error: createError("NOT_FOUND", "车辆不存在") }
  if (["maintenance", "retired"].includes(String(vehicle.status || ""))) {
    return { error: createError("VEHICLE_NOT_OCCUPIABLE", "维修或已停用车辆不能新增档期占用") }
  }
  return { vehicle }
}

async function readBlockDays(transaction, blockId) {
  const res = await transaction.collection("vehicle_calendar_days").where({ blockId }).limit(MAX_RANGE_DAYS + 1).get()
  return res && Array.isArray(res.data) ? res.data : []
}

async function ensureDatesFree(transaction, vehicleId, dates, ignoredBlockId) {
  for (const date of dates) {
    const occupied = await getDocOrNull(transaction.collection("vehicle_calendar_days"), dayDocumentId(vehicleId, date), { blockId: true, kind: true, date: true })
    if (occupied && String(occupied.blockId || "") !== ignoredBlockId) {
      return createError("AVAILABILITY_CONFLICT", `${date} 已被占用，请调整区间`, { date, kind: occupied.kind || "unavailable" })
    }
  }
  return null
}

async function saveDays(transaction, block, dates) {
  for (const date of dates) {
    await transaction.collection("vehicle_calendar_days").doc(dayDocumentId(block.vehicleId, date)).set({
      data: {
        vehicleId: block.vehicleId,
        date,
        blockId: block.id,
        kind: block.kind,
        bookingId: block.bookingId || "",
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
  }
}

async function removeDays(transaction, days) {
  for (const day of days) {
    if (day && day._id) await transaction.collection("vehicle_calendar_days").doc(day._id).remove()
  }
}

async function createBlock(input, openid) {
  const validation = validateRangeInput(input, true)
  if (validation.errors.length) return { error: createError("VALIDATION_ERROR", "参数校验失败", { errors: validation.errors }) }
  const blockId = `block_${crypto.randomBytes(16).toString("hex")}`
  return db.runTransaction(async (transaction) => {
    const vehicleResult = await assertVehicleAvailable(transaction.collection("vehicles"), input.vehicleId)
    if (vehicleResult.error) return vehicleResult
    const conflict = await ensureDatesFree(transaction, input.vehicleId, validation.dates, "")
    if (conflict) return { error: conflict }
    const block = { id: blockId, vehicleId: input.vehicleId, kind: input.kind, bookingId: "" }
    await transaction.collection("vehicle_availability_blocks").doc(blockId).set({
      data: {
        vehicleId: input.vehicleId,
        vehicleName: String(vehicleResult.vehicle.brandModel || vehicleResult.vehicle.plateNumber || "车辆"),
        kind: input.kind,
        startDate: input.startDate,
        endDate: input.endDate,
        reason: input.reason,
        status: "active",
        version: 1,
        createdBy: openid,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    await saveDays(transaction, block, validation.dates)
    return { blockId, vehicleId: input.vehicleId, kind: input.kind, startDate: input.startDate, endDate: input.endDate }
  })
}

async function syncBookingOccupancy(input, openid) {
  if (!input.id) return { error: createError("VALIDATION_ERROR", "预约 ID 不能为空") }
  return db.runTransaction(async (transaction) => {
    const booking = await getDocOrNull(transaction.collection("bookings"), input.id, BOOKING_FIELDS)
    if (!booking) return { error: createError("NOT_FOUND", "预约不存在") }
    if (String(booking.status || "") !== "confirmed") return { error: createError("STATUS_NOT_ALLOWED", "只有已确认预约可以同步占用") }
    const vehicleId = String(booking.vehicleId || "").trim()
    const dates = enumerateDates(String(booking.startDate || ""), String(booking.endDate || booking.startDate || ""))
    if (!vehicleId || !dates.length || dates.length > MAX_RANGE_DAYS) return { error: createError("BOOKING_DATES_INVALID", "预约车辆或日期无效") }
    const vehicleResult = await assertVehicleAvailable(transaction.collection("vehicles"), vehicleId)
    if (vehicleResult.error) return vehicleResult
    for (const date of dates) {
      const occupied = await getDocOrNull(transaction.collection("vehicle_calendar_days"), dayDocumentId(vehicleId, date), { bookingId: true, kind: true, date: true })
      if (occupied && String(occupied.bookingId || "") !== input.id) return { error: createError("AVAILABILITY_CONFLICT", `${date} 已被其他占用覆盖，不能同步历史预约`, { date }) }
    }
    const blockId = `booking_${hashId(input.id)}`
    await transaction.collection("vehicle_availability_blocks").doc(blockId).set({ data: {
      vehicleId,
      vehicleName: String(booking.vehicleName || vehicleResult.vehicle.brandModel || vehicleResult.vehicle.plateNumber || "车辆"),
      kind: "booking",
      bookingId: input.id,
      startDate: String(booking.startDate || ""),
      endDate: String(booking.endDate || booking.startDate || ""),
      reason: "同步历史已确认预约",
      status: "active",
      version: 1,
      createdBy: openid,
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    } })
    await saveDays(transaction, { id: blockId, vehicleId, kind: "booking", bookingId: input.id }, dates)
    return { blockId, vehicleId, kind: "booking", startDate: booking.startDate, endDate: booking.endDate, syncedBookingId: input.id }
  })
}

async function updateBlock(input, openid) {
  if (!input.id) return { error: createError("VALIDATION_ERROR", "档期记录 ID 不能为空") }
  const validation = validateRangeInput(input, "update")
  if (validation.errors.length) return { error: createError("VALIDATION_ERROR", "参数校验失败", { errors: validation.errors }) }
  return db.runTransaction(async (transaction) => {
    const current = await getDocOrNull(transaction.collection("vehicle_availability_blocks"), input.id)
    if (!current) return { error: createError("NOT_FOUND", "档期记录不存在") }
    if (String(current.status || "") !== "active") return { error: createError("STATUS_NOT_ALLOWED", "当前档期不能调整") }
    if (String(current.kind || "") !== input.kind) return { error: createError("VALIDATION_ERROR", "调整时不能改变档期类型") }
    const vehicleResult = await assertVehicleAvailable(transaction.collection("vehicles"), input.vehicleId)
    if (vehicleResult.error) return vehicleResult
    const oldDays = await readBlockDays(transaction, input.id)
    const conflict = await ensureDatesFree(transaction, input.vehicleId, validation.dates, input.id)
    if (conflict) return { error: conflict }
    await removeDays(transaction, oldDays)
    await saveDays(transaction, { id: input.id, vehicleId: input.vehicleId, kind: input.kind }, validation.dates)
    await transaction.collection("vehicle_availability_blocks").doc(input.id).update({ data: {
      vehicleId: input.vehicleId,
      vehicleName: String(vehicleResult.vehicle.brandModel || vehicleResult.vehicle.plateNumber || "车辆"),
      kind: input.kind,
      startDate: input.startDate,
      endDate: input.endDate,
      reason: input.reason,
      version: Number(current.version || 1) + 1,
      updatedBy: openid,
      updatedAt: db.serverDate()
    } })
    return { blockId: input.id, vehicleId: input.vehicleId, kind: input.kind, startDate: input.startDate, endDate: input.endDate }
  })
}

async function releaseBlock(input, openid) {
  if (!input.id || !input.reason) return { error: createError("VALIDATION_ERROR", "档期记录和释放原因不能为空") }
  return db.runTransaction(async (transaction) => {
    const current = await getDocOrNull(transaction.collection("vehicle_availability_blocks"), input.id)
    if (!current) return { error: createError("NOT_FOUND", "档期记录不存在") }
    if (String(current.status || "") !== "active") return { error: createError("STATUS_NOT_ALLOWED", "当前档期不能释放") }
    const days = await readBlockDays(transaction, input.id)
    await removeDays(transaction, days)
    await transaction.collection("vehicle_availability_blocks").doc(input.id).update({ data: {
      status: "released",
      releaseReason: input.reason,
      releasedBy: openid,
      releasedAt: db.serverDate(),
      updatedAt: db.serverDate(),
      version: Number(current.version || 1) + 1
    } })
    return { blockId: input.id, vehicleId: current.vehicleId || "", kind: current.kind || "" }
  })
}

function validatePriceInput(input) {
  const result = validateRangeInput(input, false)
  if (!input.label) result.errors.push({ field: "label", message: "请填写价格规则名称" })
  if (!Number.isInteger(input.dailyPrice) || input.dailyPrice < 0 || input.dailyPrice > 99999) result.errors.push({ field: "dailyPrice", message: "每日价格需为 0-99999 的整数" })
  return result
}

async function savePriceRule(input, openid, isUpdate) {
  const validation = validatePriceInput(input)
  if (validation.errors.length) return { error: createError("VALIDATION_ERROR", "参数校验失败", { errors: validation.errors }) }
  const ruleId = isUpdate ? input.id : `price_${crypto.randomBytes(16).toString("hex")}`
  if (isUpdate && !ruleId) return { error: createError("VALIDATION_ERROR", "价格规则 ID 不能为空") }
  return db.runTransaction(async (transaction) => {
    const vehicleResult = await assertVehicleAvailable(transaction.collection("vehicles"), input.vehicleId)
    if (vehicleResult.error) return vehicleResult
    const current = isUpdate ? await getDocOrNull(transaction.collection("vehicle_price_rules"), ruleId) : null
    if (isUpdate && (!current || String(current.status || "") !== "active")) return { error: createError("STATUS_NOT_ALLOWED", "价格规则不存在或已停用") }
    const activeRes = await transaction.collection("vehicle_price_rules").where({ vehicleId: input.vehicleId, status: "active" }).limit(200).get()
    const overlapping = (activeRes && Array.isArray(activeRes.data) ? activeRes.data : []).find((item) =>
      String(item._id || "") !== ruleId && String(item.startDate || "") <= input.endDate && String(item.endDate || item.startDate || "") >= input.startDate
    )
    if (overlapping) return { error: createError("PRICE_RULE_CONFLICT", "所选日期已有特殊价格规则，请调整或先停用原规则") }
    const data = {
      vehicleId: input.vehicleId,
      vehicleName: String(vehicleResult.vehicle.brandModel || vehicleResult.vehicle.plateNumber || "车辆"),
      label: input.label,
      startDate: input.startDate,
      endDate: input.endDate,
      dailyPrice: input.dailyPrice,
      reason: input.reason,
      status: "active",
      version: Number(current && current.version || 0) + 1,
      updatedBy: openid,
      updatedAt: db.serverDate()
    }
    if (isUpdate) await transaction.collection("vehicle_price_rules").doc(ruleId).update({ data })
    else await transaction.collection("vehicle_price_rules").doc(ruleId).set({ data: { ...data, createdBy: openid, createdAt: db.serverDate() } })
    return { ruleId, vehicleId: input.vehicleId, startDate: input.startDate, endDate: input.endDate, dailyPrice: input.dailyPrice }
  })
}

async function releasePriceRule(input, openid) {
  if (!input.id || !input.reason) return { error: createError("VALIDATION_ERROR", "价格规则和停用原因不能为空") }
  return db.runTransaction(async (transaction) => {
    const current = await getDocOrNull(transaction.collection("vehicle_price_rules"), input.id)
    if (!current) return { error: createError("NOT_FOUND", "价格规则不存在") }
    if (String(current.status || "") !== "active") return { duplicate: true, ruleId: input.id }
    await transaction.collection("vehicle_price_rules").doc(input.id).update({ data: {
      status: "released",
      releaseReason: input.reason,
      releasedBy: openid,
      releasedAt: db.serverDate(),
      updatedAt: db.serverDate(),
      version: Number(current.version || 1) + 1
    } })
    return { ruleId: input.id, vehicleId: current.vehicleId || "" }
  })
}

async function writeAuditLogBestEffort(payload) {
  try { await db.collection("audit_logs").add({ data: { ...payload, createdAt: db.serverDate() } }) } catch (error) {}
}

async function writeErrorLogBestEffort(payload) {
  try { await db.collection("error_logs").add({ data: { ...payload, createdAt: db.serverDate() } }) } catch (error) {}
}

exports.main = async (event) => {
  const context = cloud.getWXContext()
  const openid = String(context && context.OPENID || "").trim()
  const input = normalizeEvent(event)
  try {
    if (!(await canManage(openid))) return createError("FORBIDDEN", "权限不足")
    const handlers = {
      createBlock: () => createBlock(input, openid),
      syncBookingOccupancy: () => syncBookingOccupancy(input, openid),
      updateBlock: () => updateBlock(input, openid),
      releaseBlock: () => releaseBlock(input, openid),
      createPriceRule: () => savePriceRule(input, openid, false),
      updatePriceRule: () => savePriceRule(input, openid, true),
      releasePriceRule: () => releasePriceRule(input, openid)
    }
    if (!handlers[input.action]) return createError("VALIDATION_ERROR", "操作类型不合法")
    const outcome = await handlers[input.action]()
    if (outcome && outcome.error) return outcome.error
    await writeAuditLogBestEffort({
      openid,
      action: `vehicleCalendar${input.action.slice(0, 1).toUpperCase()}${input.action.slice(1)}`,
      vehicleId: outcome.vehicleId || input.vehicleId,
      blockId: outcome.blockId || "",
      ruleId: outcome.ruleId || "",
      kind: outcome.kind || input.kind || "",
      startDate: outcome.startDate || input.startDate || "",
      endDate: outcome.endDate || input.endDate || "",
      reasonProvided: Boolean(input.reason)
    })
    return { ok: true, action: input.action, ...outcome, message: "车辆日历已更新" }
  } catch (error) {
    const errorMessage = String(error && (error.message || error.errMsg) || error).slice(0, 300)
    await writeErrorLogBestEffort({ function: "vehicleCalendarManage", action: input.action, vehicleId: input.vehicleId, authenticated: Boolean(openid), errorMessage })
    console.error({ function: "vehicleCalendarManage", action: input.action, vehicleId: input.vehicleId, authenticated: Boolean(openid), errorMessage, createdAt: new Date().toISOString() })
    return createError("INTERNAL_ERROR", "车辆日历更新失败，请稍后重试")
  }
}

module.exports._test = { enumerateDates, dayDocumentId, validateRangeInput, validatePriceInput }
