const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const BOOKING_FIELDS = { _id: true, openid: true, status: true, latestQuoteId: true, vehicleId: true, vehicleName: true, startDate: true, endDate: true }
const QUOTE_FIELDS = { _id: true, bookingId: true, status: true, validUntil: true, version: true, sentAt: true, confirmedAt: true, adjustmentRequestedAt: true }
const VEHICLE_FIELDS = { status: true, brandModel: true, plateNumber: true }
const MAX_OCCUPANCY_DAYS = 90

function createError(code, message, details) {
  const result = { ok: false, code: String(code || "VALIDATION_ERROR"), message: String(message || "参数校验失败") }
  if (details !== undefined) result.details = details
  return result
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    bookingId: String(payload.bookingId || payload.id || "").trim(),
    quoteId: String(payload.quoteId || "").trim(),
    action: String(payload.action || "").trim(),
    adjustmentNote: String(payload.adjustmentNote || "").trim().slice(0, 200)
  }
}

function todayInChina() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function enumerateDates(startDate, endDate) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startDate || "")) || !/^\d{4}-\d{2}-\d{2}$/.test(String(endDate || "")) || endDate < startDate) return []
  const dates = []
  const end = Date.parse(`${endDate}T00:00:00.000Z`)
  for (let time = Date.parse(`${startDate}T00:00:00.000Z`); time <= end && dates.length <= MAX_OCCUPANCY_DAYS; time += 86400000) {
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
    const res = await collection.doc(id).field(fields).get()
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
    if (!message.includes("Unexpected collection:")) console.error({ function: "bookingQuoteRespond", stage: "auditLog", errorMessage: message, createdAt: new Date().toISOString() })
  }
}

async function writeErrorLogBestEffort(payload) {
  try {
    await db.collection("error_logs").add({ data: { ...payload, createdAt: db.serverDate() } })
  } catch (error) {
    const message = String(error && (error.message || error.errMsg) || error)
    if (!message.includes("Unexpected collection:")) console.error({ function: "bookingQuoteRespond", stage: "errorLog", errorMessage: message, createdAt: new Date().toISOString() })
  }
}

exports.main = async (event) => {
  const context = cloud.getWXContext()
  const openid = String(context && context.OPENID || "").trim()
  const input = normalizeEvent(event)
  try {
    if (!openid) return createError("UNAUTHORIZED", "未获取到用户身份")
    if (!input.bookingId || !input.quoteId) return createError("VALIDATION_ERROR", "预约 ID 和报价 ID 不能为空")
    if (!["confirm", "requestAdjustment"].includes(input.action)) return createError("VALIDATION_ERROR", "报价响应操作不合法")
    if (input.action === "requestAdjustment" && !input.adjustmentNote) return createError("VALIDATION_ERROR", "请填写需要调整的内容")

    const outcome = await db.runTransaction(async (transaction) => {
      const booking = await getDocOrNull(transaction.collection("bookings"), input.bookingId, BOOKING_FIELDS)
      if (!booking) return { error: createError("NOT_FOUND", "预约不存在") }
      if (String(booking.openid || "").trim() !== openid) return { error: createError("FORBIDDEN", "只能处理自己的报价") }
      const quote = await getDocOrNull(transaction.collection("booking_quotes"), input.quoteId, QUOTE_FIELDS)
      if (!quote || String(quote.bookingId || "") !== input.bookingId) return { error: createError("NOT_FOUND", "报价不存在") }

      const targetStatus = input.action === "confirm" ? "confirmed" : "adjustment_requested"
      if (booking.status === targetStatus && quote.status === targetStatus) return { duplicate: true, targetStatus, quote }
      if (booking.status !== "quoted" || booking.latestQuoteId !== input.quoteId || quote.status !== "sent") return { error: createError("STATUS_NOT_ALLOWED", "当前报价状态已变化，请刷新后重试") }

      if (String(quote.validUntil || "") < todayInChina()) {
        await transaction.collection("booking_quotes").doc(input.quoteId).update({ data: { status: "expired", responseStatus: "expired", expiredAt: db.serverDate(), updatedAt: db.serverDate() } })
        await transaction.collection("bookings").doc(input.bookingId).update({ data: { status: "contacted", updatedAt: db.serverDate() } })
        return { expired: true, quote }
      }

      let occupancy = null
      if (input.action === "confirm") {
        const vehicleId = String(booking.vehicleId || "").trim()
        const dates = enumerateDates(String(booking.startDate || ""), String(booking.endDate || booking.startDate || ""))
        if (!vehicleId || !dates.length || dates.length > MAX_OCCUPANCY_DAYS) {
          return { error: createError("BOOKING_DATES_INVALID", "预约车辆或日期无效，请联系顾问调整后重试") }
        }
        const vehicle = await getDocOrNull(transaction.collection("vehicles"), vehicleId, VEHICLE_FIELDS)
        if (!vehicle) return { error: createError("VEHICLE_NOT_FOUND", "预约车辆已删除，不能确认档期") }
        if (["maintenance", "retired"].includes(String(vehicle.status || ""))) {
          return { error: createError("VEHICLE_NOT_OCCUPIABLE", "车辆维修或已停用，不能确认档期") }
        }
        for (const date of dates) {
          const occupied = await getDocOrNull(transaction.collection("vehicle_calendar_days"), dayDocumentId(vehicleId, date), { blockId: true, bookingId: true, kind: true })
          if (occupied && String(occupied.bookingId || "") !== input.bookingId) {
            return { error: createError("AVAILABILITY_CONFLICT", `${date} 已被占用，请联系顾问调整日期`, { date }) }
          }
        }
        occupancy = {
          id: `booking_${hashId(input.bookingId)}`,
          vehicleId,
          vehicleName: String(booking.vehicleName || vehicle.brandModel || vehicle.plateNumber || "车辆"),
          startDate: String(booking.startDate || ""),
          endDate: String(booking.endDate || booking.startDate || ""),
          dates
        }
      }

      const quoteUpdate = input.action === "confirm"
        ? { status: "confirmed", responseStatus: "confirmed", confirmedAt: db.serverDate(), updatedAt: db.serverDate() }
        : { status: "adjustment_requested", responseStatus: "adjustment_requested", adjustmentNote: input.adjustmentNote, adjustmentRequestedAt: db.serverDate(), updatedAt: db.serverDate() }
      const bookingUpdate = input.action === "confirm"
        ? { status: "confirmed", confirmedAt: db.serverDate(), updatedAt: db.serverDate() }
        : { status: "adjustment_requested", adjustmentRequestedAt: db.serverDate(), updatedAt: db.serverDate() }
      await transaction.collection("booking_quotes").doc(input.quoteId).update({ data: quoteUpdate })
      await transaction.collection("bookings").doc(input.bookingId).update({ data: bookingUpdate })
      if (occupancy) {
        await transaction.collection("vehicle_availability_blocks").doc(occupancy.id).set({ data: {
          vehicleId: occupancy.vehicleId,
          vehicleName: occupancy.vehicleName,
          kind: "booking",
          bookingId: input.bookingId,
          startDate: occupancy.startDate,
          endDate: occupancy.endDate,
          reason: "用户确认有效报价",
          status: "active",
          version: 1,
          createdAt: db.serverDate(),
          updatedAt: db.serverDate()
        } })
        for (const date of occupancy.dates) {
          await transaction.collection("vehicle_calendar_days").doc(dayDocumentId(occupancy.vehicleId, date)).set({ data: {
            vehicleId: occupancy.vehicleId,
            date,
            blockId: occupancy.id,
            kind: "booking",
            bookingId: input.bookingId,
            createdAt: db.serverDate(),
            updatedAt: db.serverDate()
          } })
        }
      }
      return { duplicate: false, targetStatus, quote }
    })

    if (outcome.error) return outcome.error
    if (outcome.expired) {
      await writeAuditLogBestEffort({ openid, action: "bookingQuoteExpire", bookingId: input.bookingId, quoteId: input.quoteId, actor: "customer", fromStatus: "quoted", toStatus: "contacted" })
      return createError("QUOTE_EXPIRED", "报价已过有效期，请联系顾问重新报价")
    }
    if (!outcome.duplicate) await writeAuditLogBestEffort({ openid, action: input.action === "confirm" ? "bookingQuoteConfirm" : "bookingQuoteAdjustmentRequest", bookingId: input.bookingId, quoteId: input.quoteId, version: Number(outcome.quote.version || 0), fromStatus: "quoted", toStatus: outcome.targetStatus })
    return { ok: true, action: input.action, updated: !outcome.duplicate, bookingStatus: outcome.targetStatus, quoteId: input.quoteId, message: input.action === "confirm" ? "报价已确认（尚未付款）" : "调整申请已提交" }
  } catch (error) {
    const errorMessage = String(error && (error.message || error.errMsg) || error).slice(0, 300)
    await writeErrorLogBestEffort({ function: "bookingQuoteRespond", bookingId: input.bookingId, quoteId: input.quoteId, action: input.action, authenticated: Boolean(openid), errorMessage })
    console.error({ function: "bookingQuoteRespond", bookingId: input.bookingId, action: input.action, authenticated: Boolean(openid), errorMessage, stack: error && error.stack || "", createdAt: new Date().toISOString() })
    return createError("INTERNAL_ERROR", "报价响应失败，请稍后重试")
  }
}
