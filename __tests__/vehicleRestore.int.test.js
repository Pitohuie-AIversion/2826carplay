jest.mock("wx-server-sdk")

function createMockDb({ rolesData, currentData, updateResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = jest.fn().mockResolvedValue(updateResult)

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

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
        return { doc: vehiclesDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesWhere,
    rolesLimit,
    vehiclesDoc,
    currentGet,
    update,
    serverDateValue
  }
}

async function loadVehicleRestoreWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleRestore/index")
  })

  return mod
}

describe("cloudfunctions/vehicleRestore integration", () => {
  test("admin 合法恢复启用车辆", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", status: "retired" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleRestore = await loadVehicleRestoreWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleRestore.main({ id: "car_1" })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      alreadyRestored: false,
      message: "车辆已恢复启用"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        status: "idle",
        updatedAt: mocks.serverDateValue
      }
    })
  })

  test("车辆本身未停用时直接返回成功", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", status: "active" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleRestore = await loadVehicleRestoreWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleRestore.main({ id: "car_1" })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      alreadyRestored: true,
      message: "车辆当前无需恢复启用"
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("缺少 id 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", status: "retired" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleRestore = await loadVehicleRestoreWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleRestore.main({})

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
  })

  test("车辆不存在时返回 NOT_FOUND", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: null,
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleRestore = await loadVehicleRestoreWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleRestore.main({ id: "car_missing" })

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
      currentData: { _id: "car_1", status: "retired" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleRestore = await loadVehicleRestoreWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await vehicleRestore.main({ id: "car_1" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
