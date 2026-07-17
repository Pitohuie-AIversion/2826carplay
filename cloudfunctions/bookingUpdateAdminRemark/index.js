const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const MAX_REMARK_LENGTH = 200

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
  if (capability === "booking_manage") {
    return merged.includes("booking_manage") || merged.includes("booking_manager")
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
      function: "bookingUpdateAdminRemark",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim(),
    adminRemark: String(payload.adminRemark || "").trim()
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    const allowed = await hasOpenidCapability(openid, "booking_manage")
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!input.id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      })
    }

    if (input.adminRemark.length > MAX_REMARK_LENGTH) {
      return createError("VALIDATION_ERROR", "备注内容过长", {
        errors: [
          {
            field: "adminRemark",
            message: `管理员备注不能超过 ${MAX_REMARK_LENGTH} 个字符`
          }
        ]
      })
    }

    const currentRes = await db.collection("bookings").doc(input.id).get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "预约不存在")
    }

    await db.collection("bookings").doc(input.id).update({
      data: {
        adminRemark: input.adminRemark,
        adminRemarkUpdatedAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    await writeAuditLogBestEffort({
      openid,
      action: "bookingUpdateAdminRemark",
      bookingId: input.id,
      remarkLength: input.adminRemark.length
    })

    return {
      ok: true,
      id: input.id,
      adminRemark: input.adminRemark,
      message: "管理员备注已保存"
    }
  } catch (error) {
    console.error({
      function: "bookingUpdateAdminRemark",
      openid,
      id: input.id,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "保存管理员备注失败，请稍后重试")
  }
}
