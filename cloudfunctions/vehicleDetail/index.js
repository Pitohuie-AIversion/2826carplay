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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const id = String((event && event.id) || "").trim()

  try {
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "车辆 ID 不能为空" }]
      })
    }

    const res = await db.collection("vehicles").doc(id).get()
    const item = res && res.data ? res.data : null
    if (!item) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    return {
      ok: true,
      detail: {
        id: item._id || item.id || "",
        plateNumber: String(item.plateNumber || "").trim().toUpperCase(),
        vehicleType: item.vehicleType || "",
        brandModel: item.brandModel || "",
        registerDate: item.registerDate || "",
        status: item.status || "",
        vin: item.vin || "",
        engineNumber: item.engineNumber || "",
        note: item.note || "",
        imageList: Array.isArray(item.imageList) ? item.imageList.filter(Boolean) : [],
        coverImage: item.coverImage || "",
        createdByOpenid: item.createdByOpenid || "",
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      }
    }
  } catch (error) {
    console.error({
      function: "vehicleDetail",
      openid,
      id,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询车辆详情失败，请稍后重试")
  }
}
