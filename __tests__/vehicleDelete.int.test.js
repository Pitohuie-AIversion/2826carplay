jest.mock("wx-server-sdk")

function createMockDb({ rolesData, currentData, removeResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const remove = jest.fn().mockResolvedValue(removeResult)

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const vehiclesDoc = jest.fn(() => ({
    get: currentGet,
    remove
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
    currentGet,
    remove
  }
}

async function loadVehicleDeleteWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleDelete/index")
  })

  return mod
}

describe("cloudfunctions/vehicleDelete integration", () => {
  test("admin 合法删除车辆", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "car_1",
        plateNumber: "京A12345",
        imageList: ["cloud://img1", "cloud://img2"],
        coverImage: "cloud://img2"
      },
      removeResult: { stats: { removed: 1 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDelete.main({ id: "car_1" })

    const cloud = require("wx-server-sdk")

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      message: "车辆已删除"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(cloud.deleteFile).toHaveBeenCalledWith({
      fileList: ["cloud://img1", "cloud://img2"]
    })
  })

  test("缺少 id 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", plateNumber: "京A12345" },
      removeResult: { stats: { removed: 1 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDelete.main({})

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  test("车辆不存在时返回 NOT_FOUND", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: null,
      removeResult: { stats: { removed: 1 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDelete.main({ id: "car_missing" })

    expect(res).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "车辆不存在"
    })
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      currentData: { _id: "car_1", plateNumber: "京A12345" },
      removeResult: { stats: { removed: 1 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await vehicleDelete.main({ id: "car_1" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })
})
