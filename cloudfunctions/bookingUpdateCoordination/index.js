const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const PRIORITY_VALUES = ["priority", "normal", "standby"]
const COORDINATION_VALUES = ["pending", "coordinating", "resolved"]
const EDITABLE_BOOKING_STATUSES = ["pending", "contacted"]

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
function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => String(item || "").trim()).filter(Boolean)
}

function hasAccess(record) {
  if (!record || typeof record !== "object") {
    return false
  }
  if (
    record.role === "admin" ||
    record.isAdmin === true ||
    record.admin === true ||
    (Array.isArray(record.roles) && record.roles.includes("admin"))
  ) {
    return true
  }
  const values = normalizeStringArray(
    [record.role].concat(record.roles || [], record.permissions || [])
  )
  return values.includes("booking_manage") || values.includes("booking_manager")
}

async function canManage(openid) {
  if (!openid) {
    return false
  }
  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some(hasAccess)
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim(),
    schedulePriority: String(payload.schedulePriority || "").trim(),
    coordinationStatus: String(payload.coordinationStatus || "").trim()
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
    if (!String(message).includes("Unexpected collection:")) {
      console.error({
        function: "bookingUpdateCoordination",
        stage: "auditLog",
        errorMessage: message,
        createdAt: new Date().toISOString()
      })
    }
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
  } catch (error) {}
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    if (!(await canManage(openid))) {
      return createError("FORBIDDEN", "权限不足")
    }
    if (!input.id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      })
    }
    if (!PRIORITY_VALUES.includes(input.schedulePriority)) {
      return createError("VALIDATION_ERROR", "优先级不正确", {
        errors: [{ field: "schedulePriority", message: "请选择有效的预约优先级" }]
      })
    }
    if (!COORDINATION_VALUES.includes(input.coordinationStatus)) {
      return createError("VALIDATION_ERROR", "协调状态不正确", {
        errors: [{ field: "coordinationStatus", message: "请选择有效的协调状态" }]
      })
    }

    const bookingRef = db.collection("bookings").doc(input.id)
    const currentRes = await bookingRef.get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "预约不存在")
    }

    const bookingStatus = String(current.status || "pending").trim() || "pending"
    if (!EDITABLE_BOOKING_STATUSES.includes(bookingStatus)) {
      return createError("BOOKING_NOT_EDITABLE", "已结束的预约不能修改协调安排")
    }

    const fromPriority = PRIORITY_VALUES.includes(current.schedulePriority)
      ? current.schedulePriority
      : "normal"
    const fromCoordinationStatus = COORDINATION_VALUES.includes(current.coordinationStatus)
      ? current.coordinationStatus
      : "pending"

    if (
      fromPriority === input.schedulePriority &&
      fromCoordinationStatus === input.coordinationStatus
    ) {
      return {
        ok: true,
        id: input.id,
        schedulePriority: fromPriority,
        coordinationStatus: fromCoordinationStatus,
        changed: false,
        message: "协调安排未发生变化"
      }
    }

    await bookingRef.update({
      data: {
        schedulePriority: input.schedulePriority,
        coordinationStatus: input.coordinationStatus,
        coordinationUpdatedAt: db.serverDate(),
        coordinationUpdatedBy: openid,
        updatedAt: db.serverDate()
      }
    })

    await writeAuditLogBestEffort({
      openid,
      action: "bookingUpdateCoordination",
      bookingId: input.id,
      fromPriority,
      toPriority: input.schedulePriority,
      fromCoordinationStatus,
      toCoordinationStatus: input.coordinationStatus
    })

    return {
      ok: true,
      id: input.id,
      schedulePriority: input.schedulePriority,
      coordinationStatus: input.coordinationStatus,
      changed: true,
      message: "协调安排已更新"
    }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "bookingUpdateCoordination",
      openid,
      bookingId: input.id,
      stage: "main",
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      occurredAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "协调安排更新失败，请稍后重试")
  }
}
