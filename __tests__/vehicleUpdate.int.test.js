jest.mock("wx-server-sdk")

function createMockDb({ rolesData, duplicateData, currentData, updateResult, updateError = null }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const duplicateGet = jest.fn().mockResolvedValue({ data: duplicateData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = updateError
    ? jest.fn().mockRejectedValue(updateError)
    : jest.fn().mockResolvedValue(updateResult)
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
    runTransaction: jest.fn(async (callback) => callback({ collection: db.collection })),
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
  test("更新性能数值零与日租金零保留原意，显式空值才清空", async () => {
    const mocks = createMockDb({ rolesData: [{ role: "admin" }], duplicateData: [], currentData: { _id: "car_1", status: "idle" }, updateResult: { stats: { updated: 1 } } })
    const mod = await loadVehicleUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const base = { id: "car_1", plateNumber: "京A12345", vehicleType: "sedan", brandModel: "BMW", registerDate: "2020-01-01", status: "idle" }
    expect(await mod.main({ ...base, priceDay: 0, performance: { acceleration: 0, horsepower: 0, torque: 0 } })).toMatchObject({ ok: true })
    expect(mocks.update.mock.calls[0][0].data).toMatchObject({ priceDay: 0, performance: { acceleration: "0", horsepower: "0", torque: "0" } })
    expect(await mod.main({ ...base, priceDay: "", performance: { acceleration: "", horsepower: "", torque: "" } })).toMatchObject({ ok: true })
    expect(mocks.update.mock.calls[1][0].data).toMatchObject({ priceDay: null, performance: { acceleration: "", horsepower: "", torque: "" } })
  })

  test("保存、清空和省略车辆配置分别写入新值、空值和保持原值", async () => {
    const fields = { publicDrivingTips: "还车前确认随车物品", archiveDate: "2027-01-01", archiveReview: "2027-06-01", performance: { acceleration: "6.5s", horsepower: "300Ps", drivetrain: "后轮驱动", torque: "400N·m", highlights: ["全景天窗"] } }
    const mocks = createMockDb({ rolesData: [{ role: "admin" }], duplicateData: [], currentData: { _id: "car_1", ...fields }, updateResult: { stats: { updated: 1 } } })
    const mod = await loadVehicleUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const base = { id: "car_1", plateNumber: "京A12345", vehicleType: "sedan", brandModel: "BMW", registerDate: "2020-01-01", status: "idle" }
    expect((await mod.main({ ...base, ...fields })).ok).toBe(true)
    expect(mocks.update.mock.calls[0][0].data).toMatchObject(fields)
    expect((await mod.main({ ...base, performance: {}, publicDrivingTips: "", archiveDate: "", archiveReview: "" })).ok).toBe(true)
    expect(mocks.update.mock.calls[1][0].data).toMatchObject({ performance: { acceleration: "", horsepower: "", drivetrain: "", torque: "", highlights: [] }, publicDrivingTips: "", archiveDate: "", archiveReview: "" })
    expect(mocks.auditAdd.mock.calls[1][0].data.changedKeys).toEqual(expect.arrayContaining(Object.keys(fields)))
    expect((await mod.main(base)).ok).toBe(true)
    for (const field of Object.keys(fields)) expect(mocks.update.mock.calls[2][0].data).not.toHaveProperty(field)
    expect((await mod.main({ ...base, archiveDate: "2027-02-29" })).code).toBe("VALIDATION_ERROR")
    expect(mocks.update).toHaveBeenCalledTimes(3)
  })

  test("管理员可保存、清空连租规则，非法折扣不会写入", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }], duplicateData: [],
      currentData: { _id: "car_1", rentalDiscountTiers: [{ minDays: 7, discountRate: 0.9 }] },
      updateResult: { stats: { updated: 1 } }
    })
    const mod = await loadVehicleUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const base = { id: "car_1", plateNumber: "京A12345", vehicleType: "sedan", brandModel: "BMW", registerDate: "2020-01-01", status: "idle" }
    const tiers = [{ minDays: 5, discountRate: 0.92 }]
    expect((await mod.main({ ...base, rentalDiscountTiers: tiers })).ok).toBe(true)
    expect(mocks.update.mock.calls[0][0].data.rentalDiscountTiers).toEqual([{ ...tiers[0], label: "连租满5天 9.2折" }])
    expect(mocks.auditAdd.mock.calls[0][0].data.changedKeys).toContain("rentalDiscountTiers")
    expect((await mod.main({ ...base, rentalDiscountTiers: [] })).ok).toBe(true)
    expect(mocks.update.mock.calls[1][0].data.rentalDiscountTiers).toEqual([])
    expect((await mod.main({ ...base, rentalDiscountTiers: [{ minDays: 3, discountRate: 0 }] })).code).toBe("VALIDATION_ERROR")
    expect(mocks.update).toHaveBeenCalledTimes(2)
  })

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
      vin: "VIN-SECRET",
      engineNumber: "ENG-SECRET",
      publicDescription: "行政旗舰座驾",
      note: "内部整备提醒"
    })

    expect(res).toEqual({ ok: true, id: "car_1", vehicleVersion: 1 })
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
        vin: "VIN-SECRET",
        engineNumber: "ENG-SECRET",
        publicDescription: "行政旗舰座驾",
        note: "内部整备提醒",
        vehicleVersion: 1,
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "admin_openid",
        action: "vehicleUpdate",
        vehicleId: "car_1",
        changedKeys: ["vehicleType", "brandModel", "registerDate", "status", "location", "transmission", "fuelType", "seats", "priceDay", "publicDescription", "vin", "engineNumber", "note"],
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

  test("admin 可同时维护公开可信摘要和仅后台可见记录", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      duplicateData: [{ _id: "car_1", plateNumber: "京A12345" }],
      currentData: { _id: "car_1", plateNumber: "京A12345" },
      updateResult: { stats: { updated: 1 } }
    })
    const vehicleUpdate = await loadVehicleUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await vehicleUpdate.main({
      id: "car_1",
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-07-08",
      status: "idle",
      publicMaterialsUpdatedDate: "2026-07-08",
      publicInspectionDate: "2026-07-01",
      publicInspectionSummary: "公开检查摘要",
      publicExteriorSummary: "公开外观摘要",
      publicInsuranceSummary: "公开保险摘要",
      publicAssistanceSummary: "公开救援摘要",
      publicArchiveReviewStatus: "reviewed",
      internalMaintenanceRecord: "内部保养工单",
      internalInspectionRecord: "内部检查原始记录",
      internalInsuranceRecord: "内部保单索引",
      internalArchiveNote: "内部档案说明"
    })

    expect(res).toEqual({ ok: true, id: "car_1", vehicleVersion: 1 })
    expect(mocks.update).toHaveBeenCalledWith({
      data: expect.objectContaining({
        publicArchiveReviewStatus: "reviewed",
        publicInspectionSummary: "公开检查摘要",
        internalMaintenanceRecord: "内部保养工单",
        internalInsuranceRecord: "内部保单索引",
        vehicleVersion: 1,
        updatedAt: mocks.serverDateValue
      })
    })
    const auditPayload = mocks.auditAdd.mock.calls[0][0].data
    expect(auditPayload.changedKeys).toEqual(expect.arrayContaining([
      "publicInspectionSummary",
      "publicArchiveReviewStatus",
      "internalMaintenanceRecord",
      "internalInsuranceRecord"
    ]))
    expect(JSON.stringify(auditPayload)).not.toContain("内部保养工单")
  })

  test("admin 可以真正清空车辆选填字段", async () => {
    const currentData = {
      _id: "car_1",
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
      publicDescription: "公开说明",
      vin: "VIN-SECRET",
      engineNumber: "ENG-SECRET",
      note: "内部备注"
    }
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      duplicateData: [currentData],
      currentData,
      updateResult: { stats: { updated: 1 } }
    })
    const vehicleUpdate = await loadVehicleUpdateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleUpdate.main({
      id: "car_1",
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-07-08",
      status: "idle",
      location: "",
      transmission: "",
      fuelType: "",
      seats: "",
      priceDay: "",
      publicDescription: "",
      vin: "",
      engineNumber: "",
      note: ""
    })

    expect(res).toEqual({ ok: true, id: "car_1", vehicleVersion: 1 })
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        plateNumber: "京A12345",
        vehicleType: "sedan",
        brandModel: "BMW 740Li",
        registerDate: "2026-07-08",
        status: "idle",
        location: "",
        transmission: "",
        fuelType: "",
        seats: null,
        priceDay: null,
        publicDescription: "",
        vin: "",
        engineNumber: "",
        note: "",
        vehicleVersion: 1,
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "admin_openid",
        action: "vehicleUpdate",
        vehicleId: "car_1",
        changedKeys: [
          "location",
          "transmission",
          "fuelType",
          "seats",
          "priceDay",
          "publicDescription",
          "vin",
          "engineNumber",
          "note"
        ],
        createdAt: mocks.serverDateValue
      }
    })
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

  test("唯一索引并发冲突返回 DUPLICATE_PLATE", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      duplicateData: [],
      currentData: { _id: "car_1", plateNumber: "沪B67890" },
      updateResult: null,
      updateError: Object.assign(new Error("E11000 duplicate key error"), { code: 11000 })
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
  })
})
