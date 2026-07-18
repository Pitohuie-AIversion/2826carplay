const cloud = require("wx-server-sdk")
const vehicleUtils = require("./vehicle")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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
      function: "vehicleCreate",
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
      function: "vehicleCreate",
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
  let plateNumber = vehicleUtils.normalizePlateNumber(event && event.plateNumber)

  try {
    const allowed = await hasOpenidCapability(openid, "vehicle_manage")
    if (!allowed) {
      return vehicleUtils.createError("FORBIDDEN", "权限不足")
    }

    const check = vehicleUtils.validateVehicle(event)
    if (!check.ok) {
      return check
    }

    const payload = check.value
    plateNumber = payload.plateNumber

    const existsRes = await db.collection("vehicles").where({ plateNumber }).limit(1).get()
    const existsList = existsRes && Array.isArray(existsRes.data) ? existsRes.data : []
    if (existsList.length) {
      return vehicleUtils.createError("DUPLICATE_PLATE", "车牌号已存在", { plateNumber })
    }

    const now = db.serverDate()
    const addRes = await db.collection("vehicles").add({
      data: {
        ...payload,
        imageList: [],
        coverImage: "",
        createdAt: now,
        updatedAt: now,
        createdByOpenid: openid
      }
    })

    const vehicleId = addRes && addRes._id ? addRes._id : ""
    await writeAuditLogBestEffort({
      openid,
      action: "vehicleCreate",
      vehicleId,
      plateNumber,
      vehicleType: payload.vehicleType,
      brandModel: payload.brandModel,
      status: payload.status,
      location: payload.location
    })

    return { ok: true, id: vehicleId }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "vehicleCreate",
      openid,
      plateNumber,
      input: event && typeof event === "object" ? event : {},
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : ""
    })

    console.error({
      function: "vehicleCreate",
      openid,
      plateNumber,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return vehicleUtils.createError("INTERNAL_ERROR", "系统繁忙，请稍后重试")
  }
}
