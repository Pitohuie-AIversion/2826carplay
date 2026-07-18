jest.mock("wx-server-sdk")

function createMockDb({ rolesData, currentData, updateResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = jest.fn().mockResolvedValue(updateResult)
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

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
    vehiclesDoc,
    currentGet,
    update,
    auditAdd,
    serverDateValue
  }
}

async function loadVehicleRetireWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleRetire/index")
  })

  return mod
}

describe("cloudfunctions/vehicleRetire integration", () => {
  test("admin 合法停用车辆", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", status: "active" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleRetire = await loadVehicleRetireWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleRetire.main({ id: "car_1" })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      alreadyRetired: false,
      message: "车辆已停用"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        status: "retired",
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "admin_openid",
        action: "vehicleRetire",
        vehicleId: "car_1",
        plateNumber: "",
        fromStatus: "active",
        toStatus: "retired",
        createdAt: mocks.serverDateValue
      }
    })
  })

  test("车辆已停用时直接返回成功", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", status: "retired" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleRetire = await loadVehicleRetireWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleRetire.main({ id: "car_1" })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      alreadyRetired: true,
      message: "车辆已是停用状态"
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("缺少 id 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", status: "active" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleRetire = await loadVehicleRetireWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleRetire.main({})

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

    const vehicleRetire = await loadVehicleRetireWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleRetire.main({ id: "car_missing" })

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
      currentData: { _id: "car_1", status: "active" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleRetire = await loadVehicleRetireWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await vehicleRetire.main({ id: "car_1" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
