jest.mock("wx-server-sdk")

function createQuery(records) {
  const query = {}
  query.orderBy = jest.fn(() => query)
  query.skip = jest.fn(() => query)
  query.limit = jest.fn(() => query)
  query.get = jest.fn().mockResolvedValue({ data: records })
  return query
}

function loadModule({ openid, favoriteRecords, vehicles }) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  const favoriteQuery = createQuery(favoriteRecords)
  const favoriteWhere = jest.fn(() => favoriteQuery)
  const vehicleDoc = jest.fn((id) => ({
    get: jest.fn().mockResolvedValue({
      data: vehicles[id] || null
    })
  }))
  cloud.__setMockDb({
    collection: jest.fn((name) => {
      if (name === "favorites") {
        return { where: favoriteWhere }
      }
      if (name === "vehicles") {
        return { doc: vehicleDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  })

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/favoriteMyList/index")
  })
  return {
    mod,
    favoriteWhere,
    favoriteQuery,
    vehicleDoc
  }
}

describe("cloudfunctions/favoriteMyList integration", () => {
  test("返回当前用户收藏并只包含车辆公开卡片字段", async () => {
    const mocks = loadModule({
      openid: "user_openid",
      favoriteRecords: [
        {
          _id: "favorite_1",
          vehicleId: "vehicle_1"
        }
      ],
      vehicles: {
        vehicle_1: {
          _id: "vehicle_1",
          brandModel: "BMW M4",
          plateNumber: "浙A12345",
          vehicleType: "sports",
          status: "idle",
          transmission: "automatic",
          priceDay: 1888,
          location: "杭州",
          coverImage: "cloud://cover",
          vin: "SECRET_VIN",
          internalRemark: "内部备注"
        }
      }
    })

    const res = await mocks.mod.main({ page: 0, pageSize: 10 })

    expect(res.ok).toBe(true)
    expect(mocks.favoriteWhere).toHaveBeenCalledWith({ openid: "user_openid" })
    expect(res.list).toHaveLength(1)
    expect(res.list[0]).toEqual(
      expect.objectContaining({
        id: "vehicle_1",
        name: "BMW M4",
        brand: "BMW",
        cover: "cloud://cover",
        status: "available",
        statusText: "在库"
      })
    )
    expect(JSON.stringify(res.list[0])).not.toContain("浙A12345")
    expect(res.list[0]).not.toHaveProperty("vin")
    expect(res.list[0]).not.toHaveProperty("internalRemark")
  })

  test("停用车辆不出现在收藏列表", async () => {
    const mocks = loadModule({
      openid: "user_openid",
      favoriteRecords: [{ _id: "favorite_1", vehicleId: "vehicle_1" }],
      vehicles: {
        vehicle_1: {
          _id: "vehicle_1",
          brandModel: "停用车辆",
          status: "retired"
        }
      }
    })

    const res = await mocks.mod.main({ page: 0, pageSize: 10 })

    expect(res.ok).toBe(true)
    expect(res.list).toEqual([])
  })
})
