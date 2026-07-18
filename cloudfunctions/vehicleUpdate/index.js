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
      function: "vehicleUpdate",
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
      function: "vehicleUpdate",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

function normalizeUpdateInput(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim(),
    plateNumber: payload.plateNumber,
    vehicleType: payload.vehicleType,
    brandModel: payload.brandModel,
    registerDate: payload.registerDate,
    status: payload.status,
    location: payload.location,
    transmission: payload.transmission,
    fuelType: payload.fuelType,
    seats: payload.seats,
    priceDay: payload.priceDay,
    vin: payload.vin,
    engineNumber: payload.engineNumber,
    note: payload.note
  }
}

function buildVehicleDiff(current, next) {
  const fields = [
    "plateNumber",
    "vehicleType",
    "brandModel",
    "registerDate",
    "status",
    "location",
    "transmission",
    "fuelType",
    "seats",
    "priceDay",
    "vin",
    "engineNumber",
    "note"
  ]

  const changedKeys = fields.filter((key) => JSON.stringify(current && current[key]) !== JSON.stringify(next && next[key]))
  return {
    changedKeys,
    before: changedKeys.reduce((acc, key) => ({ ...acc, [key]: current ? current[key] : undefined }), {}),
    after: changedKeys.reduce((acc, key) => ({ ...acc, [key]: next ? next[key] : undefined }), {})
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeUpdateInput(event)
  let plateNumber = vehicleUtils.normalizePlateNumber(input.plateNumber)

  try {
    const allowed = await hasOpenidCapability(openid, "vehicle_manage")
    if (!allowed) {
      return vehicleUtils.createError("FORBIDDEN", "权限不足")
    }

    if (!input.id) {
      return vehicleUtils.createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "车辆 ID 不能为空" }]
      })
    }

    const currentRes = await db.collection("vehicles").doc(input.id).get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return vehicleUtils.createError("NOT_FOUND", "车辆不存在")
    }

    const check = vehicleUtils.validateVehicle(input)
    if (!check.ok) {
      return check
    }

    const payload = check.value
    plateNumber = payload.plateNumber

    const existsRes = await db.collection("vehicles").where({ plateNumber }).limit(5).get()
    const existsList = existsRes && Array.isArray(existsRes.data) ? existsRes.data : []
    const duplicate = existsList.find((item) => item && item._id !== input.id)
    if (duplicate) {
      return vehicleUtils.createError("DUPLICATE_PLATE", "车牌号已存在", { plateNumber })
    }

    await db.collection("vehicles").doc(input.id).update({
      data: {
        ...payload,
        updatedAt: db.serverDate()
      }
    })

    const diff = buildVehicleDiff(current, payload)
    await writeAuditLogBestEffort({
      openid,
      action: "vehicleUpdate",
      vehicleId: input.id,
      plateNumber,
      changedKeys: diff.changedKeys,
      before: diff.before,
      after: diff.after
    })

    return { ok: true, id: input.id }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "vehicleUpdate",
      openid,
      vehicleId: input.id,
      plateNumber,
      stage: "main",
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      occurredAt: new Date().toISOString()
    })

    console.error({
      function: "vehicleUpdate",
      openid,
      id: input.id,
      plateNumber,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return vehicleUtils.createError("INTERNAL_ERROR", "系统繁忙，请稍后重试")
  }
}
