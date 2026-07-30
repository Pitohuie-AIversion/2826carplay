jest.mock("wx-server-sdk")

function loadModule(openid, records) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  const get = jest.fn().mockResolvedValue({ data: records })
  const limit = jest.fn(() => ({ get }))
  const where = jest.fn(() => ({ limit }))
  cloud.__setMockDb({
    collection: jest.fn((name) => {
      if (name === "favorites") {
        return { where }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  })
  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/favoriteStatus/index")
  })
  return { mod, where }
}

describe("cloudfunctions/favoriteStatus integration", () => {
  test("只按当前用户和车辆查询收藏状态", async () => {
    const { mod, where } = loadModule("user_openid", [{ _id: "favorite_1" }])

    const res = await mod.main({ vehicleId: "vehicle_1" })

    expect(res).toEqual({
      ok: true,
      vehicleId: "vehicle_1",
      favorited: true
    })
    expect(where).toHaveBeenCalledWith({
      openid: "user_openid",
      vehicleId: "vehicle_1"
    })
  })

  test("未登录用户不可读取收藏状态", async () => {
    const { mod, where } = loadModule("", [])

    const res = await mod.main({ vehicleId: "vehicle_1" })

    expect(res.code).toBe("UNAUTHORIZED")
    expect(where).not.toHaveBeenCalled()
  })
})
