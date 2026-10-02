jest.mock("wx-server-sdk")

function createMockDb({ vehicle, favorite = null, setResult = {}, removeResult = { stats: { removed: 1 } } }) {
  const vehicleGet = vehicle
    ? jest.fn().mockResolvedValue({ data: vehicle })
    : jest.fn().mockRejectedValue(new Error("document not found"))
  const vehicleField = jest.fn(() => ({ get: vehicleGet }))
  const vehicleDoc = jest.fn(() => ({ field: vehicleField }))
  let savedFavorite = favorite
  const favoriteGet = jest.fn(async () => ({ data: savedFavorite }))
  const favoriteSet = jest.fn(async ({ data }) => {
    savedFavorite = data
    return setResult
  })
  const favoriteRemove = jest.fn().mockResolvedValue(removeResult)
  const favoriteDoc = jest.fn(() => ({
    get: favoriteGet,
    set: favoriteSet,
    remove: favoriteRemove
  }))
  const serverDateValue = { __type: "serverDate" }
  const db = {
    runTransaction: jest.fn(async (callback) => callback({ collection: db.collection })),
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
    vehicleGet,
    vehicleField,
    favoriteDoc,
    favoriteSet,
    favoriteGet,
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
  test("重复收藏保留首次时间，避免重试移动分页位置", async () => {
    const mocks = createMockDb({ vehicle: { status: "idle" } })
    const mod = loadModule("user_openid", mocks.db)
    expect((await mod.main({ vehicleId: "vehicle_1", favorited: true })).ok).toBe(true)
    expect((await mod.main({ vehicleId: "vehicle_1", favorited: true })).ok).toBe(true)
    expect(mocks.favoriteSet).toHaveBeenCalledTimes(1)
    expect(mocks.db.runTransaction).toHaveBeenCalledTimes(2)
  })

  test("车辆数据库暂时失败不会误报车辆不可收藏", async () => {
    const mocks = createMockDb({ vehicle: { status: "idle" } })
    mocks.vehicleGet.mockRejectedValue(new Error("database timeout"))
    const mod = loadModule("user_openid", mocks.db)
    expect((await mod.main({ vehicleId: "vehicle_1", favorited: true })).code).toBe("INTERNAL_ERROR")
    expect(mocks.favoriteSet).not.toHaveBeenCalled()
  })

  test("读取已有收藏失败时不重建记录", async () => {
    const mocks = createMockDb({ vehicle: { status: "idle" } })
    mocks.favoriteGet.mockRejectedValue(new Error("database unavailable"))
    const mod = loadModule("user_openid", mocks.db)
    expect((await mod.main({ vehicleId: "vehicle_1", favorited: true })).code).toBe("INTERNAL_ERROR")
    expect(mocks.favoriteSet).not.toHaveBeenCalled()
  })

  test("取消不存在的收藏仍成功，但数据库故障返回失败", async () => {
    const mocks = createMockDb({ vehicle: null })
    const mod = loadModule("user_openid", mocks.db)
    mocks.favoriteRemove.mockRejectedValueOnce(new Error("document not found"))
    expect((await mod.main({ vehicleId: "vehicle_1", favorited: false })).ok).toBe(true)
    mocks.favoriteRemove.mockRejectedValueOnce(new Error("collection does not exist"))
    expect((await mod.main({ vehicleId: "vehicle_1", favorited: false })).code).toBe("INTERNAL_ERROR")
  })
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
    expect(mocks.vehicleField).toHaveBeenCalledWith({ status: true })
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
