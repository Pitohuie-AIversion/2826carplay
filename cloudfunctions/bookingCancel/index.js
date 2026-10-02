const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CANCELLABLE_STATUSES = [
  "pending",
  "contacted",
  "quoted",
  "adjustment_requested",
  "confirmed"
]
const BOOKING_CANCEL_FIELDS = {
  openid: true,
  vehicleId: true,
  status: true,
  calendarSyncVersion: true
}
const MAX_TRANSACTION_OPERATIONS = 100

function bookingBlockId(bookingId) {
  const digest = crypto.createHash("sha256").update(String(bookingId || "")).digest("hex").slice(0, 24)
  return `booking_${digest}`
}

function documentMissing(error) {
  const message = String(error && (error.errMsg || error.message) || error || "").toLowerCase()
  return message.includes("not exist") || message.includes("not found") || message.includes("document_not_found") || message.includes("-502005")
}

async function readDocument(collection, id, fields) {
  try {
    const res = await collection.doc(id).field(fields).get()
    return res && res.data || null
  } catch (error) {
    if (documentMissing(error)) return null
    throw error
  }
}

function createError(code, message, details) {
  const result = {
    ok: false,
    code: String(code || "VALIDATION_ERROR"),
    message: String(message || "参数校验失败")
  }

  if (details !== undefined) {
    result.details = details
  }

  return result
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim()
  }
}

async function writeErrorLogBestEffort(payload) {
  try {
    await db.collection("error_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "bookingCancel",
      stage: "errorLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

async function writeAuditLogBestEffort(payload) {
  try {
    await db.collection("audit_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "bookingCancel",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }

    if (!input.id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      })
    }

    const current = await readDocument(db.collection("bookings"), input.id, BOOKING_CANCEL_FIELDS)

    if (!current) {
      return createError("NOT_FOUND", "预约不存在")
    }

    if (String(current.openid || "").trim() !== openid) {
      return createError("FORBIDDEN", "只能取消自己的预约")
    }

    const status = String(current.status || "pending").trim() || "pending"
    if (status !== "cancelled" && !CANCELLABLE_STATUSES.includes(status)) {
      return createError("STATUS_NOT_ALLOWED", "当前预约状态不可取消", {
        allowed: CANCELLABLE_STATUSES
      })
    }

    // CloudBase transactions accept document operations only. Query candidate IDs
    // first, then recheck their ownership together with the booking in a transaction.
    let dayIds = []
    const releaseOccupancy = status === "confirmed" || status === "cancelled"
    if (releaseOccupancy) {
      const dayRes = await db.collection("vehicle_calendar_days").where({ bookingId: input.id }).limit(91).get()
      const days = dayRes && Array.isArray(dayRes.data) ? dayRes.data : []
      if (days.length > 90) return createError("OCCUPANCY_LIMIT", "预约占用数据异常，请联系顾问处理")
      dayIds = [...new Set(days.map((day) => String(day && day._id || "")).filter(Boolean))]
    }
    const outcome = await db.runTransaction(async (transaction) => {
      const booking = await readDocument(transaction.collection("bookings"), input.id, BOOKING_CANCEL_FIELDS)
      if (!booking) return createError("NOT_FOUND", "预约不存在")
      if (String(booking.openid || "").trim() !== openid) return createError("FORBIDDEN", "只能取消自己的预约")
      const latestStatus = String(booking.status || "pending").trim() || "pending"
      if (latestStatus !== status) return createError("STATUS_CONFLICT", "预约状态已发生变化，请刷新后重试")
      if (Number(booking.calendarSyncVersion || 0) !== Number(current.calendarSyncVersion || 0)) {
        return createError("STATUS_CONFLICT", "预约档期已发生变化，请刷新后重试")
      }
      const ownedDayIds = []
      for (const id of dayIds) {
        const day = await readDocument(transaction.collection("vehicle_calendar_days"), id, { bookingId: true })
        if (day && String(day.bookingId || "") === input.id) ownedDayIds.push(id)
      }
      const blockId = bookingBlockId(input.id)
      const block = releaseOccupancy
        ? await readDocument(transaction.collection("vehicle_availability_blocks"), blockId, { bookingId: true, status: true })
        : null
      const ownsBlock = Boolean(block && String(block.bookingId || "") === input.id)
      const needsBlockRelease = ownsBlock && block.status !== "released"
      const operationCount = 1 + dayIds.length + (releaseOccupancy ? 1 : 0) +
        (status !== "cancelled" ? 1 : 0) + ownedDayIds.length + (needsBlockRelease ? 1 : 0)
      if (operationCount > MAX_TRANSACTION_OPERATIONS) {
        return createError("OCCUPANCY_LIMIT", "此预约占用日期较多，请联系顾问处理取消")
      }
      if (status !== "cancelled") {
        await transaction.collection("bookings").doc(input.id).update({ data: { status: "cancelled", updatedAt: db.serverDate() } })
      }
      for (const id of ownedDayIds) await transaction.collection("vehicle_calendar_days").doc(id).remove()
      if (needsBlockRelease) {
        await transaction.collection("vehicle_availability_blocks").doc(blockId).update({ data: {
          status: "released",
          releaseReason: "用户取消已确认预约",
          releasedBy: openid,
          releasedAt: db.serverDate(),
          updatedAt: db.serverDate()
        } })
      }
      return { ok: true }
    })
    if (!outcome.ok) return outcome

    if (status !== "cancelled") await writeAuditLogBestEffort({
      openid,
      action: "bookingCancel",
      bookingId: input.id,
      vehicleId: current.vehicleId || "",
      fromStatus: status,
      toStatus: "cancelled"
    })

    return {
      ok: true,
      id: input.id,
      status: "cancelled",
      message: "预约已取消"
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    await writeErrorLogBestEffort({
      function: "bookingCancel",
      bookingId: input.id,
      stage: "main",
      authenticated: Boolean(openid),
      errorMessage,
      occurredAt: new Date().toISOString()
    })

    console.error({
      function: "bookingCancel",
      authenticated: Boolean(openid),
      id: input.id,
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "取消预约失败，请稍后重试")
  }
}
