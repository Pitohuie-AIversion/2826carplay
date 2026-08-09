const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_KEY = "operation_settings"
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const BOOKING_FIELDS = {
  _id: true,
  openid: true,
  vehicleId: true,
  vehicleName: true,
  startDate: true,
  endDate: true,
  status: true,
  latestQuoteId: true,
  latestQuoteVersion: true
}
const QUOTE_FIELDS = {
  _id: true,
  bookingId: true,
  vehicleId: true,
  vehicleName: true,
  startDate: true,
  endDate: true,
  rentalDays: true,
  baseRentalCents: true,
  protectionCents: true,
  serviceFeeCents: true,
  deliveryFeeCents: true,
  otherFeeCents: true,
  totalCents: true,
  depositText: true,
  validUntil: true,
  customerNote: true,
  version: true,
  status: true,
  sendRequestId: true,
  createdAt: true,
  updatedAt: true,
  sentAt: true
}
const SENDABLE_STATUSES = ["contacted", "adjustment_requested"]
const DRAFTABLE_STATUSES = ["pending", "contacted", "adjustment_requested"]
const AMOUNT_KEYS = [
  "baseRentalCents",
  "protectionCents",
  "serviceFeeCents",
  "deliveryFeeCents",
  "otherFeeCents"
]
const MAX_AMOUNT_CENTS = 1000000000

function createError(code, message, details) {
  const result = { ok: false, code: String(code || "VALIDATION_ERROR"), message: String(message || "参数校验失败") }
  if (details !== undefined) result.details = details
  return result
}

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : []
}

function hasCapability(record) {
  if (!record || typeof record !== "object") return false
  if (record.role === "admin" || record.isAdmin === true || record.admin === true) return true
  if (Array.isArray(record.roles) && record.roles.includes("admin")) return true
  const merged = normalizeStringArray([record.role].concat(record.roles || [], record.permissions || []))
  return merged.includes("booking_manage") || merged.includes("booking_manager")
}

async function canManage(openid) {
  if (!openid) return false
  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some(hasCapability)
}

function parseAmountToCents(value) {
  const text = String(value === undefined || value === null ? "" : value).trim()
  if (!/^(0|[1-9]\d{0,7})(\.\d{1,2})?$/.test(text)) return null
  const parts = text.split(".")
  const cents = Number(parts[0]) * 100 + Number((parts[1] || "").padEnd(2, "0"))
  return Number.isSafeInteger(cents) && cents <= MAX_AMOUNT_CENTS ? cents : null
}

function calculateRentalDays(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return 0
  const start = Date.parse(`${startDate}T00:00:00Z`)
  const end = Date.parse(`${endDate}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.max(1, Math.round((end - start) / 86400000))
}

function normalizeInput(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    action: String(payload.action || "").trim(),
    bookingId: String(payload.bookingId || payload.id || "").trim(),
    quoteId: String(payload.quoteId || "").trim(),
    requestId: String(payload.requestId || "").trim(),
    amounts: {
      baseRentalCents: parseAmountToCents(payload.baseRentalAmount),
      protectionCents: parseAmountToCents(payload.protectionAmount),
      serviceFeeCents: parseAmountToCents(payload.serviceFeeAmount),
      deliveryFeeCents: parseAmountToCents(payload.deliveryFeeAmount),
      otherFeeCents: parseAmountToCents(payload.otherFeeAmount)
    },
    depositText: String(payload.depositText || "").trim().slice(0, 200),
    validUntil: String(payload.validUntil || "").trim(),
    customerNote: String(payload.customerNote || "").trim().slice(0, 300)
  }
}

function validateDraftInput(input) {
  const errors = []
  if (!input.bookingId) errors.push({ field: "bookingId", message: "预约 ID 不能为空" })
  AMOUNT_KEYS.forEach((key) => {
    if (input.amounts[key] === null) errors.push({ field: key, message: "金额应为不超过两位小数的非负数" })
  })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.validUntil)) errors.push({ field: "validUntil", message: "报价有效期格式不正确" })
  if (!input.depositText) errors.push({ field: "depositText", message: "押金说明不能为空" })
  return errors
}

function todayInChina() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function buildQuoteData(input, booking, version, status) {
  const rentalDays = calculateRentalDays(String(booking.startDate || ""), String(booking.endDate || ""))
  const totalCents = AMOUNT_KEYS.reduce((total, key) => total + input.amounts[key], 0)
  return {
    bookingId: input.bookingId,
    vehicleId: String(booking.vehicleId || ""),
    vehicleName: String(booking.vehicleName || ""),
    startDate: String(booking.startDate || ""),
    endDate: String(booking.endDate || ""),
    rentalDays,
    ...input.amounts,
    totalCents,
    depositText: input.depositText,
    validUntil: input.validUntil,
    customerNote: input.customerNote,
    version,
    status
  }
}

function formatTime(value) {
  if (!value) return ""
  if (typeof value === "string") return value
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object" && typeof value.toDate === "function") return value.toDate().toISOString()
  return ""
}

function mapQuote(item) {
  if (!item) return null
  return {
    id: String(item._id || item.id || ""),
    bookingId: String(item.bookingId || ""),
    vehicleId: String(item.vehicleId || ""),
    vehicleName: String(item.vehicleName || ""),
    startDate: String(item.startDate || ""),
    endDate: String(item.endDate || ""),
    rentalDays: Number(item.rentalDays || 0),
    baseRentalCents: Number(item.baseRentalCents || 0),
    protectionCents: Number(item.protectionCents || 0),
    serviceFeeCents: Number(item.serviceFeeCents || 0),
    deliveryFeeCents: Number(item.deliveryFeeCents || 0),
    otherFeeCents: Number(item.otherFeeCents || 0),
    totalCents: Number(item.totalCents || 0),
    depositText: String(item.depositText || ""),
    validUntil: String(item.validUntil || ""),
    customerNote: String(item.customerNote || ""),
    version: Number(item.version || 0),
    status: String(item.status || "draft"),
    createdAt: formatTime(item.createdAt),
    updatedAt: formatTime(item.updatedAt),
    sentAt: formatTime(item.sentAt)
  }
}

function documentMissing(error) {
  const message = String(error && (error.errMsg || error.message) || error || "").toLowerCase()
  return message.includes("not exist") || message.includes("not found") || message.includes("document_not_found") || message.includes("-502005")
}

async function getDocOrNull(collection, id) {
  try {
    const res = await collection.doc(id).field(QUOTE_FIELDS).get()
    return res && res.data ? res.data : null
  } catch (error) {
    if (documentMissing(error)) return null
    throw error
  }
}

async function writeAuditLogBestEffort(payload) {
  try {
    await db.collection("audit_logs").add({ data: { ...payload, createdAt: db.serverDate() } })
  } catch (error) {
    const message = String(error && (error.message || error.errMsg) || error)
    if (!message.includes("Unexpected collection:")) console.error({ function: "bookingQuoteManage", stage: "auditLog", errorMessage: message, createdAt: new Date().toISOString() })
  }
}

async function writeErrorLogBestEffort(payload) {
  try {
    await db.collection("error_logs").add({ data: { ...payload, createdAt: db.serverDate() } })
  } catch (error) {
    const message = String(error && (error.message || error.errMsg) || error)
    if (!message.includes("Unexpected collection:")) console.error({ function: "bookingQuoteManage", stage: "errorLog", errorMessage: message, createdAt: new Date().toISOString() })
  }
}

function normalizeNotificationError(error) {
  return {
    errorCode: String(error && (error.errCode || error.code) || "").slice(0, 80),
    errorMessage: String(error && (error.errMsg || error.message) || error || "发送失败").slice(0, 300)
  }
}

async function readTemplateId() {
  const envValue = String(process.env.BOOKING_STATUS_TEMPLATE_ID || "").trim()
  if (envValue) return envValue
  const res = await db.collection("app_configs").where({ key: CONFIG_KEY }).field({ value: true }).limit(1).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return String(list[0] && list[0].value && list[0].value.bookingStatusTemplateId || "").trim()
}

async function sendQuoteNotificationBestEffort(booking, quote) {
  try {
    const target = String(booking.openid || "").trim()
    const templateId = await readTemplateId()
    if (!target || !templateId) return { status: "skipped", reason: !target ? "missing_target" : "not_configured" }
    if (!cloud.openapi || !cloud.openapi.subscribeMessage || typeof cloud.openapi.subscribeMessage.send !== "function") return { status: "failed", reason: "api_unavailable" }
    await cloud.openapi.subscribeMessage.send({
      touser: target,
      templateId,
      page: `pages/booking-detail/booking-detail?id=${encodeURIComponent(String(booking._id || ""))}`,
      miniprogramState: ["developer", "trial", "formal"].includes(String(process.env.BOOKING_NOTIFY_STATE || "")) ? String(process.env.BOOKING_NOTIFY_STATE) : "formal",
      lang: "zh_CN",
      data: {
        thing1: { value: String(booking.vehicleName || "车辆预约").slice(0, 20) },
        phrase2: { value: "已报价" },
        thing3: { value: `报价 v${quote.version} 已发送，请进入小程序确认`.slice(0, 20) },
        time4: { value: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(11, 16) }
      }
    })
    return { status: "sent", reason: "" }
  } catch (error) {
    const normalized = normalizeNotificationError(error)
    const refused = normalized.errorCode === "43101" || /refuse|not subscribe|未订阅|拒绝/i.test(normalized.errorMessage)
    if (refused) return { status: "not_subscribed", reason: "user_not_subscribed" }
    await writeErrorLogBestEffort({ function: "bookingQuoteManage", stage: "subscribeMessage", bookingId: booking._id || "", quoteId: quote.id || "", ...normalized })
    return { status: "failed", reason: "send_failed" }
  }
}

async function saveDraft(input, openid) {
  const currentRes = await db.collection("bookings").doc(input.bookingId).field(BOOKING_FIELDS).get()
  const booking = currentRes && currentRes.data ? currentRes.data : null
  if (!booking) return createError("NOT_FOUND", "预约不存在")
  const status = String(booking.status || "pending")
  if (!DRAFTABLE_STATUSES.includes(status)) return createError("STATUS_NOT_ALLOWED", "当前预约状态不能编辑报价")
  const rentalDays = calculateRentalDays(String(booking.startDate || ""), String(booking.endDate || ""))
  if (!rentalDays || rentalDays > 365) return createError("VALIDATION_ERROR", "预约租期不合法，无法报价")
  const version = Math.max(0, Number(booking.latestQuoteVersion || 0)) + 1
  const quoteData = buildQuoteData(input, booking, version, "draft")
  const draftId = `${input.bookingId}__draft`
  const existing = await getDocOrNull(db.collection("booking_quotes"), draftId)
  await db.collection("booking_quotes").doc(draftId).set({
    data: {
      ...quoteData,
      createdBy: openid,
      createdAt: existing && existing.createdAt ? existing.createdAt : db.serverDate(),
      updatedBy: openid,
      updatedAt: db.serverDate()
    }
  })
  await writeAuditLogBestEffort({ openid, action: existing ? "bookingQuoteDraftUpdate" : "bookingQuoteDraftCreate", bookingId: input.bookingId, quoteId: draftId, version, totalCents: quoteData.totalCents })
  return { ok: true, action: "saveDraft", updated: true, quote: mapQuote({ _id: draftId, ...quoteData }), message: "报价草稿已保存" }
}

async function sendQuote(input, openid) {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId)) return createError("VALIDATION_ERROR", "发送请求标识不合法")
  const outcome = await db.runTransaction(async (transaction) => {
    const bookingRes = await transaction.collection("bookings").doc(input.bookingId).field(BOOKING_FIELDS).get()
    const booking = bookingRes && bookingRes.data ? bookingRes.data : null
    if (!booking) return { error: createError("NOT_FOUND", "预约不存在") }
    const status = String(booking.status || "pending")
    if (status === "quoted" && booking.latestQuoteId) {
      const latest = await getDocOrNull(transaction.collection("booking_quotes"), String(booking.latestQuoteId))
      if (latest && String(latest.sendRequestId || "") === input.requestId) {
        return { duplicate: true, booking, quote: mapQuote(latest) }
      }
    }
    if (!SENDABLE_STATUSES.includes(status)) return { error: createError("STATUS_NOT_ALLOWED", "请先完成联系，或等待用户提出调整后再发送报价") }
    const draftId = `${input.bookingId}__draft`
    const draft = await getDocOrNull(transaction.collection("booking_quotes"), draftId)
    if (!draft || String(draft.status || "") !== "draft") return { error: createError("DRAFT_NOT_FOUND", "请先保存报价草稿") }
    const version = Math.max(0, Number(booking.latestQuoteVersion || 0)) + 1
    if (Number(draft.version || 0) !== version) return { error: createError("VERSION_CONFLICT", "报价版本已变化，请刷新后重新保存") }
    if (String(draft.validUntil || "") < todayInChina()) return { error: createError("QUOTE_EXPIRED", "报价有效期不能早于今天") }
    const quoteId = `${input.bookingId}__v${version}`
    const existing = await getDocOrNull(transaction.collection("booking_quotes"), quoteId)
    if (existing) {
      if (String(existing.sendRequestId || "") === input.requestId) return { duplicate: true, booking, quote: mapQuote(existing) }
      return { error: createError("VERSION_CONFLICT", "该报价版本已经存在") }
    }
    const { _id: draftDocumentId, ...draftData } = draft
    const sentData = {
      ...draftData,
      status: "sent",
      responseStatus: "pending",
      sendRequestId: input.requestId,
      sentBy: openid,
      sentAt: db.serverDate(),
      updatedBy: openid,
      updatedAt: db.serverDate()
    }
    await transaction.collection("booking_quotes").doc(quoteId).set({ data: sentData })
    await transaction.collection("bookings").doc(input.bookingId).update({
      data: {
        status: "quoted",
        latestQuoteId: quoteId,
        latestQuoteVersion: version,
        quotedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    await transaction.collection("booking_quotes").doc(draftId).remove()
    return { duplicate: false, booking, quote: mapQuote({ _id: quoteId, ...sentData, sentAt: new Date().toISOString() }) }
  })
  if (outcome.error) return outcome.error
  if (!outcome.duplicate) await writeAuditLogBestEffort({ openid, action: "bookingQuoteSend", bookingId: input.bookingId, quoteId: outcome.quote.id, version: outcome.quote.version, totalCents: outcome.quote.totalCents, fromStatus: String(outcome.booking.status || ""), toStatus: "quoted" })
  const notification = outcome.duplicate ? { status: "skipped", reason: "duplicate_request" } : await sendQuoteNotificationBestEffort(outcome.booking, outcome.quote)
  return { ok: true, action: "send", updated: !outcome.duplicate, quote: outcome.quote, bookingStatus: "quoted", notificationStatus: notification.status, notificationReason: notification.reason, message: outcome.duplicate ? "该报价已发送" : "报价已发送" }
}

async function expireQuote(input, openid) {
  if (!input.quoteId) return createError("VALIDATION_ERROR", "报价 ID 不能为空")
  const outcome = await db.runTransaction(async (transaction) => {
    const bookingRes = await transaction.collection("bookings").doc(input.bookingId).field(BOOKING_FIELDS).get()
    const booking = bookingRes && bookingRes.data ? bookingRes.data : null
    if (!booking) return { error: createError("NOT_FOUND", "预约不存在") }
    const quote = await getDocOrNull(transaction.collection("booking_quotes"), input.quoteId)
    if (!quote || String(quote.bookingId || "") !== input.bookingId) return { error: createError("NOT_FOUND", "报价不存在") }
    if (quote.status === "expired" && booking.status === "contacted") return { duplicate: true, quote }
    if (booking.status !== "quoted" || booking.latestQuoteId !== input.quoteId || quote.status !== "sent") return { error: createError("STATUS_NOT_ALLOWED", "当前报价不能标记失效") }
    await transaction.collection("booking_quotes").doc(input.quoteId).update({ data: { status: "expired", responseStatus: "expired", expiredBy: openid, expiredAt: db.serverDate(), updatedAt: db.serverDate() } })
    await transaction.collection("bookings").doc(input.bookingId).update({ data: { status: "contacted", updatedAt: db.serverDate() } })
    return { duplicate: false, quote }
  })
  if (outcome.error) return outcome.error
  if (!outcome.duplicate) await writeAuditLogBestEffort({ openid, action: "bookingQuoteExpire", bookingId: input.bookingId, quoteId: input.quoteId, fromStatus: "quoted", toStatus: "contacted" })
  return { ok: true, action: "expire", updated: !outcome.duplicate, bookingStatus: "contacted", message: outcome.duplicate ? "报价已失效" : "报价已标记失效" }
}

exports.main = async (event) => {
  const context = cloud.getWXContext()
  const openid = String(context && context.OPENID || "").trim()
  const input = normalizeInput(event)
  try {
    if (!(await canManage(openid))) return createError("FORBIDDEN", "权限不足")
    if (!input.bookingId) return createError("VALIDATION_ERROR", "预约 ID 不能为空")
    if (!["saveDraft", "send", "expire"].includes(input.action)) return createError("VALIDATION_ERROR", "报价操作不合法")
    if (input.action === "expire") return expireQuote(input, openid)
    if (input.action === "saveDraft") {
      const errors = validateDraftInput(input)
      if (errors.length) return createError("VALIDATION_ERROR", "报价信息校验失败", { errors })
      return saveDraft(input, openid)
    }
    return sendQuote(input, openid)
  } catch (error) {
    const errorMessage = String(error && (error.message || error.errMsg) || error).slice(0, 300)
    await writeErrorLogBestEffort({ function: "bookingQuoteManage", bookingId: input.bookingId, quoteId: input.quoteId, action: input.action, authenticated: Boolean(openid), errorMessage })
    console.error({ function: "bookingQuoteManage", bookingId: input.bookingId, action: input.action, authenticated: Boolean(openid), errorMessage, stack: error && error.stack || "", createdAt: new Date().toISOString() })
    return createError("INTERNAL_ERROR", "报价操作失败，请稍后重试")
  }
}
