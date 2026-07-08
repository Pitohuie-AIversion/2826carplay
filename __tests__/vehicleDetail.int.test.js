jest.mock("wx-server-sdk")

function createMockDb({ rolesData, currentData }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const vehiclesDoc = jest.fn(() => ({
    get: currentGet
  }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "vehicles") {
        return { doc: vehiclesDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    rolesLimit,
    vehiclesDoc,
    currentGet
  }
}

async function loadVehicleDetailWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleDetail/index")
  })

  return mod
}

describe("cloudfunctions/vehicleDetail integration", () => {
  test("admin 合法查询单车详情", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "car_1",
        plateNumber: "京a12345",
        vehicleType: "sedan",
        brandModel: "BMW 740Li",
        registerDate: "2026-07-08",
        status: "idle",
        vin: "VIN001",
        engineNumber: "ENG001",
        note: "管理备注",
        imageList: ["cloud://img1", "cloud://img2"],
        coverImage: "cloud://img2",
        createdByOpenid: "admin_openid",
        createdAt: "2026-07-08T08:00:00.000Z",
        updatedAt: "2026-07-08T10:00:00.000Z"
      }
    })

    const vehicleDetail = await loadVehicleDetailWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDetail.main({ id: "car_1" })

    expect(res.ok).toBe(true)
    expect(res.detail).toEqual({
      id: "car_1",
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-07-08",
      status: "idle",
      vin: "VIN001",
      engineNumber: "ENG001",
      note: "管理备注",
      imageList: ["cloud://img1", "cloud://img2"],
      coverImage: "cloud://img2",
      createdByOpenid: "admin_openid",
      createdAt: "2026-07-08T08:00:00.000Z",
      updatedAt: "2026-07-08T10:00:00.000Z"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
  })

  test("缺少 id 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: null
    })

    const vehicleDetail = await loadVehicleDetailWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDetail.main({})

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
  })

  test("车辆不存在时返回 NOT_FOUND", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: null
    })

    const vehicleDetail = await loadVehicleDetailWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDetail.main({ id: "car_missing" })

    expect(res).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "车辆不存在"
    })
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      currentData: { _id: "car_1" }
    })

    const vehicleDetail = await loadVehicleDetailWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await vehicleDetail.main({ id: "car_1" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
  })
})
