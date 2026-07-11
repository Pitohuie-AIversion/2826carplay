jest.mock("wx-server-sdk")

const cloud = require("wx-server-sdk")

function createMockDb({ rolesData, vehiclesData, addResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const vehiclesGet = jest.fn().mockResolvedValue({ data: vehiclesData })
  const vehiclesAdd = jest.fn().mockResolvedValue(addResult)

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const vehiclesLimit = jest.fn(() => ({ get: vehiclesGet }))
  const vehiclesWhere = jest.fn(() => ({ limit: vehiclesLimit }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "vehicles") {
        return { where: vehiclesWhere, add: vehiclesAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    serverDateValue,
    rolesGet,
    rolesWhere,
    rolesLimit,
    vehiclesGet,
    vehiclesWhere,
    vehiclesLimit,
    vehiclesAdd
  }
}

async function loadVehicleCreateWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleCreate/index")
  })

  return mod
}

describe("cloudfunctions/vehicleCreate integration", () => {
  test("admin 合法提交写入 vehicles 并返回 id", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehiclesData: [],
      addResult: { _id: "new_id" }
    })

    const vehicleCreate = await loadVehicleCreateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleCreate.main({
      plateNumber: "京a12345",
      vehicleType: "sedan",
      brandModel: "Toyota",
      registerDate: "2026-07-08",
      status: "active"
    })

    expect(res).toEqual({ ok: true, id: "new_id" })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.rolesLimit).toHaveBeenCalledWith(20)
    expect(mocks.vehiclesWhere).toHaveBeenCalledWith({ plateNumber: "京A12345" })
    expect(mocks.vehiclesLimit).toHaveBeenCalledWith(1)
    expect(mocks.vehiclesAdd).toHaveBeenCalledTimes(1)
    expect(mocks.vehiclesAdd).toHaveBeenCalledWith({
      data: {
        plateNumber: "京A12345",
        vehicleType: "sedan",
        brandModel: "Toyota",
        registerDate: "2026-07-08",
        status: "active",
        imageList: [],
        coverImage: "",
        createdAt: mocks.serverDateValue,
        updatedAt: mocks.serverDateValue,
        createdByOpenid: "admin_openid"
      }
    })
  })

  test("admin 非法参数返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehiclesData: [],
      addResult: { _id: "new_id" }
    })

    const vehicleCreate = await loadVehicleCreateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleCreate.main({
      plateNumber: "京A1234@",
      vehicleType: "sedan",
      brandModel: "Toyota",
      registerDate: "2026-07-08",
      status: "active"
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesWhere).not.toHaveBeenCalled()
    expect(mocks.vehiclesAdd).not.toHaveBeenCalled()
  })

  test("admin 重复车牌返回 DUPLICATE_PLATE", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehiclesData: [{ _id: "exists" }],
      addResult: { _id: "new_id" }
    })

    const vehicleCreate = await loadVehicleCreateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleCreate.main({
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "Toyota",
      registerDate: "2026-07-08",
      status: "active"
    })

    expect(res).toEqual({
      ok: false,
      code: "DUPLICATE_PLATE",
      message: "车牌号已存在",
      details: { plateNumber: "京A12345" }
    })
    expect(mocks.vehiclesAdd).not.toHaveBeenCalled()
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      vehiclesData: [],
      addResult: { _id: "new_id" }
    })

    const vehicleCreate = await loadVehicleCreateWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await vehicleCreate.main({
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "Toyota",
      registerDate: "2026-07-08",
      status: "active"
    })

    expect(res).toEqual({ ok: false, code: "FORBIDDEN", message: "权限不足" })
    expect(mocks.vehiclesWhere).not.toHaveBeenCalled()
    expect(mocks.vehiclesAdd).not.toHaveBeenCalled()
  })
})
