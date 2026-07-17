jest.mock("wx-server-sdk")

function createMockDb({ vehiclesData }) {
  const vehiclesGet = jest.fn().mockResolvedValue({ data: vehiclesData })
  const vehiclesLimit = jest.fn(() => ({ get: vehiclesGet }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "vehicles") {
        return { limit: vehiclesLimit }
      }

      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    vehiclesLimit,
    vehiclesGet
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
          note: "旗舰家用 SUV",
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

    expect(mocks.vehiclesLimit).toHaveBeenCalledWith(100)
    expect(res.ok).toBe(true)
    expect(res.list).toHaveLength(1)
    expect(res.list[0]).toMatchObject({
      id: "car_1",
      name: "理想 L9",
      nickname: "车牌尾号 2345",
      brand: "理想",
      category: "city_suv",
      status: "available",
      statusText: "在库",
      priceText: "价格到店详询",
      cover: "cloud://img1",
      hasImages: true,
      coverPlaceholderText: "理想 L9"
    })
    expect(res.list[0].images).toEqual(["cloud://img1", "cloud://img2"])
    expect(res.list[0].tags).toEqual(["SUV", "上牌 2024", "粤A12345"])
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
})
