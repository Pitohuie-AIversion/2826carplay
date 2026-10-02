const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const ALLOWED_BLOCK_KINDS = ["maintenance", "hold", "unavailable"]
const MAX_RANGE_DAYS = 90
const MAX_OCCUPANCY_DAYS = 47
const MAX_TRANSACTION_OPERATIONS = 100
const MAX_PRICE_RULES = 2000
const PRICE_RULE_RETRIES = 3
const CREATE_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,64}$/
const BLOCK_CREATE_FIELDS = ["vehicleId", "kind", "startDate", "endDate", "reason"]
const PRICE_CREATE_FIELDS = ["vehicleId", "label", "startDate", "endDate", "dailyPrice", "reason"]
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const VEHICLE_FIELDS = { brandModel: true, plateNumber: true, status: true, priceDay: true, priceRuleVersion: true }
const BOOKING_FIELDS = { _id: true, vehicleId: true, vehicleName: true, startDate: true, endDate: true, status: true, calendarSyncVersion: true }

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
    expectedVersion: payload.expectedVersion,
    requestId: String(payload.requestId || "").trim(),
    dailyPrice: payload.dailyPrice === null || payload.dailyPrice === undefined || String(payload.dailyPrice).trim() === "" ? NaN : Number(payload.dailyPrice)
  }
}

function sameCalendarInput(current, input, fields) {
  return fields.every((field) => current[field] === input[field])
}

function creationIdentity(input, openid, prefix, fields) {
  if (!input.requestId) return { id: `${prefix}_${crypto.randomBytes(16).toString("hex")}`, metadata: {} }
  const id = `${prefix}_${crypto.createHash("sha256").update(JSON.stringify([openid, input.action, input.requestId])).digest("hex").slice(0, 32)}`
  const payload = Object.fromEntries(fields.map((field) => [field, input[field]]))
  const createPayloadHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex")
  return { id, metadata: { createRequestId: input.requestId, createPayloadHash } }
}

async function readCreatedRequest(collection, identity, openid, idField) {
  const current = await getDocOrNull(collection, identity.id)
  if (!current) return null
  if (current.createdBy !== openid || current.createRequestId !== identity.metadata.createRequestId || current.createPayloadHash !== identity.metadata.createPayloadHash) {
    return { error: createError("IDEMPOTENCY_CONFLICT", "本次请求标识已用于其他内容，请重新填写并提交") }
  }
  return { [idField]: identity.id, duplicate: true, vehicleId: current.vehicleId || "", status: current.status || "", version: Number(current.version || 1) }
}

function checkCalendarVersion(current, input) {
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 1 || input.expectedVersion !== Number(current.version || 1)) {
    return createError("CALENDAR_VERSION_CONFLICT", "记录已被修改或缺少版本，请重新选择调整并核对后保存；当前草稿已保留")
  }
  return null
}

function validateRangeInput(input, requireKind) {
  const errors = []
  if (!input.vehicleId || input.vehicleId.length > 128) errors.push({ field: "vehicleId", message: "请选择车辆" })
  const allowedKinds = ALLOWED_BLOCK_KINDS
  if (requireKind && !allowedKinds.includes(input.kind)) errors.push({ field: "kind", message: "不可用类型不合法" })
  if (!isValidDate(input.startDate)) errors.push({ field: "startDate", message: "开始日期格式不正确" })
  if (!isValidDate(input.endDate) || input.endDate < input.startDate) errors.push({ field: "endDate", message: "结束日期格式不正确" })
  const dates = enumerateDates(input.startDate, input.endDate)
  const maxDays = requireKind ? MAX_OCCUPANCY_DAYS : MAX_RANGE_DAYS
  if (!dates.length || dates.length > maxDays) errors.push({ field: "endDate", message: `单次区间最多 ${maxDays} 天` })
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

function transactionRangeError() {
  return { error: createError("OCCUPANCY_RANGE_TOO_LARGE", "本次调整涉及日期过多，请缩短区间；历史长区间请联系管理员核对后处理") }
}

function blockDateIds(block) {
  const dates = enumerateDates(String(block.startDate || ""), String(block.endDate || block.startDate || ""))
  if (!block.vehicleId || !dates.length || dates.length > MAX_RANGE_DAYS) return null
  return dates.map((date) => dayDocumentId(block.vehicleId, date))
}

async function readBlockDays(transaction, blockId, ids, dayCache) {
  const days = []
  for (const id of ids) {
    const day = await getDocOrNull(transaction.collection("vehicle_calendar_days"), id, { blockId: true, kind: true, date: true })
    dayCache.set(id, day)
    if (day && String(day.blockId || "") === blockId) days.push({ ...day, _id: id })
  }
  return days
}

async function ensureDatesFree(transaction, vehicleId, dates, ignoredBlockId, dayCache = new Map()) {
  for (const date of dates) {
    const id = dayDocumentId(vehicleId, date)
    const occupied = dayCache.has(id) ? dayCache.get(id) : await getDocOrNull(transaction.collection("vehicle_calendar_days"), id, { blockId: true, kind: true, date: true })
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
  const identity = creationIdentity(input, openid, "block", BLOCK_CREATE_FIELDS)
  const blockId = identity.id
  return db.runTransaction(async (transaction) => {
    if (input.requestId) {
      const existing = await readCreatedRequest(transaction.collection("vehicle_availability_blocks"), identity, openid, "blockId")
      if (existing) return existing
    }
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
        ...identity.metadata,
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
    if (!vehicleId || !dates.length || dates.length > MAX_OCCUPANCY_DAYS) return { error: createError("BOOKING_DATES_INVALID", `预约车辆或日期无效，占用最长 ${MAX_OCCUPANCY_DAYS} 天`) }
    const vehicleResult = await assertVehicleAvailable(transaction.collection("vehicles"), vehicleId)
    if (vehicleResult.error) return vehicleResult
    for (const date of dates) {
      const occupied = await getDocOrNull(transaction.collection("vehicle_calendar_days"), dayDocumentId(vehicleId, date), { bookingId: true, kind: true, date: true })
      if (occupied && String(occupied.bookingId || "") !== input.id) return { error: createError("AVAILABILITY_CONFLICT", `${date} 已被其他占用覆盖，不能同步历史预约`, { date }) }
    }
    const blockId = `booking_${hashId(input.id)}`
    // Cancellation and terminal transitions write this booking as well. A shared
    // write prevents a stale confirmed snapshot from creating occupancy afterward.
    await transaction.collection("bookings").doc(input.id).update({ data: {
      calendarSyncVersion: Number(booking.calendarSyncVersion || 0) + 1
    } })
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
    if (current.kind === "booking" || current.bookingId) return { error: createError("BOOKING_BLOCK_PROTECTED", "预约占用请通过预约管理调整") }
    if (String(current.kind || "") !== input.kind) return { error: createError("VALIDATION_ERROR", "调整时不能改变档期类型") }
    if (sameCalendarInput(current, input, ["vehicleId", "kind", "startDate", "endDate", "reason"])) return { blockId: input.id, duplicate: true, version: Number(current.version || 1) }
    const versionError = checkCalendarVersion(current, input)
    if (versionError) return { error: versionError }
    const vehicleResult = await assertVehicleAvailable(transaction.collection("vehicles"), input.vehicleId)
    if (vehicleResult.error) return vehicleResult
    const oldIds = blockDateIds(current)
    const nextIds = new Set(validation.dates.map((date) => dayDocumentId(input.vehicleId, date)))
    // One read and at most one write per day, plus block read/update and vehicle read.
    if (!oldIds || 3 + 2 * new Set(oldIds.concat([...nextIds])).size > MAX_TRANSACTION_OPERATIONS) return transactionRangeError()
    const dayCache = new Map()
    const oldDays = await readBlockDays(transaction, input.id, oldIds, dayCache)
    const conflict = await ensureDatesFree(transaction, input.vehicleId, validation.dates, input.id, dayCache)
    if (conflict) return { error: conflict }
    await removeDays(transaction, oldDays.filter((day) => !nextIds.has(day._id)))
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
    if (current.kind === "booking" || current.bookingId) return { error: createError("BOOKING_BLOCK_PROTECTED", "预约占用请通过预约管理释放") }
    if (String(current.status || "") === "released") return { blockId: input.id, duplicate: true, version: Number(current.version || 1) }
    if (String(current.status || "") !== "active") return { error: createError("STATUS_NOT_ALLOWED", "当前档期不能释放") }
    const versionError = checkCalendarVersion(current, input)
    if (versionError) return { error: versionError }
    const ids = blockDateIds(current)
    if (!ids || 2 + 2 * ids.length > MAX_TRANSACTION_OPERATIONS) return transactionRangeError()
    const days = await readBlockDays(transaction, input.id, ids, new Map())
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

function priceRuleVersion(vehicle) {
  return Number(vehicle && vehicle.priceRuleVersion || 0)
}

async function readActivePriceRules(vehicleId) {
  const list = []
  for (let skip = 0; skip <= MAX_PRICE_RULES; skip += 100) {
    const res = await db.collection("vehicle_price_rules").where({ vehicleId, status: "active" })
      .field({ _id: true, startDate: true, endDate: true }).orderBy("_id", "asc").skip(skip).limit(100).get()
    const batch = res && Array.isArray(res.data) ? res.data : []
    list.push(...batch)
    if (list.length > MAX_PRICE_RULES) return { error: createError("PRICE_RULE_LIMIT", "当前价格规则过多，请先停用已过期规则") }
    if (batch.length < 100) return { list }
  }
  return { list }
}

async function savePriceRule(input, openid, isUpdate) {
  const validation = validatePriceInput(input)
  if (validation.errors.length) return { error: createError("VALIDATION_ERROR", "参数校验失败", { errors: validation.errors }) }
  const identity = isUpdate ? null : creationIdentity(input, openid, "price", PRICE_CREATE_FIELDS)
  const ruleId = isUpdate ? input.id : identity.id
  if (isUpdate && !ruleId) return { error: createError("VALIDATION_ERROR", "价格规则 ID 不能为空") }
  if (!isUpdate && input.requestId) {
    const existing = await readCreatedRequest(db.collection("vehicle_price_rules"), identity, openid, "ruleId")
    if (existing) return existing
  }
  for (let attempt = 0; attempt < PRICE_RULE_RETRIES; attempt += 1) {
    const expectedRule = isUpdate ? await getDocOrNull(db.collection("vehicle_price_rules"), ruleId, { vehicleId: true, status: true, version: true }) : null
    if (isUpdate && (!expectedRule || expectedRule.status !== "active")) return { error: createError("STATUS_NOT_ALLOWED", "价格规则不存在或已停用") }
    const vehicleIds = [...new Set([input.vehicleId, expectedRule && expectedRule.vehicleId].filter(Boolean))].sort()
    const expectedVehicles = new Map()
    // Read revisions before the query. Every price-rule writer advances these revisions
    // in the same transaction as its rule, so a changed query snapshot cannot be committed.
    for (const vehicleId of vehicleIds) expectedVehicles.set(vehicleId, await getDocOrNull(db.collection("vehicles"), vehicleId, VEHICLE_FIELDS))
    const activeRules = await readActivePriceRules(input.vehicleId)
    if (activeRules.error) return activeRules
    const overlapping = activeRules.list.find((item) => String(item._id || "") !== ruleId && String(item.startDate || "") <= input.endDate && String(item.endDate || item.startDate || "") >= input.startDate)
    const outcome = await db.runTransaction(async (transaction) => {
      if (!isUpdate && input.requestId) {
        const existing = await readCreatedRequest(transaction.collection("vehicle_price_rules"), identity, openid, "ruleId")
        if (existing) return existing
      }
      const vehicles = new Map()
      for (const vehicleId of vehicleIds) {
        const vehicle = await getDocOrNull(transaction.collection("vehicles"), vehicleId, VEHICLE_FIELDS)
        if (priceRuleVersion(vehicle) !== priceRuleVersion(expectedVehicles.get(vehicleId))) return { retry: true }
        vehicles.set(vehicleId, vehicle)
      }
      const vehicle = vehicles.get(input.vehicleId)
      if (!vehicle) return { error: createError("NOT_FOUND", "车辆不存在") }
      if (["maintenance", "retired"].includes(String(vehicle.status || ""))) return { error: createError("VEHICLE_NOT_OCCUPIABLE", "维修或已停用车辆不能新增价格规则") }
      const current = isUpdate ? await getDocOrNull(transaction.collection("vehicle_price_rules"), ruleId) : null
      if (isUpdate && (!current || current.status !== "active")) return { error: createError("STATUS_NOT_ALLOWED", "价格规则不存在或已停用") }
      if (current && sameCalendarInput(current, input, ["vehicleId", "label", "startDate", "endDate", "dailyPrice", "reason"])) return { ruleId, duplicate: true, version: Number(current.version || 1) }
      if (current) {
        const versionError = checkCalendarVersion(current, input)
        if (versionError) return { error: versionError }
      }
      if (current && (current.vehicleId !== expectedRule.vehicleId || Number(current.version || 0) !== Number(expectedRule.version || 0))) return { retry: true }
      if (overlapping) return { error: createError("PRICE_RULE_CONFLICT", "所选日期已有特殊价格规则，请调整或先停用原规则") }
      // A shared vehicle write serializes both new rules and changes to existing rules.
      for (const vehicleId of vehicleIds) {
        const guard = vehicles.get(vehicleId)
        if (guard) await transaction.collection("vehicles").doc(vehicleId).update({ data: { priceRuleVersion: priceRuleVersion(guard) + 1 } })
      }
      const data = {
        vehicleId: input.vehicleId,
        vehicleName: String(vehicle.brandModel || vehicle.plateNumber || "车辆"),
        label: input.label, startDate: input.startDate, endDate: input.endDate,
        dailyPrice: input.dailyPrice, reason: input.reason, status: "active",
        version: (current ? Number(current.version || 1) : 0) + 1,
        updatedBy: openid, updatedAt: db.serverDate()
      }
      if (isUpdate) await transaction.collection("vehicle_price_rules").doc(ruleId).update({ data })
      else await transaction.collection("vehicle_price_rules").doc(ruleId).set({ data: { ...data, ...identity.metadata, createdBy: openid, createdAt: db.serverDate() } })
      return { ruleId, vehicleId: input.vehicleId, startDate: input.startDate, endDate: input.endDate, dailyPrice: input.dailyPrice }
    })
    if (!outcome.retry) return outcome
  }
  return { error: createError("PRICE_RULE_CHANGED", "价格规则正在被其他人调整，请刷新后重试") }
}

async function releasePriceRule(input, openid) {
  if (!input.id || !input.reason) return { error: createError("VALIDATION_ERROR", "价格规则和停用原因不能为空") }
  return db.runTransaction(async (transaction) => {
    const current = await getDocOrNull(transaction.collection("vehicle_price_rules"), input.id)
    if (!current) return { error: createError("NOT_FOUND", "价格规则不存在") }
    if (String(current.status || "") !== "active") return { duplicate: true, ruleId: input.id }
    const versionError = checkCalendarVersion(current, input)
    if (versionError) return { error: versionError }
    const vehicle = current.vehicleId ? await getDocOrNull(transaction.collection("vehicles"), current.vehicleId, { priceRuleVersion: true }) : null
    if (vehicle) await transaction.collection("vehicles").doc(current.vehicleId).update({ data: { priceRuleVersion: priceRuleVersion(vehicle) + 1 } })
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
    if (["createBlock", "createPriceRule"].includes(input.action) && input.requestId && !CREATE_REQUEST_ID_PATTERN.test(input.requestId)) {
      return createError("VALIDATION_ERROR", "请求标识格式不正确")
    }
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
    if (!outcome.duplicate) await writeAuditLogBestEffort({
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
