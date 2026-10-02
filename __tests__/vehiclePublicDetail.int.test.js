jest.mock("wx-server-sdk")

function createMockDb({ currentData }) {
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const vehiclesField = jest.fn(() => ({
    get: currentGet
  }))
  const vehiclesDoc = jest.fn(() => ({
    field: vehiclesField
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
    vehiclesDoc,
    vehiclesField
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
  test.each([undefined, null, "", "   "])("未保存地点 %p 保留为空，不生成可匹配网点的业务文案", async (location) => {
    const mocks = createMockDb({ currentData: { status: "idle", location } })
    const mod = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const result = await mod.main({ id: "car_1" })
    expect(result.car.location).toBe("")
    expect(mocks.vehiclesField.mock.calls[0][0]).toMatchObject({ location: true })
  })

  test.each([undefined, "", "legacy-unknown"])("未知状态 %p 的车辆不作为可预约车型公开", async (status) => {
    const mocks = createMockDb({ currentData: { status, priceDay: 800 } })
    const mod = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const result = await mod.main({ id: "car_1" })
    expect(result).toMatchObject({ ok: false, code: "NOT_AVAILABLE" })
    expect(result).not.toHaveProperty("car")
  })

  test("公开读取旧性能数值零时不误判为未填写", async () => {
    const mocks = createMockDb({ currentData: { status: "idle", performance: { acceleration: 0, horsepower: 0, torque: 0 } } })
    const mod = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    expect((await mod.main({ id: "car_1" })).car.performance).toMatchObject({ acceleration: "0", horsepower: "0", torque: "0" })
  })

  test("公开详情仅输出保存的性能与人工提示，维保到期日和额外性能字段不公开", async () => {
    const performance = { acceleration: "6.5s", horsepower: "300Ps", drivetrain: "后轮驱动", torque: "400N·m", highlights: ["全景天窗"] }
    const mocks = createMockDb({ currentData: { status: "idle", publicDrivingTips: "取车后先熟悉灯光操作", performance: { ...performance, internalMemo: "SECRET" }, archiveDate: "2027-01-01", archiveReview: "2027-06-01" } })
    const mod = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const res = await mod.main({ id: "car_1" })
    expect(res.car.performance).toEqual(performance)
    expect(res.car.publicDrivingTips).toBe("取车后先熟悉灯光操作")
    expect(res.car).not.toHaveProperty("archiveDate")
    expect(res.car).not.toHaveProperty("archiveReview")
    expect(mocks.vehiclesField.mock.calls[0][0]).toMatchObject({ performance: true, publicDrivingTips: true })
    expect(mocks.vehiclesField.mock.calls[0][0]).not.toHaveProperty("archiveDate")
    expect(JSON.stringify(res.car)).not.toContain("SECRET")
    const emptyMocks = createMockDb({ currentData: { status: "idle" } })
    const emptyMod = await loadVehiclePublicDetailWith({ mockDb: emptyMocks.db })
    const empty = await emptyMod.main({ id: "car_2" })
    expect(empty.car.performance).toEqual({ acceleration: "", horsepower: "", drivetrain: "", torque: "", highlights: [] })
    expect(empty.car.publicDrivingTips).toBe("")
  })

  test("公开详情读取管理员折扣并剔除额外字段", async () => {
    const mocks = createMockDb({ currentData: { status: "idle", rentalDiscountTiers: [{ minDays: 5, discountRate: 0.92, secret: "hidden" }] } })
    const mod = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const res = await mod.main({ id: "car_1" })
    expect(res.car.rentalDiscountTiers).toEqual([{ minDays: 5, discountRate: 0.92, label: "连租满5天 9.2折" }])
    expect(mocks.vehiclesField).toHaveBeenCalledWith(expect.objectContaining({ rentalDiscountTiers: true }))
  })

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
        publicDescription: "公开车辆亮点",
        publicMaterialsUpdatedDate: "2026-07-08",
        publicInspectionDate: "2026-07-01",
        publicInspectionSummary: "已完成常规保养与安全检查",
        publicExteriorSummary: "左后轮毂有轻微使用痕迹",
        publicInsuranceSummary: "商业保险在有效期内，具体范围以保单为准",
        publicAssistanceSummary: "支持人工协调道路救援",
        publicArchiveReviewStatus: "reviewed",
        internalMaintenanceRecord: "内部工单 M-001 不得公开",
        note: "内部维修记录不得公开",
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
    expect(res.car.nickname).toBe("车牌尾号 45")
    expect(res.car.tags).toEqual(["轿车", "上牌 2026", "浙A***45"])
    expect(res.car.cover).toBe("cloud://img2")
    expect(res.car.images).toEqual(["cloud://img2", "cloud://img1"])
    expect(res.car.description).toBe("公开车辆亮点")
    expect(res.car.priceSummary).toEqual({
      hasBasePrice: true,
      baseDailyRate: 1299,
      currency: "CNY",
      currencySymbol: "￥",
      billingUnit: "24小时",
      baseDailyRateText: "￥1299",
      estimateLabel: "基础日租参考"
    })
    expect(res.car.trustArchive).toMatchObject({
      status: "current",
      statusText: "资料已复核",
      lastUpdatedDate: "2026-07-08",
      missingCount: 0
    })
    expect(JSON.stringify(res.car)).not.toContain("内部维修记录不得公开")
    expect(JSON.stringify(res.car)).not.toContain("内部工单 M-001")
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
    expect(mocks.vehiclesField).toHaveBeenCalledWith(
      expect.objectContaining({
        _id: true,
        plateNumber: true,
        publicDescription: true,
        imageList: true
      })
    )
    const projection = mocks.vehiclesField.mock.calls[0][0]
    expect(projection).not.toHaveProperty("vin")
    expect(projection).not.toHaveProperty("engineNumber")
    expect(projection).not.toHaveProperty("note")
    expect(projection).not.toHaveProperty("internalMaintenanceRecord")
    expect(projection).not.toHaveProperty("internalInsuranceRecord")
  })

  test("缺少 id 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({ currentData: null })
    const vehiclePublicDetail = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const res = await vehiclePublicDetail.main({})

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
  })

  test("旧车辆的内部备注不会作为公开说明返回", async () => {
    const mocks = createMockDb({
      currentData: {
        _id: "car_legacy",
        plateNumber: "浙A12345",
        brandModel: "Legacy Car",
        status: "idle",
        note: "内部维修记录不得公开"
      }
    })
    const vehiclePublicDetail = await loadVehiclePublicDetailWith({ mockDb: mocks.db })
    const res = await vehiclePublicDetail.main({ id: "car_legacy" })

    expect(res.ok).toBe(true)
    expect(res.car.description).toBe("Legacy Car支持到店咨询与预约服务。")
    expect(res.car.seatsText).toBe("—")
    expect(res.car.priceSummary.hasBasePrice).toBe(false)
    expect(res.car.priceSummary.baseDailyRateText).toBe("待顾问确认")
    expect(res.car.trustArchive.status).toBe("missing")
    expect(res.car.trustArchive.missingCount).toBe(6)
    expect(JSON.stringify(res.car)).not.toContain("内部维修记录不得公开")
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
