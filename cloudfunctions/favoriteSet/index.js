const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const VEHICLE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

function createError(code, message) {
  return {
    ok: false,
    code: String(code || "VALIDATION_ERROR"),
    message: String(message || "参数校验失败")
  }
}

function buildFavoriteId(openid, vehicleId) {
  const digest = crypto.createHash("sha256").update(`${openid}|${vehicleId}`).digest("hex")
  return `favorite_${digest.slice(0, 24)}`
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = event && typeof event === "object" ? event : {}
  const vehicleId = String(input.vehicleId || "").trim()
  const favorited = input.favorited === true

  try {
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }
    if (!VEHICLE_ID_PATTERN.test(vehicleId)) {
      return createError("VALIDATION_ERROR", "车辆 ID 格式不正确")
    }

    const favoriteId = buildFavoriteId(openid, vehicleId)
    if (!favorited) {
      await db.collection("favorites").doc(favoriteId).remove()
      return {
        ok: true,
        vehicleId,
        favorited: false,
        message: "已取消收藏"
      }
    }

    let vehicle = null
    try {
      const vehicleRes = await db.collection("vehicles").doc(vehicleId).get()
      vehicle = vehicleRes && vehicleRes.data ? vehicleRes.data : null
    } catch (error) {
      vehicle = null
    }
    if (!vehicle || String(vehicle.status || "") === "retired") {
      return createError("VEHICLE_NOT_AVAILABLE", "该车辆当前不可收藏")
    }

    await db.collection("favorites").doc(favoriteId).set({
      data: {
        openid,
        vehicleId,
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })

    return {
      ok: true,
      vehicleId,
      favorited: true,
      message: "已加入收藏"
    }
  } catch (error) {
    console.error({
      function: "favoriteSet",
      openid,
      vehicleId,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "收藏操作失败，请稍后重试")
  }
}
