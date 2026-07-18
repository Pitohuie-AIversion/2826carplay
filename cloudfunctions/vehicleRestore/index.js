const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

  const list = []
  value.forEach((item) => {
    const text = String(item || "").trim()
    if (text && !list.includes(text)) {
      list.push(text)
    }
  })
  return list
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

function hasCapability(record, capability) {
  if (hasAdminRole(record)) {
    return true
  }

  const merged = normalizeStringArray([record && record.role].concat((record && record.roles) || [], (record && record.permissions) || []))
  if (capability === "vehicle_manage") {
    return merged.includes("vehicle_manage") || merged.includes("vehicle_manager")
  }

  return false
}

async function hasOpenidCapability(openid, capability) {
  if (!openid) {
    return false
  }

  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasCapability(item, capability))
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
      function: "vehicleRestore",
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
      function: "vehicleRestore",
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
  const id = String((event && event.id) || "").trim()

  try {
    const allowed = await hasOpenidCapability(openid, "vehicle_manage")
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "车辆 ID 不能为空" }]
      })
    }

    const currentRes = await db.collection("vehicles").doc(id).get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    if (current.status !== "retired") {
      return {
        ok: true,
        id,
        alreadyRestored: true,
        message: "车辆当前无需恢复启用"
      }
    }

    await db.collection("vehicles").doc(id).update({
      data: {
        status: "idle",
        updatedAt: db.serverDate()
      }
    })

    await writeAuditLogBestEffort({
      openid,
      action: "vehicleRestore",
      vehicleId: id,
      plateNumber: String(current.plateNumber || "").trim(),
      fromStatus: current.status || "",
      toStatus: "idle"
    })

    return {
      ok: true,
      id,
      alreadyRestored: false,
      message: "车辆已恢复启用"
    }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "vehicleRestore",
      openid,
      vehicleId: id,
      stage: "main",
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      occurredAt: new Date().toISOString()
    })

    console.error({
      function: "vehicleRestore",
      openid,
      id,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "恢复启用失败，请稍后重试")
  }
}
