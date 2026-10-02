jest.mock("wx-server-sdk")

const cloud = require("wx-server-sdk")

function createMockDb({ rolesData, vehiclesData, addResult, addError = null }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const vehiclesGet = jest.fn().mockResolvedValue({ data: vehiclesData })
  const vehiclesAdd = addError
    ? jest.fn().mockRejectedValue(addError)
    : jest.fn().mockResolvedValue(addResult)
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

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
      if (name === "audit_logs") {
        return { add: auditAdd }
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
    vehiclesAdd,
    auditAdd
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
  test("创建时性能数值零与日租金零均不会归为空值", async () => {
    const mocks = createMockDb({ rolesData: [{ role: "admin" }], vehiclesData: [], addResult: { _id: "car_1" } })
    const mod = await loadVehicleCreateWith({ openid: "admin_openid", mockDb: mocks.db })
    expect(await mod.main({ plateNumber: "京A12345", vehicleType: "sedan", brandModel: "BMW", registerDate: "2020-01-01", status: "idle", priceDay: 0, performance: { acceleration: 0, horsepower: 0, torque: 0 } })).toMatchObject({ ok: true })
    expect(mocks.vehiclesAdd.mock.calls[0][0].data).toMatchObject({ priceDay: 0, performance: { acceleration: "0", horsepower: "0", torque: "0" } })
  })

  test("创建车辆保存人工提示、性能及未来到期日，普通用户不能写入", async () => {
    const mocks = createMockDb({ rolesData: [{ role: "admin" }], vehiclesData: [], addResult: { _id: "car_1" } })
    const mod = await loadVehicleCreateWith({ openid: "admin_openid", mockDb: mocks.db })
    const input = { plateNumber: "京A12345", vehicleType: "sedan", brandModel: "BMW", registerDate: "2020-01-01", status: "idle", publicDrivingTips: "使用前确认胎压", archiveDate: "2027-01-01", archiveReview: "2027-06-01", performance: { acceleration: "6.5s", horsepower: "300Ps", drivetrain: "后轮驱动", torque: "400N·m", highlights: ["全景天窗"] } }
    expect((await mod.main(input)).ok).toBe(true)
    expect(mocks.vehiclesAdd.mock.calls[0][0].data).toMatchObject(input)
    mocks.rolesGet.mockResolvedValue({ data: [] })
    expect((await mod.main(input)).code).toBe("FORBIDDEN")
    expect(mocks.vehiclesAdd).toHaveBeenCalledTimes(1)
  })

  test("自定义连租规则只允许车辆管理员写入", async () => {
    const mocks = createMockDb({ rolesData: [{ role: "admin" }], vehiclesData: [], addResult: { _id: "car_1" } })
    const mod = await loadVehicleCreateWith({ openid: "admin_openid", mockDb: mocks.db })
    const input = { plateNumber: "京A12345", vehicleType: "sedan", brandModel: "BMW", registerDate: "2020-01-01", status: "idle", rentalDiscountTiers: [{ minDays: 5, discountRate: 0.92 }] }
    expect((await mod.main(input)).ok).toBe(true)
    expect(mocks.vehiclesAdd.mock.calls[0][0].data.rentalDiscountTiers[0]).toMatchObject(input.rentalDiscountTiers[0])
    mocks.rolesGet.mockResolvedValue({ data: [] })
    expect((await mod.main(input)).code).toBe("FORBIDDEN")
    expect(mocks.vehiclesAdd).toHaveBeenCalledTimes(1)
  })

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
      status: "active",
      location: "杭州",
      transmission: "automatic",
      fuelType: "gasoline",
      seats: 5,
      priceDay: 699,
      publicDescription: "适合商务接待",
      note: "内部整备提醒"
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
        location: "杭州",
        transmission: "automatic",
        fuelType: "gasoline",
        seats: 5,
        priceDay: 699,
        publicDescription: "适合商务接待",
        note: "内部整备提醒",
        imageList: [],
        coverImage: "",
        createdAt: mocks.serverDateValue,
        updatedAt: mocks.serverDateValue,
        createdByOpenid: "admin_openid"
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "admin_openid",
        action: "vehicleCreate",
        vehicleId: "new_id",
        vehicleType: "sedan",
        brandModel: "Toyota",
        status: "active",
        location: "杭州",
        createdAt: mocks.serverDateValue
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

  test("唯一索引并发冲突返回 DUPLICATE_PLATE", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehiclesData: [],
      addResult: null,
      addError: Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
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
  })
})
