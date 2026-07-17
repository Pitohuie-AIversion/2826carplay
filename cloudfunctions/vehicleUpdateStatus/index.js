const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const VEHICLE_STATUSES = ["active", "idle", "maintenance", "retired"]

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

function hasAdminRole(record) {
  if (!record || typeof record !== "object") {
    return false
  }

  if (record.role === "admin") {
    return true
  }

  if (Array.isArray(record.roles) && record.roles.includes("admin")) {
    return true
  }

  if (record.isAdmin === true || record.admin === true) {
    return true
  }

  return false
}

async function isAdminOpenid(openid) {
  if (!openid) {
    return false
  }

  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasAdminRole(item))
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
      function: "vehicleUpdateStatus",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

function normalizeInput(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim(),
    status: String(payload.status || "").trim()
  }
}

function validateInput(input) {
  const errors = []

  if (!input.id) {
    errors.push({ field: "id", message: "车辆 ID 不能为空" })
  }

  if (!input.status || !VEHICLE_STATUSES.includes(input.status)) {
    errors.push({
      field: "status",
      message: "车辆状态不合法",
      value: input.status,
      allowed: VEHICLE_STATUSES
    })
  }

  if (errors.length) {
    return createError("VALIDATION_ERROR", "参数校验失败", { errors })
  }

  return { ok: true, value: input }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeInput(event)

  try {
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    const check = validateInput(input)
    if (!check.ok) {
      return check
    }

    const currentRes = await db.collection("vehicles").doc(input.id).get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    const currentStatus = String(current.status || "").trim()
    if (currentStatus === input.status) {
      return {
        ok: true,
        id: input.id,
        alreadyUpdated: true,
        status: input.status,
        message: "车辆状态未变化"
      }
    }

    await db.collection("vehicles").doc(input.id).update({
      data: {
        status: input.status,
        updatedAt: db.serverDate()
      }
    })

    await writeAuditLogBestEffort({
      openid,
      action: "vehicleUpdateStatus",
      vehicleId: input.id,
      fromStatus: currentStatus,
      toStatus: input.status
    })

    return {
      ok: true,
      id: input.id,
      alreadyUpdated: false,
      status: input.status,
      message: "车辆状态已更新"
    }
  } catch (error) {
    console.error({
      function: "vehicleUpdateStatus",
      openid,
      id: input.id,
      status: input.status,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "更新车辆状态失败，请稍后重试")
  }
}
