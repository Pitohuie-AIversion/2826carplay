jest.mock("wx-server-sdk")

function createQuery(records, fallback) {
  let offset = 0
  let count = 100
  const query = {}
  query.field = jest.fn(() => query)
  query.orderBy = jest.fn(() => {
    if (fallback) throw new Error("missing index")
    return query
  })
  query.skip = jest.fn((value) => { offset = value; return query })
  query.limit = jest.fn((value) => { count = Math.min(value, 100); return query })
  query.get = jest.fn(async () => ({ data: records.slice(offset, offset + count) }))
  return query
}

function loadModule({ openid, favoriteRecords, vehicles = {}, vehicleErrors = {}, fallback = false }) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  const favoriteQuery = createQuery(favoriteRecords, fallback)
  const favoriteWhere = jest.fn(() => favoriteQuery)
  const vehicleField = jest.fn((id, projection) => ({
    get: jest.fn(async () => {
      if (vehicleErrors[id]) throw vehicleErrors[id]
      return { data: vehicles[id] || null }
    })
  }))
  const vehicleDoc = jest.fn((id) => ({
    field: jest.fn((projection) => vehicleField(id, projection))
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
    vehicleDoc,
    vehicleField
  }
}

describe("cloudfunctions/favoriteMyList integration", () => {
  test.each(["unexpected", "", undefined])("状态%s不能误标为可预约", async (status) => {
    const { mod } = loadModule({
      openid: "user_openid",
      favoriteRecords: [{ _id: "favorite", vehicleId: "vehicle" }],
      vehicles: { vehicle: { _id: "vehicle", status } }
    })
    const result = await mod.main({})
    expect(result.ok).toBe(true)
    expect(result.list).toEqual([expect.objectContaining({ id: "vehicle", status: "unknown", statusText: "状态待确认" })])
  })

  test("降级查询跨过SDK单次100条限制后按创建时间分页", async () => {
    const favoriteRecords = Array.from({ length: 140 }, (_, i) => ({
      _id: `favorite_${i}`, vehicleId: `vehicle_${i}`, createdAt: new Date(2026, 0, i + 1)
    }))
    const vehicles = Object.fromEntries(favoriteRecords.map((row) => [row.vehicleId, { _id: row.vehicleId, status: "idle" }]))
    const mocks = loadModule({ openid: "user_openid", favoriteRecords, vehicles, fallback: true })
    const res = await mocks.mod.main({ page: 0, pageSize: 20 })
    expect(res.ok).toBe(true)
    expect(res.list[0].id).toBe("vehicle_139")
    expect(res.list).toHaveLength(20)
    expect(res.hasMore).toBe(true)
    expect(mocks.favoriteQuery.skip).toHaveBeenCalledWith(100)
  })

  test.each([500, 501])("降级%d条收藏不会返回无限空白下一页", async (size) => {
    const favoriteRecords = Array.from({ length: size }, (_, i) => ({ _id: `favorite_${i}`, vehicleId: `vehicle_${i}` }))
    const mocks = loadModule({ openid: "user_openid", favoriteRecords, fallback: true })
    const res = await mocks.mod.main({ page: 24, pageSize: 20 })
    if (size === 500) {
      expect(res.ok).toBe(true)
      expect(res.hasMore).toBe(false)
    } else {
      expect(res).toMatchObject({ ok: false, code: "INDEX_REQUIRED" })
    }
  })

  test.each([
    ["document not found", true],
    ["database timeout", false],
    ["collection does not exist", false]
  ])("只忽略实际删除的车辆：%s", async (message, ok) => {
    const mocks = loadModule({ openid: "user_openid", favoriteRecords: [{ vehicleId: "vehicle_1" }], vehicleErrors: { vehicle_1: new Error(message) } })
    const res = await mocks.mod.main({ page: 0 })
    expect(res.ok).toBe(ok)
    if (!ok) expect(res.code).toBe("INTERNAL_ERROR")
  })
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
    expect(mocks.favoriteQuery.field).toHaveBeenCalledWith({
      _id: true,
      vehicleId: true,
      createdAt: true
    })
    expect(res.list).toHaveLength(1)
    expect(res.list[0]).toEqual(
      expect.objectContaining({
        id: "vehicle_1",
        name: "BMW M4",
        brand: "BMW",
        cover: "cloud://cover",
        status: "available",
        statusText: "可预约"
      })
    )
    expect(JSON.stringify(res.list[0])).not.toContain("浙A12345")
    expect(res.list[0]).not.toHaveProperty("vin")
    expect(res.list[0]).not.toHaveProperty("internalRemark")
    const projection = mocks.vehicleField.mock.calls[0][1]
    expect(projection).toEqual(
      expect.objectContaining({
        _id: true,
        brandModel: true,
        plateNumber: true,
        status: true
      })
    )
    expect(projection).not.toHaveProperty("vin")
    expect(projection).not.toHaveProperty("engineNumber")
    expect(projection).not.toHaveProperty("note")
    expect(projection).not.toHaveProperty("internalRemark")
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
