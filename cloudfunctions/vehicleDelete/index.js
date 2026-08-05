const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const VEHICLE_DELETE_FIELDS = {
  imageList: true,
  coverImage: true
}
const BOOKING_EXISTENCE_FIELDS = {
  _id: true
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

function normalizeRoleTokens(value) {
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

  const merged = normalizeRoleTokens([record && record.role].concat((record && record.roles) || [], (record && record.permissions) || []))
  if (capability === "vehicle_manage") {
    return merged.includes("vehicle_manage") || merged.includes("vehicle_manager")
  }

  return false
}

async function hasOpenidCapability(openid, capability) {
  if (!openid) {
    return false
  }

  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasCapability(item, capability))
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) {
    return []
  }

  const result = []
  input.forEach((item) => {
    const value = String(item || "").trim()
    if (value && !result.includes(value)) {
      result.push(value)
    }
  })

  return result
}

function normalizeDeletionContext(context) {
  const input = context && typeof context === "object" ? context : {}
  return {
    vehicleId: String(input.vehicleId || input.id || "").trim().slice(0, 128),
    action: String(input.action || "deleteVehicle").trim().slice(0, 32)
  }
}

function getSafeErrorCode(error) {
  return String((error && (error.code || error.errCode)) || "").trim().slice(0, 64)
}

function isDocumentNotFoundError(error) {
  const code = getSafeErrorCode(error)
  const message = String(
    error && (error.message || error.errMsg) ? error.message || error.errMsg : error || ""
  )
  return (
    /DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST|OBJECT_NOT_EXIST/i.test(code) ||
    /document.*(?:not\s+found|not\s+exist)|文档不存在/i.test(message)
  )
}

async function deleteFilesBestEffort(fileList, context) {
  const list = normalizeStringArray(fileList)
  if (!list.length) {
    return
  }
  const safeContext = normalizeDeletionContext(context)

  try {
    await cloud.deleteFile({ fileList: list })
  } catch (error) {
    console.error({
      function: "vehicleDelete",
      stage: "deleteFile",
      fileCount: list.length,
      context: safeContext,
      errorCode: getSafeErrorCode(error),
      createdAt: new Date().toISOString()
    })

    try {
      await db.collection("pending_file_deletions").add({
        data: {
          fileList: list,
          context: safeContext,
          source: "vehicleDelete",
          createdAt: db.serverDate()
        }
      })
    } catch (queueError) {}
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
      function: "vehicleDelete",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
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
      function: "vehicleDelete",
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
    const allowed = await hasOpenidCapability(openid, "vehicle_manage")
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "车辆 ID 不能为空" }]
      })
    }

    let currentRes = null
    try {
      currentRes = await db
        .collection("vehicles")
        .doc(id)
        .field(VEHICLE_DELETE_FIELDS)
        .get()
    } catch (error) {
      if (isDocumentNotFoundError(error)) {
        return createError("NOT_FOUND", "车辆不存在或已被删除")
      }
      throw error
    }
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    const bookingRes = await db
      .collection("bookings")
      .where({ vehicleId: id })
      .field(BOOKING_EXISTENCE_FIELDS)
      .limit(1)
      .get()
    const bookingList = bookingRes && Array.isArray(bookingRes.data) ? bookingRes.data : []
    if (bookingList.length) {
      return createError("VEHICLE_HAS_BOOKINGS", "车辆存在预约记录，请改为停用车辆")
    }

    const removeRes = await db.collection("vehicles").doc(id).remove()
    const removed = Number(removeRes && removeRes.stats && removeRes.stats.removed) || 0
    if (removed < 1) {
      return createError("DELETE_CONFLICT", "车辆未能删除，可能已被其他管理员处理，请刷新后重试")
    }

    const coverImage = String((current && current.coverImage) || "").trim()
    const fileList = normalizeStringArray(current && current.imageList).concat(coverImage ? [coverImage] : [])
    await deleteFilesBestEffort(fileList, {
      vehicleId: id,
      action: "deleteVehicle"
    })

    await writeAuditLogBestEffort({
      openid,
      action: "vehicleDelete",
      vehicleId: id,
      imageCount: normalizeStringArray(current && current.imageList).length,
      hasCoverImage: Boolean(coverImage)
    })

    return {
      ok: true,
      id,
      message: "车辆已删除"
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    await writeErrorLogBestEffort({
      function: "vehicleDelete",
      id,
      authenticated: Boolean(openid),
      errorMessage
    })

    console.error({
      function: "vehicleDelete",
      authenticated: Boolean(openid),
      id,
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "删除车辆失败，请稍后重试")
  }
}
