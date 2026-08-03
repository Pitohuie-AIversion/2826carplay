const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const FAVORITE_EXISTENCE_FIELDS = {
  _id: true
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const vehicleId = String((event && event.vehicleId) || "").trim()

  try {
    if (!openid) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "未获取到用户身份"
      }
    }
    if (!vehicleId || vehicleId.length > 128) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "车辆 ID 格式不正确"
      }
    }

    const res = await db
      .collection("favorites")
      .where({ openid, vehicleId })
      .field(FAVORITE_EXISTENCE_FIELDS)
      .limit(1)
      .get()
    const list = res && Array.isArray(res.data) ? res.data : []

    return {
      ok: true,
      vehicleId,
      favorited: list.length > 0
    }
  } catch (error) {
    console.error({
      function: "favoriteStatus",
      authenticated: Boolean(openid),
      vehicleId,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "收藏状态加载失败，请稍后重试"
    }
  }
}
