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

function normalizePageSize(value) {
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
  const pageSize = normalizePageSize((event && event.pageSize) || (event && event.limit))
  const pageRaw = Number(event && event.page)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0

  try {
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }

    const res = await db
      .collection("bookings")
      .where({ openid })
      .orderBy("createdAt", "desc")
      .skip(page * pageSize)
      .limit(pageSize + 1)
      .get()

    const rawList = res && Array.isArray(res.data) ? res.data : []
    const hasMore = rawList.length > pageSize
    const list = hasMore ? rawList.slice(0, pageSize) : rawList

    return {
      ok: true,
      page,
      pageSize,
      hasMore,
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
