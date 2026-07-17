jest.mock("wx-server-sdk")

function createMockDb({ rolesData, vehiclesData }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const vehiclesGet = jest.fn().mockResolvedValue({ data: vehiclesData })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))
  const vehiclesLimit = jest.fn(() => ({ get: vehiclesGet }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }

      if (name === "vehicles") {
        return { limit: vehiclesLimit }
      }

      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    rolesLimit,
    rolesGet,
    vehiclesLimit,
    vehiclesGet
  }
}

async function loadVehicleListWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleList/index")
  })

  return mod
}

describe("cloudfunctions/vehicleList integration", () => {
  test("admin 查询全部车辆列表成功", async () => {
    const now = Date.now()
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehiclesData: [
        {
          _id: "v1",
          plateNumber: "京a12345",
          vehicleType: "sedan",
          brandModel: "BMW 740Li",
          registerDate: "2024-01-01",
          status: "active",
          location: "杭州",
          transmission: "automatic",
          fuelType: "gasoline",
          seats: 5,
          priceDay: 1299,
          createdByOpenid: "admin_1",
          createdAt: new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: "2026-07-08T10:00:00.000Z"
        },
        {
          _id: "v2",
          plateNumber: "沪B67890",
          vehicleType: "suv",
          brandModel: "Audi Q5",
          registerDate: "2023-05-10",
          status: "maintenance",
          location: "上海",
          transmission: "automatic",
          fuelType: "gasoline",
          seats: 5,
          priceDay: 899,
          createdByOpenid: "admin_2",
          createdAt: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
          updatedAt: "2026-07-08T08:00:00.000Z"
        }
      ]
    })

    const vehicleList = await loadVehicleListWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await vehicleList.main({ status: "all", keyword: "" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(2)
    expect(res.stats).toEqual({
      total: 2,
      active: 1,
      idle: 0,
      maintenance: 1,
      retired: 0
    })
    expect(res.dashboard).toEqual({
      idle: 0,
      active: 1,
      maintenance: 1,
      recentAdded7d: 1
    })
    expect(res.recentAddedList).toEqual([
      {
        id: "v1",
        plateNumber: "京A12345",
        brandModel: "BMW 740Li",
        status: "active",
        location: "杭州",
        createdAt: expect.any(String)
      }
    ])
    expect(res.list[0].id).toBe("v1")
    expect(res.list[0].plateNumber).toBe("京A12345")
    expect(res.list[0].location).toBe("杭州")
    expect(res.list[0].priceDay).toBe(1299)
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.rolesLimit).toHaveBeenCalledWith(20)
    expect(mocks.vehiclesLimit).toHaveBeenCalledWith(100)
  })

  test("admin 按状态筛选车辆", async () => {
    const now = Date.now()
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehiclesData: [
        {
          _id: "v1",
          plateNumber: "京A12345",
          vehicleType: "sedan",
          brandModel: "BMW 740Li",
          registerDate: "2024-01-01",
          status: "active",
          location: "杭州",
          createdAt: new Date(now - 1 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
          _id: "v2",
          plateNumber: "沪B67890",
          vehicleType: "suv",
          brandModel: "Audi Q5",
          registerDate: "2023-05-10",
          status: "maintenance",
          location: "上海",
          createdAt: new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString()
        }
      ]
    })

    const vehicleList = await loadVehicleListWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await vehicleList.main({ status: "maintenance" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].brandModel).toBe("Audi Q5")
    expect(res.stats.maintenance).toBe(1)
    expect(res.dashboard).toEqual({
      idle: 0,
      active: 1,
      maintenance: 1,
      recentAdded7d: 1
    })
    expect(res.recentAddedList).toHaveLength(1)
    expect(res.recentAddedList[0].id).toBe("v1")
  })

  test("admin 按关键词筛选车辆", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehiclesData: [
        {
          _id: "v1",
          plateNumber: "京A12345",
          vehicleType: "sedan",
          brandModel: "BMW 740Li",
          registerDate: "2024-01-01",
          status: "active",
          location: "杭州"
        },
        {
          _id: "v2",
          plateNumber: "沪B67890",
          vehicleType: "suv",
          brandModel: "Audi Q5",
          registerDate: "2023-05-10",
          status: "maintenance",
          location: "上海"
        }
      ]
    })

    const vehicleList = await loadVehicleListWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await vehicleList.main({ keyword: "audi" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].id).toBe("v2")
  })

  test("vehicle_manager 可查询车辆列表", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "vehicle_manager" }],
      vehiclesData: [
        {
          _id: "v1",
          plateNumber: "京A12345",
          vehicleType: "sedan",
          brandModel: "BMW 740Li",
          registerDate: "2024-01-01",
          status: "active",
          location: "杭州"
        }
      ]
    })

    const vehicleList = await loadVehicleListWith({
      openid: "vehicle_manager_openid",
      mockDb: mocks.db
    })

    const res = await vehicleList.main({ status: "all" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].id).toBe("v1")
  })

  test("admin 可按扩展展示字段关键词筛选车辆", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehiclesData: [
        {
          _id: "v1",
          plateNumber: "京A12345",
          vehicleType: "sedan",
          brandModel: "BMW 740Li",
          registerDate: "2024-01-01",
          status: "active",
          location: "杭州",
          fuelType: "gasoline"
        },
        {
          _id: "v2",
          plateNumber: "沪B67890",
          vehicleType: "suv",
          brandModel: "Audi Q5",
          registerDate: "2023-05-10",
          status: "maintenance",
          location: "上海",
          fuelType: "electric"
        }
      ]
    })

    const vehicleList = await loadVehicleListWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await vehicleList.main({ keyword: "上海" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].id).toBe("v2")
  })

  test("非法状态筛选返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehiclesData: []
    })

    const vehicleList = await loadVehicleListWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await vehicleList.main({ status: "invalid_status" })

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesLimit).not.toHaveBeenCalled()
  })

  test("非管理员查询返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      vehiclesData: []
    })

    const vehicleList = await loadVehicleListWith({
      openid: "user_openid",
      mockDb: mocks.db
    })

    const res = await vehicleList.main({ status: "all" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.vehiclesLimit).not.toHaveBeenCalled()
  })
})
