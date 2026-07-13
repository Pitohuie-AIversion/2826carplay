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

function normalizeLimit(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return 20
  }

  const intValue = Math.floor(num)
  if (intValue < 1) {
    return 1
  }

  if (intValue > 50) {
    return 50
  }

  return intValue
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const limit = normalizeLimit(event && event.limit)

  try {
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }

    const res = await db
      .collection("bookings")
      .where({ openid })
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get()

    const list = res && Array.isArray(res.data) ? res.data : []

    return {
      ok: true,
      list: list.map((item) => ({
        id: item._id,
        vehicleId: item.vehicleId,
        vehicleName: item.vehicleName || "",
        userName: item.userName || "",
        phone: item.phone || "",
        startDate: item.startDate || "",
        endDate: item.endDate || "",
        city: item.city || "",
        note: item.note || "",
        status: item.status || "pending",
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      }))
    }
  } catch (error) {
    console.error({
      function: "bookingMyList",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询预约失败，请稍后重试")
  }
}

