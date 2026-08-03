jest.mock("wx-server-sdk")

function loadGetOpenidWith(context) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext(context)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/getOpenid/index")
  })

  return {
    cloud,
    mod
  }
}

describe("cloudfunctions/getOpenid integration", () => {
  test("只返回当前用户 OpenID，不暴露其他环境身份字段", async () => {
    const { cloud, mod } = loadGetOpenidWith({
      OPENID: " user_openid ",
      APPID: "private_appid",
      UNIONID: "cross_app_unionid",
      ENV: "production_environment"
    })

    await expect(mod.main()).resolves.toEqual({
      ok: true,
      openid: "user_openid"
    })
    expect(cloud.getWXContext).toHaveBeenCalledTimes(1)
  })

  test.each([
    {},
    { OPENID: "" },
    { OPENID: "   " },
    null
  ])("身份缺失时拒绝返回成功结果 %#", async (context) => {
    const { mod } = loadGetOpenidWith(context)

    await expect(mod.main()).resolves.toEqual({
      ok: false,
      code: "UNAUTHORIZED",
      message: "未获取到用户身份"
    })
  })
})
