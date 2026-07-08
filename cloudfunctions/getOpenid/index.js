const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

exports.main = async () => {
  const context = cloud.getWXContext()

  return {
    ok: true,
    openid: context.OPENID || "",
    appid: context.APPID || "",
    unionid: context.UNIONID || "",
    env: context.ENV || ""
  }
}
