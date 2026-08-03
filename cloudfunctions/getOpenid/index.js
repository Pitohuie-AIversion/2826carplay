const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const context = cloud.getWXContext()
  const openid = context && context.OPENID ? String(context.OPENID).trim() : ""

  if (!openid) {
    return {
      ok: false,
      code: "UNAUTHORIZED",
      message: "未获取到用户身份"
    }
  }

  return {
    ok: true,
    openid
  }
}
