const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const BOOKING_MY_DETAIL_FIELDS = {
  _id: true,
  openid: true,
  vehicleId: true,
  vehicleName: true,
  userName: true,
  phone: true,
  startDate: true,
  endDate: true,
  city: true,
  note: true,
  status: true,
  createdAt: true,
  updatedAt: true
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

function buildVehicleDisplayIdentity(value) {
  const vehicleName = String(value || "").trim()
  const normalized = vehicleName.toUpperCase()
  const isPlateNumber = /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-HJ-NP-Z0-9]{5,6}$/.test(normalized)
  return isPlateNumber
    ? { vehicleName: "预约车辆", vehicleReference: `车牌尾号 ${normalized.slice(-2)}` }
    : { vehicleName: vehicleName || "预约车辆", vehicleReference: "" }
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
      function: "bookingMyDetail",
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
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }

    if (!id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      })
    }

    const res = await db.collection("bookings").doc(id).field(BOOKING_MY_DETAIL_FIELDS).get()
    const item = res && res.data ? res.data : null
    if (!item) {
      return createError("NOT_FOUND", "预约不存在")
    }

    if (String(item.openid || "").trim() !== openid) {
      return createError("FORBIDDEN", "只能查看自己的预约")
    }

    const vehicleIdentity = buildVehicleDisplayIdentity(item.vehicleName)

    return {
      ok: true,
      detail: {
        id: item._id || item.id || "",
        vehicleId: item.vehicleId || "",
        ...vehicleIdentity,
        userName: item.userName || "",
        phone: item.phone || "",
        startDate: item.startDate || "",
        endDate: item.endDate || "",
        city: item.city || "",
        note: item.note || "",
        status: item.status || "pending",
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      }
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    console.error({
      function: "bookingMyDetail",
      authenticated: Boolean(openid),
      id,
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    await writeErrorLogBestEffort({
      function: "bookingMyDetail",
      bookingId: id,
      stage: "main",
      authenticated: Boolean(openid),
      errorMessage,
      occurredAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询预约详情失败，请稍后重试")
  }
}
