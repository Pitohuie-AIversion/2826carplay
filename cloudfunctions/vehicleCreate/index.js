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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  let plateNumber = vehicleUtils.normalizePlateNumber(event && event.plateNumber)

  try {
    const allowed = await isAdminOpenid(openid)
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

    return { ok: true, id: addRes && addRes._id ? addRes._id : "" }
  } catch (error) {
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
