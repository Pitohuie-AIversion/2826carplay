const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const ALLOWED_EVENTS = [
  "garage_view",
  "vehicle_detail",
  "booking_start",
  "booking_submit",
  "favorite_add"
]
const VEHICLE_EVENTS = ALLOWED_EVENTS.filter((item) => item !== "garage_view")

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = event && typeof event === "object" ? event : {}
  const eventType = String(input.eventType || "").trim()
  const vehicleId = String(input.vehicleId || "").trim()

  try {
    if (!openid) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "未获取到用户身份"
      }
    }
    if (!ALLOWED_EVENTS.includes(eventType)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "统计事件类型不合法"
      }
    }
    if (VEHICLE_EVENTS.includes(eventType) && (!vehicleId || vehicleId.length > 128)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "车辆 ID 格式不正确"
      }
    }

    await db.collection("analytics_events").add({
      data: {
        eventType,
        vehicleId: eventType === "garage_view" ? "" : vehicleId,
        createdAt: db.serverDate()
      }
    })

    return {
      ok: true
    }
  } catch (error) {
    console.warn({
      function: "analyticsTrack",
      eventType,
      vehicleId,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "统计记录失败"
    }
  }
}
