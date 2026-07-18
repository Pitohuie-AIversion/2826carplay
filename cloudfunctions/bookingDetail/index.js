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

function formatTime(input) {
  if (!input) {
    return ""
  }

  if (typeof input === "string") {
    return input
  }

  if (input instanceof Date) {
    return input.toISOString()
  }

  if (typeof input === "object" && typeof input.toDate === "function") {
    return input.toDate().toISOString()
  }

  return ""
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
      function: "bookingDetail",
      stage: "errorLog",
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
    const allowed = await hasOpenidCapability(openid, "booking_manage")
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      })
    }

    const res = await db.collection("bookings").doc(id).get()
    const item = res && res.data ? res.data : null
    if (!item) {
      return createError("NOT_FOUND", "预约不存在")
    }

    return {
      ok: true,
      detail: {
        id: item._id || item.id || "",
        openid: item.openid || "",
        vehicleId: item.vehicleId || "",
        vehicleName: item.vehicleName || "",
        userName: item.userName || "",
        phone: item.phone || "",
        startDate: item.startDate || "",
        endDate: item.endDate || "",
        city: item.city || "",
        note: item.note || "",
        adminRemark: item.adminRemark || "",
        adminRemarkUpdatedAt: formatTime(item.adminRemarkUpdatedAt),
        status: item.status || "pending",
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      }
    }
  } catch (error) {
    console.error({
      function: "bookingDetail",
      openid,
      id,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    await writeErrorLogBestEffort({
      function: "bookingDetail",
      openid,
      bookingId: id,
      stage: "main",
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      occurredAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询预约详情失败，请稍后重试")
  }
}
