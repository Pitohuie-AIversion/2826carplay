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
    vehiclesDoc,
    update,
    auditAdd,
    serverDateValue
  }
}

async function loadVehicleUpdateStatusWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleUpdateStatus/index")
  })

  return mod
}

describe("cloudfunctions/vehicleUpdateStatus integration", () => {
  test("admin 可更新车辆状态", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", status: "idle" },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadVehicleUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "car_1", status: "active" })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      alreadyUpdated: false,
      status: "active",
      message: "车辆状态已更新"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        status: "active",
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "admin_openid",
        action: "vehicleUpdateStatus",
        vehicleId: "car_1",
        fromStatus: "idle",
        toStatus: "active",
        createdAt: mocks.serverDateValue
      }
    })
  })

  test("状态未变化时直接返回成功", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", status: "maintenance" },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadVehicleUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "car_1", status: "maintenance" })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      alreadyUpdated: true,
      status: "maintenance",
      message: "车辆状态未变化"
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("状态不合法返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", status: "idle" },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadVehicleUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "car_1", status: "unknown" })

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("车辆不存在返回 NOT_FOUND", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: null,
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadVehicleUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "car_missing", status: "active" })

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
      currentData: { _id: "car_1", status: "idle" },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadVehicleUpdateStatusWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "car_1", status: "active" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
