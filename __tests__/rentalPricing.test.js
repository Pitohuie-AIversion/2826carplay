const fs = require("fs")
const path = require("path")
const { getRentalDiscountTier, calculateRentalDiscount, validateRentalDiscountTiers } = require("../shared/rentalPricing")
const { validateVehicle } = require("../shared/vehicle")
const tiers = [{ minDays: 5, discountRate: 0.92 }, { minDays: 12, discountRate: 0.8 }]

describe("管理员定义连租折扣", () => {
  test("没有配置或清空配置不自动打折", () => {
    for (const config of [undefined, [], null, "invalid"]) {
      expect(getRentalDiscountTier(30, config)).toBeNull()
      expect(calculateRentalDiscount(30000, 30, config)).toMatchObject({ hasDiscount: false, discountedTotal: 30000 })
    }
  })

  test("按自定义门槛匹配最高天数档，不叠加且不修改原数组", () => {
    expect(getRentalDiscountTier(4, tiers)).toBeNull()
    expect(getRentalDiscountTier(5, tiers)).toMatchObject({ minDays: 5, discountRate: 0.92, label: "连租满5天 9.2折" })
    expect(getRentalDiscountTier(11, tiers).minDays).toBe(5)
    expect(getRentalDiscountTier(12, tiers).minDays).toBe(12)
    expect(calculateRentalDiscount(10000, 30, tiers)).toMatchObject({ discountedTotal: 8000, savingsAmount: 2000 })
    expect(tiers[0].minDays).toBe(5)
  })

  test.each([
    [{ minDays: 1, discountRate: 0.9 }],
    [{ minDays: 91, discountRate: 0.9 }],
    [{ minDays: 3.5, discountRate: 0.9 }],
    [{ minDays: 3, discountRate: 0 }],
    [{ minDays: 3, discountRate: 1 }],
    [{ minDays: 3, discountRate: 0.955 }],
    [{ minDays: 3, discountRate: NaN }],
    [{ minDays: 3, discountRate: "0.9" }],
    [{ minDays: 3, discountRate: 0.9 }, { minDays: 3, discountRate: 0.8 }],
    Array.from({ length: 9 }, (_, i) => ({ minDays: i + 2, discountRate: 0.9 }))
  ].map((config) => [config]))("非法配置不能保存或参与计价 %#", (config) => {
    expect(validateRentalDiscountTiers(config)).not.toBe("")
    expect(getRentalDiscountTier(90, config)).toBeNull()
  })

  test("边界金额与非法天数安全处理，人民币按元四舍五入", () => {
    expect(calculateRentalDiscount(101, 5, tiers).discountedTotal).toBe(93)
    for (const amount of [0, -1, NaN, Infinity]) {
      expect(calculateRentalDiscount(amount, 5, tiers).hasDiscount).toBe(false)
    }
    for (const days of [null, "5", 5.5, -1]) expect(getRentalDiscountTier(days, tiers)).toBeNull()
  })

  test("车辆校验保留缺省语义，支持显式清空及自定义规则", () => {
    const vehicle = { plateNumber: "浙A12345", vehicleType: "sedan", brandModel: "BMW", registerDate: "2020-01-01", status: "idle" }
    expect(validateVehicle(vehicle).value).not.toHaveProperty("rentalDiscountTiers")
    expect(validateVehicle({ ...vehicle, rentalDiscountTiers: [] }).value.rentalDiscountTiers).toEqual([])
    expect(validateVehicle({ ...vehicle, rentalDiscountTiers: tiers }).value.rentalDiscountTiers[0].minDays).toBe(12)
    expect(validateVehicle({ ...vehicle, rentalDiscountTiers: null }).ok).toBe(false)
  })

  test("独立云函数的计价及模型副本与共享代码完全一致", () => {
    for (const name of ["vehicleCreate", "vehicleUpdate", "vehicleList", "vehicleAvailabilityCheck", "vehiclePublicDetail", "bookingDetail"]) {
      expect(fs.readFileSync(path.join(__dirname, "../cloudfunctions", name, "rentalPricing.js"), "utf8"))
        .toBe(fs.readFileSync(path.join(__dirname, "../shared/rentalPricing.js"), "utf8"))
    }
    for (const name of ["vehicleCreate", "vehicleUpdate", "vehicleList"]) {
      expect(fs.readFileSync(path.join(__dirname, "../cloudfunctions", name, "vehicle.js"), "utf8"))
        .toBe(fs.readFileSync(path.join(__dirname, "../shared/vehicle.js"), "utf8"))
    }
  })
})
