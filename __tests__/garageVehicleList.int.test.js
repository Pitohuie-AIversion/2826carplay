jest.mock("wx-server-sdk")

function createMockDb({ vehiclesData, orderedError = null }) {
  const vehiclesLimit = jest.fn((limitValue) => ({
    get: jest.fn().mockResolvedValue({ data: vehiclesData.slice(0, limitValue) })
  }))
  const vehiclesSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({ data: vehiclesData.slice(offset, offset + limitValue) })
    }))
  }))
  const vehiclesOrderedSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: orderedError
        ? jest.fn().mockRejectedValue(orderedError)
        : jest.fn().mockResolvedValue({ data: vehiclesData.slice(offset, offset + limitValue) })
    }))
  }))
  const vehiclesOrderBy = jest.fn(() => ({ skip: vehiclesOrderedSkip }))
  const vehiclesField = jest.fn(() => ({
    limit: vehiclesLimit,
    skip: vehiclesSkip,
    orderBy: vehiclesOrderBy
  }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "vehicles") {
        return {
          limit: vehiclesLimit,
          skip: vehiclesSkip,
          orderBy: vehiclesOrderBy,
          field: vehiclesField
        }
      }

      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    vehiclesLimit,
    vehiclesSkip,
    vehiclesField,
    vehiclesOrderBy,
    vehiclesOrderedSkip
  }
}

async function loadGarageVehicleListWith({ mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/garageVehicleList/index")
  })

  return mod
}

describe("cloudfunctions/garageVehicleList integration", () => {
  test("返回首页可展示车辆并过滤 retired", async () => {
    const mocks = createMockDb({
      vehiclesData: [
        {
          _id: "car_1",
          plateNumber: "粤A12345",
          vehicleType: "suv",
          brandModel: "理想 L9",
          registerDate: "2024-01-01",
          status: "idle",
          publicDescription: "旗舰家用 SUV",
          note: "内部维修记录不得公开",
          imageList: ["cloud://img2"],
          coverImage: "cloud://img1",
          updatedAt: "2026-07-10T10:00:00.000Z"
        },
        {
          _id: "car_2",
          plateNumber: "京B12345",
          vehicleType: "sedan",
          brandModel: "宝马 5系",
          registerDate: "2023-05-01",
          status: "retired",
          imageList: [],
          coverImage: "",
          updatedAt: "2026-07-11T10:00:00.000Z"
        }
      ]
    })

    const garageVehicleList = await loadGarageVehicleListWith({ mockDb: mocks.db })
    const res = await garageVehicleList.main({})

    expect(mocks.vehiclesOrderBy).toHaveBeenCalledWith("updatedAt", "desc")
    expect(mocks.vehiclesField).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: true,
        plateNumber: true,
        publicDescription: true,
        imageList: true
      })
    )
    const projection = mocks.vehiclesField.mock.calls[0][0]
    expect(projection).not.toHaveProperty("vin")
    expect(projection).not.toHaveProperty("engineNumber")
    expect(projection).not.toHaveProperty("note")
    expect(mocks.vehiclesOrderedSkip).toHaveBeenCalledWith(0)
    expect(res.ok).toBe(true)
    expect(res.list).toHaveLength(1)
    expect(res.list[0]).toMatchObject({
      id: "car_1",
      name: "理想 L9",
      nickname: "车牌尾号 45",
      brand: "理想",
      category: "city_suv",
      status: "available",
      statusText: "在库",
      priceText: "价格到店详询",
      cover: "cloud://img1",
      hasImages: true,
      coverPlaceholderText: "理想 L9"
    })
    expect(res.list[0].description).toBe("旗舰家用 SUV")
    expect(res.list[0].seatsText).toBe("—")
    expect(JSON.stringify(res.list[0])).not.toContain("内部维修记录不得公开")
    expect(res.list[0].images).toEqual(["cloud://img1", "cloud://img2"])
    expect(res.list[0].tags).toEqual(["SUV", "上牌 2024", "粤A***45"])
  })

  test("封面图已存在于图片列表时也会排到首页第一张", async () => {
    const mocks = createMockDb({
      vehiclesData: [
        {
          _id: "car_3",
          plateNumber: "粤C88888",
          vehicleType: "sedan",
          brandModel: "奔驰 C 级",
          status: "idle",
          imageList: ["cloud://img_old", "cloud://img_cover", "cloud://img_other"],
          coverImage: "cloud://img_cover",
          updatedAt: "2026-07-12T10:00:00.000Z"
        }
      ]
    })

    const garageVehicleList = await loadGarageVehicleListWith({ mockDb: mocks.db })
    const res = await garageVehicleList.main({})

    expect(res.ok).toBe(true)
    expect(res.list).toHaveLength(1)
    expect(res.list[0].cover).toBe("cloud://img_cover")
    expect(res.list[0].images).toEqual(["cloud://img_cover", "cloud://img_old", "cloud://img_other"])
  })

  test("超过 100 辆后首页仍可读取后续分页", async () => {
    const vehiclesData = Array.from({ length: 150 }, (_, index) => ({
      _id: `car_${index}`,
      plateNumber: `浙A${String(index).padStart(5, "0")}`,
      vehicleType: "sedan",
      brandModel: `Vehicle ${index}`,
      status: "idle",
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    }))
    const mocks = createMockDb({ vehiclesData })
    const garageVehicleList = await loadGarageVehicleListWith({ mockDb: mocks.db })

    const res = await garageVehicleList.main({ page: 7, pageSize: 20 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(150)
    expect(res.list).toHaveLength(10)
    expect(res.hasMore).toBe(false)
    expect(res.truncated).toBe(false)
    expect(mocks.vehiclesOrderedSkip).toHaveBeenCalledWith(100)
  })

  test("服务端搜索覆盖未加载分页并组合分类与可预约筛选", async () => {
    const vehiclesData = Array.from({ length: 35 }, (_, index) => ({
      _id: `car_${index}`,
      plateNumber: `浙A${String(index).padStart(5, "0")}`,
      vehicleType: index >= 25 ? "sports" : "sedan",
      brandModel: index >= 25 ? `Ferrari Roma ${index}` : `Common Vehicle ${index}`,
      status: index === 26 ? "active" : "idle",
      updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString()
    }))
    const mocks = createMockDb({ vehiclesData })
    const garageVehicleList = await loadGarageVehicleListWith({ mockDb: mocks.db })

    const res = await garageVehicleList.main({
      page: 0,
      pageSize: 20,
      keyword: "ferrari",
      category: "supercar",
      availableOnly: true
    })

    expect(res.ok).toBe(true)
    expect(res.searchedTotal).toBe(10)
    expect(res.categoryTotal).toBe(10)
    expect(res.availableCount).toBe(9)
    expect(res.total).toBe(9)
    expect(res.list).toHaveLength(9)
    expect(res.list.some((item) => item.id === "car_25")).toBe(true)
    expect(res.list.some((item) => item.id === "car_26")).toBe(false)
    expect(res.categoryCounts).toMatchObject({ all: 10, supercar: 10 })
  })

  test("缺少 updatedAt 索引时首页自动降级读取", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      vehiclesData: [
        {
          _id: "car_1",
          plateNumber: "浙A12345",
          vehicleType: "sedan",
          brandModel: "MX-5",
          status: "idle"
        }
      ],
      orderedError: new Error("missing updatedAt index")
    })
    const garageVehicleList = await loadGarageVehicleListWith({ mockDb: mocks.db })

    const res = await garageVehicleList.main({ page: 0, pageSize: 20 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(mocks.vehiclesOrderedSkip).toHaveBeenCalledWith(0)
    expect(mocks.vehiclesSkip).toHaveBeenCalledWith(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test("skipStats 为 true 时跳过全量统计查询，直接返回分页列表", async () => {
    const mocks = createMockDb({
      vehiclesData: [
        {
          _id: "car_1",
          plateNumber: "粤A11111",
          vehicleType: "sedan",
          brandModel: "Model 3",
          status: "idle"
        }
      ]
    })
    const garageVehicleList = await loadGarageVehicleListWith({ mockDb: mocks.db })

    const res = await garageVehicleList.main({ page: 1, pageSize: 10, skipStats: true })

    expect(res.ok).toBe(true)
    expect(res.page).toBe(1)
    expect(res.pageSize).toBe(10)
    expect(Array.isArray(res.list)).toBe(true)
    // skipStats 模式下不消耗全量统计与计数查询
    expect(res.categoryCounts).toBeUndefined()
  })
})

