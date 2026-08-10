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
  status: true
}

function bookingBlockId(bookingId) {
  const digest = crypto.createHash("sha256").update(String(bookingId || "")).digest("hex").slice(0, 24)
  return `booking_${digest}`
}

async function releaseBookingOccupancy(bookingId, openid) {
  return db.runTransaction(async (transaction) => {
    const dayRes = await transaction.collection("vehicle_calendar_days").where({ bookingId }).limit(91).get()
    const days = dayRes && Array.isArray(dayRes.data) ? dayRes.data : []
    for (const day of days) {
      if (day && day._id) await transaction.collection("vehicle_calendar_days").doc(day._id).remove()
    }
    try {
      await transaction.collection("vehicle_availability_blocks").doc(bookingBlockId(bookingId)).update({ data: {
        status: "released",
        releaseReason: "用户取消已确认预约",
        releasedBy: openid,
        releasedAt: db.serverDate(),
        updatedAt: db.serverDate()
      } })
    } catch (error) {
      const message = String(error && (error.message || error.errMsg) || error).toLowerCase()
      if (!message.includes("not exist") && !message.includes("not found") && !message.includes("-502005")) throw error
    }
    return days.length
  })
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

    const currentRes = await db
      .collection("bookings")
      .doc(input.id)
      .field(BOOKING_CANCEL_FIELDS)
      .get()
    const current = currentRes && currentRes.data ? currentRes.data : null

    if (!current) {
      return createError("NOT_FOUND", "预约不存在")
    }

    if (String(current.openid || "").trim() !== openid) {
      return createError("FORBIDDEN", "只能取消自己的预约")
    }

    const status = String(current.status || "pending").trim() || "pending"
    if (!CANCELLABLE_STATUSES.includes(status)) {
      return createError("STATUS_NOT_ALLOWED", "当前预约状态不可取消", {
        allowed: CANCELLABLE_STATUSES
      })
    }

    const updateRes = await db.collection("bookings").where({
      _id: input.id,
      openid,
      status
    }).update({
      data: {
        status: "cancelled",
        updatedAt: db.serverDate()
      }
    })
    const updatedCount = Number(updateRes && updateRes.stats && updateRes.stats.updated) || 0
    if (updatedCount < 1) {
      return createError("STATUS_CONFLICT", "预约状态已发生变化，请刷新后重试")
    }

    if (status === "confirmed" && typeof db.runTransaction === "function") {
      await releaseBookingOccupancy(input.id, openid)
    }

    await writeAuditLogBestEffort({
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
