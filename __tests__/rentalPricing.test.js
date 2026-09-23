const {
  DEFAULT_RENTAL_DISCOUNT_TIERS,
  getRentalDiscountTier,
  calculateRentalDiscount
} = require("../shared/rentalPricing")

describe("shared/rentalPricing", () => {
  test("阶梯梯度配置包含 3天、7天、15天与30天阶梯", () => {
    expect(DEFAULT_RENTAL_DISCOUNT_TIERS).toHaveLength(4)
    expect(DEFAULT_RENTAL_DISCOUNT_TIERS.map((t) => t.minDays)).toEqual([30, 15, 7, 3])
  })

  test("1天与2天租期无连租折扣", () => {
    expect(getRentalDiscountTier(1)).toBeNull()
    expect(getRentalDiscountTier(2)).toBeNull()
    const r1 = calculateRentalDiscount(1000, 1)
    expect(r1.hasDiscount).toBe(false)
    expect(r1.discountedTotal).toBe(1000)
    expect(r1.savingsAmount).toBe(0)
    expect(r1.discountTier).toBeNull()

    const r2 = calculateRentalDiscount(2000, 2)
    expect(r2.hasDiscount).toBe(false)
    expect(r2.discountedTotal).toBe(2000)
    expect(r2.savingsAmount).toBe(0)
  })

  test("3-6天享受 95 折连租特惠", () => {
    const tier = getRentalDiscountTier(3)
    expect(tier).toMatchObject({ minDays: 3, discountRate: 0.95, label: "连租特惠 95折" })
    expect(getRentalDiscountTier(6)).toMatchObject({ minDays: 3, discountRate: 0.95 })

    const r = calculateRentalDiscount(10000, 3)
    expect(r.hasDiscount).toBe(true)
    expect(r.discountRate).toBe(0.95)
    expect(r.discountedTotal).toBe(9500)
    expect(r.savingsAmount).toBe(500)
    expect(r.discountTier).toMatchObject({ minDays: 3, discountRate: 0.95, savingsAmount: 500 })
  })

  test("7-14天享受 90 折周租专享", () => {
    const tier = getRentalDiscountTier(7)
    expect(tier).toMatchObject({ minDays: 7, discountRate: 0.90, label: "周租专享 9折" })
    expect(getRentalDiscountTier(14)).toMatchObject({ minDays: 7, discountRate: 0.90 })

    const r = calculateRentalDiscount(20000, 7)
    expect(r.hasDiscount).toBe(true)
    expect(r.discountRate).toBe(0.90)
    expect(r.discountedTotal).toBe(18000)
    expect(r.savingsAmount).toBe(2000)
  })

  test("15-29天享受 85 折半月特惠", () => {
    const tier = getRentalDiscountTier(15)
    expect(tier).toMatchObject({ minDays: 15, discountRate: 0.85, label: "半月特惠 85折" })
    expect(getRentalDiscountTier(29)).toMatchObject({ minDays: 15, discountRate: 0.85 })

    const r = calculateRentalDiscount(30000, 15)
    expect(r.hasDiscount).toBe(true)
    expect(r.discountRate).toBe(0.85)
    expect(r.discountedTotal).toBe(25500)
    expect(r.savingsAmount).toBe(4500)
  })

  test("30天及以上享受 75 折月租尊享", () => {
    const tier = getRentalDiscountTier(30)
    expect(tier).toMatchObject({ minDays: 30, discountRate: 0.75, label: "月租尊享 75折" })
    expect(getRentalDiscountTier(60)).toMatchObject({ minDays: 30, discountRate: 0.75 })

    const r = calculateRentalDiscount(50000, 30)
    expect(r.hasDiscount).toBe(true)
    expect(r.discountRate).toBe(0.75)
    expect(r.discountedTotal).toBe(37500)
    expect(r.savingsAmount).toBe(12500)
  })

  test("异常边界输入安全返回（零金额、负数、非法输入）", () => {
    expect(calculateRentalDiscount(0, 5)).toMatchObject({ hasDiscount: false, discountedTotal: 0, savingsAmount: 0 })
    expect(calculateRentalDiscount(-100, 5)).toMatchObject({ hasDiscount: false, discountedTotal: 0, savingsAmount: 0 })
    expect(calculateRentalDiscount(1000, null)).toMatchObject({ hasDiscount: false, discountedTotal: 1000, savingsAmount: 0 })
    expect(calculateRentalDiscount(1000, "abc")).toMatchObject({ hasDiscount: false, discountedTotal: 1000, savingsAmount: 0 })
  })
})
