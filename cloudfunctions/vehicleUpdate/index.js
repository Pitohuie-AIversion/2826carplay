const cloud = require("wx-server-sdk")
const vehicleUtils = require("./vehicle")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeUpdateInput(event)
  let plateNumber = vehicleUtils.normalizePlateNumber(input.plateNumber)

  try {
    const allowed = await isAdminOpenid(openid)
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

    return { ok: true, id: input.id }
  } catch (error) {
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
