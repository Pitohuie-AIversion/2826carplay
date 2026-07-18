const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CANCELLABLE_STATUSES = ["pending", "contacted"]

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

    const currentRes = await db.collection("bookings").doc(input.id).get()
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

    await db.collection("bookings").doc(input.id).update({
      data: {
        status: "cancelled",
        updatedAt: db.serverDate()
      }
    })

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
    await writeErrorLogBestEffort({
      function: "bookingCancel",
      openid,
      bookingId: input.id,
      stage: "main",
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      occurredAt: new Date().toISOString()
    })

    console.error({
      function: "bookingCancel",
      openid,
      id: input.id,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "取消预约失败，请稍后重试")
  }
}
