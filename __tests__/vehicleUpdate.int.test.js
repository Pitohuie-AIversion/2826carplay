jest.mock("wx-server-sdk")

function createMockDb({ rolesData, duplicateData, currentData, updateResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const duplicateGet = jest.fn().mockResolvedValue({ data: duplicateData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = jest.fn().mockResolvedValue(updateResult)
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const vehiclesLimit = jest.fn(() => ({ get: duplicateGet }))
  const vehiclesWhere = jest.fn(() => ({ limit: vehiclesLimit }))
  const vehiclesDoc = jest.fn(() => ({
    get: currentGet,
    update
  }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "vehicles") {
        return { where: vehiclesWhere, doc: vehiclesDoc }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesWhere,
    rolesLimit,
    vehiclesWhere,
    vehiclesLimit,
    vehiclesDoc,
    currentGet,
    update,
    auditAdd,
    serverDateValue
  }
}

async function loadVehicleUpdateWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleUpdate/index")
  })

  return mod
}

describe("cloudfunctions/vehicleUpdate integration", () => {
  test("admin 合法修改写入 vehicles 并返回 id", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      duplicateData: [{ _id: "car_1", plateNumber: "京A12345" }],
      currentData: { _id: "car_1", plateNumber: "京A12345" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleUpdate = await loadVehicleUpdateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleUpdate.main({
      id: "car_1",
      plateNumber: "京a12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-07-08",
      status: "idle",
      location: "杭州",
      transmission: "automatic",
      fuelType: "gasoline",
      seats: 5,
      priceDay: 1299,
      note: "行政旗舰"
    })

    expect(res).toEqual({ ok: true, id: "car_1" })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
    expect(mocks.vehiclesWhere).toHaveBeenCalledWith({ plateNumber: "京A12345" })
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        plateNumber: "京A12345",
        vehicleType: "sedan",
        brandModel: "BMW 740Li",
        registerDate: "2026-07-08",
        status: "idle",
        location: "杭州",
        transmission: "automatic",
        fuelType: "gasoline",
        seats: 5,
        priceDay: 1299,
        note: "行政旗舰",
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "admin_openid",
        action: "vehicleUpdate",
        vehicleId: "car_1",
        plateNumber: "京A12345",
        changedKeys: ["vehicleType", "brandModel", "registerDate", "status", "location", "transmission", "fuelType", "seats", "priceDay", "note"],
        before: {
          vehicleType: undefined,
          brandModel: undefined,
          registerDate: undefined,
          status: undefined,
          location: undefined,
          transmission: undefined,
          fuelType: undefined,
          seats: undefined,
          priceDay: undefined,
          note: undefined
        },
        after: {
          vehicleType: "sedan",
          brandModel: "BMW 740Li",
          registerDate: "2026-07-08",
          status: "idle",
          location: "杭州",
          transmission: "automatic",
          fuelType: "gasoline",
          seats: 5,
          priceDay: 1299,
          note: "行政旗舰"
        },
        createdAt: mocks.serverDateValue
      }
    })
  })

  test("admin 非法参数返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      duplicateData: [],
      currentData: { _id: "car_1", plateNumber: "京A12345" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleUpdate = await loadVehicleUpdateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleUpdate.main({
      id: "car_1",
      plateNumber: "BAD@@",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-07-08",
      status: "idle"
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesWhere).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("admin 修改为重复车牌返回 DUPLICATE_PLATE", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      duplicateData: [
        { _id: "car_1", plateNumber: "京A12345" },
        { _id: "car_2", plateNumber: "京A12345" }
      ],
      currentData: { _id: "car_1", plateNumber: "沪B67890" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleUpdate = await loadVehicleUpdateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleUpdate.main({
      id: "car_1",
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-07-08",
      status: "idle"
    })

    expect(res).toEqual({
      ok: false,
      code: "DUPLICATE_PLATE",
      message: "车牌号已存在",
      details: { plateNumber: "京A12345" }
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("车辆不存在时返回 NOT_FOUND", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      duplicateData: [],
      currentData: null,
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleUpdate = await loadVehicleUpdateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleUpdate.main({
      id: "car_missing",
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-07-08",
      status: "idle"
    })

    expect(res).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "车辆不存在"
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      duplicateData: [],
      currentData: { _id: "car_1", plateNumber: "京A12345" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleUpdate = await loadVehicleUpdateWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await vehicleUpdate.main({
      id: "car_1",
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-07-08",
      status: "idle"
    })

    expect(res).toEqual({ ok: false, code: "FORBIDDEN", message: "权限不足" })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
