jest.mock("wx-server-sdk")

function createMockDb({ currentData }) {
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const vehiclesDoc = jest.fn(() => ({
    get: currentGet
  }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "vehicles") {
        return { doc: vehiclesDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    vehiclesDoc
  }
}

async function loadVehiclePublicDetailWith({ mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehiclePublicDetail/index")
  })

  return mod
}

describe("cloudfunctions/vehiclePublicDetail integration", () => {
  test("正常返回车辆详情（含封面排序）", async () => {
    const mocks = createMockDb({
      currentData: {
        _id: "car_1",
        plateNumber: "浙A12345",
        vehicleType: "sedan",
        brandModel: "BMW 740Li",
        registerDate: "2026-07-08",
        status: "idle",
        location: "杭州",
        transmission: "automatic",
        fuelType: "gasoline",
        seats: 5,
        priceDay: 1299,
        note: "车辆备注",
        imageList: ["cloud://img1", "cloud://img2"],
        coverImage: "cloud://img2",
        createdAt: "2026-07-08T08:00:00.000Z",
        updatedAt: "2026-07-08T10:00:00.000Z"
      }
    })

    const vehiclePublicDetail = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const res = await vehiclePublicDetail.main({ id: "car_1" })

    expect(res.ok).toBe(true)
    expect(res.car.id).toBe("car_1")
    expect(res.car.name).toBe("BMW 740Li")
    expect(res.car.cover).toBe("cloud://img2")
    expect(res.car.images).toEqual(["cloud://img2", "cloud://img1"])
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
  })

  test("缺少 id 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({ currentData: null })
    const vehiclePublicDetail = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const res = await vehiclePublicDetail.main({})

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
  })

  test("车辆不存在返回 NOT_FOUND", async () => {
    const mocks = createMockDb({ currentData: null })
    const vehiclePublicDetail = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const res = await vehiclePublicDetail.main({ id: "car_missing" })

    expect(res).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "车辆不存在"
    })
  })

  test("retired 车辆返回 NOT_AVAILABLE", async () => {
    const mocks = createMockDb({
      currentData: {
        _id: "car_2",
        status: "retired",
        brandModel: "AUDI A6"
      }
    })
    const vehiclePublicDetail = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const res = await vehiclePublicDetail.main({ id: "car_2" })

    expect(res).toEqual({
      ok: false,
      code: "NOT_AVAILABLE",
      message: "车辆已停用"
    })
  })
})

