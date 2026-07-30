jest.mock("wx-server-sdk")

function createMockDb({ vehicle, setResult = {}, removeResult = { stats: { removed: 1 } } }) {
  const vehicleGet = vehicle
    ? jest.fn().mockResolvedValue({ data: vehicle })
    : jest.fn().mockRejectedValue(new Error("document not found"))
  const vehicleDoc = jest.fn(() => ({ get: vehicleGet }))
  const favoriteSet = jest.fn().mockResolvedValue(setResult)
  const favoriteRemove = jest.fn().mockResolvedValue(removeResult)
  const favoriteDoc = jest.fn(() => ({
    set: favoriteSet,
    remove: favoriteRemove
  }))
  const serverDateValue = { __type: "serverDate" }
  const db = {
    collection: jest.fn((name) => {
      if (name === "vehicles") {
        return { doc: vehicleDoc }
      }
      if (name === "favorites") {
        return { doc: favoriteDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate: jest.fn(() => serverDateValue)
  }
  return {
    db,
    vehicleDoc,
    favoriteDoc,
    favoriteSet,
    favoriteRemove,
    serverDateValue
  }
}

function loadModule(openid, mockDb) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb(mockDb)
  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/favoriteSet/index")
  })
  return mod
}

describe("cloudfunctions/favoriteSet integration", () => {
  test("用户可收藏公开车辆并使用确定性记录 ID", async () => {
    const mocks = createMockDb({
      vehicle: { _id: "vehicle_1", status: "idle" }
    })
    const mod = loadModule("user_openid", mocks.db)

    const res = await mod.main({ vehicleId: "vehicle_1", favorited: true })

    expect(res).toEqual({
      ok: true,
      vehicleId: "vehicle_1",
      favorited: true,
      message: "已加入收藏"
    })
    expect(mocks.vehicleDoc).toHaveBeenCalledWith("vehicle_1")
    expect(mocks.favoriteDoc).toHaveBeenCalledWith(expect.stringMatching(/^favorite_[a-f0-9]{24}$/))
    expect(mocks.favoriteSet).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        vehicleId: "vehicle_1",
        createdAt: mocks.serverDateValue,
        updatedAt: mocks.serverDateValue
      }
    })
  })

  test("取消收藏不依赖车辆是否仍存在", async () => {
    const mocks = createMockDb({ vehicle: null })
    const mod = loadModule("user_openid", mocks.db)

    const res = await mod.main({ vehicleId: "vehicle_1", favorited: false })

    expect(res.ok).toBe(true)
    expect(res.favorited).toBe(false)
    expect(mocks.vehicleDoc).not.toHaveBeenCalled()
    expect(mocks.favoriteRemove).toHaveBeenCalled()
  })

  test("已停用车辆不可新增收藏", async () => {
    const mocks = createMockDb({
      vehicle: { _id: "vehicle_1", status: "retired" }
    })
    const mod = loadModule("user_openid", mocks.db)

    const res = await mod.main({ vehicleId: "vehicle_1", favorited: true })

    expect(res.code).toBe("VEHICLE_NOT_AVAILABLE")
    expect(mocks.favoriteSet).not.toHaveBeenCalled()
  })
})
