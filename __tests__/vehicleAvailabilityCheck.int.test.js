jest.mock("wx-server-sdk")

function loadModule({ openid = "user_openid", vehicle, bookings = [], total = bookings.length, occupiedDates = [], priceRules = [] }) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })

  const bookingWhere = jest.fn(() => {
    let offset = 0
    let limit = 100
    const chain = {
      count: jest.fn().mockResolvedValue({ total }),
      field: jest.fn(() => chain),
      skip: jest.fn((value) => {
        offset = value
        return chain
      }),
      limit: jest.fn((value) => {
        limit = value
        return chain
      }),
      get: jest.fn(() => Promise.resolve({ data: bookings.slice(offset, offset + limit) }))
    }
    return chain
  })
  const vehicleGet = jest.fn().mockResolvedValue({ data: vehicle || null })
  const vehicleField = jest.fn(() => ({ get: vehicleGet }))

  cloud.__setMockDb({
    collection: jest.fn((name) => {
      if (name === "vehicles") {
        return {
          doc: jest.fn(() => ({ field: vehicleField }))
        }
      }
      if (name === "bookings") {
        return { where: bookingWhere }
      }
      if (name === "vehicle_calendar_days") {
        return {
          doc: jest.fn((id) => ({
            field: jest.fn(() => ({
              get: jest.fn(() => {
                const date = String(id).slice(-8).replace(/(\d{4})(\d{2})(\d{2})/, "$1-$2-$3")
                if (occupiedDates.includes(date)) return Promise.resolve({ data: { date, kind: "booking", blockId: "block_1" } })
                return Promise.reject(new Error("document not found"))
              })
            }))
          }))
        }
      }
      if (name === "vehicle_price_rules") {
        let offset = 0
        let limit = 100
        const chain = {
          where: jest.fn(() => chain),
          field: jest.fn(() => chain),
          orderBy: jest.fn(() => chain),
          skip: jest.fn((value) => { offset = value; return chain }),
          limit: jest.fn((value) => { limit = Math.min(value, 100); return chain }),
          get: jest.fn(async () => ({ data: priceRules.slice(offset, offset + limit) }))
        }
        return chain
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  })

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleAvailabilityCheck/index")
  })
  return { mod, bookingWhere, vehicleGet, vehicleField }
}

describe("cloudfunctions/vehicleAvailabilityCheck integration", () => {
  test.each([undefined, "", "legacy-unknown"])("未知车辆状态 %p 不会被当成可预约", async (status) => {
    const { mod, bookingWhere } = loadModule({ vehicle: { status, priceDay: 800 } })
    const result = await mod.main({ vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-02" })
    expect(result).toMatchObject({ ok: false, code: "NOT_AVAILABLE" })
    expect(result).not.toHaveProperty("priceSummary")
    expect(bookingWhere).not.toHaveBeenCalled()
  })

  test.each([null, "", "1800", 1800.5, -1])("适用特殊价 %p 不合法时不回退基础低价", async (dailyPrice) => {
    const { mod } = loadModule({ vehicle: { status: "idle", priceDay: 800 }, priceRules: [
      { label: "基础日租", startDate: "2099-08-02", endDate: "2099-08-02", dailyPrice }
    ] })
    const result = await mod.main({ vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-02" })
    expect(result).toMatchObject({ ok: true, available: true, priceSummary: {
      estimatedTotal: 0, estimatedTotalText: "待顾问报价", discountedTotalText: "待顾问报价", specialDayCount: 1, hasDiscount: false
    } })
    expect(result.priceSummary.daily.map((item) => item.dailyRate)).toEqual([800, 0])
  })

  test("价格零仍为待确认，完整特殊日期价可以为缺省基础价提供估价", async () => {
    const unknown = loadModule({ vehicle: { status: "idle", priceDay: 0 } })
    expect((await unknown.mod.main({ vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-02" })).priceSummary.estimatedTotalText).toBe("待顾问报价")
    const priced = loadModule({ vehicle: { status: "idle", priceDay: 0 }, priceRules: [
      { startDate: "2099-08-01", endDate: "2099-08-02", dailyPrice: 1000 }
    ] })
    expect((await priced.mod.main({ vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-02" })).priceSummary.estimatedTotal).toBe(2000)
  })

  test("只返回同期咨询数量，不返回其他用户预约详情", async () => {
    const { mod, bookingWhere, vehicleField } = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle" },
      bookings: [
        {
          openid: "other_user",
          userName: "不应返回",
          phone: "13800000000",
          startDate: "2099-08-10",
          endDate: "2099-08-12",
          status: "pending"
        },
        {
          startDate: "2099-08-11",
          endDate: "2099-08-13",
          status: "cancelled"
        },
        {
          startDate: "2099-09-01",
          endDate: "2099-09-02",
          status: "contacted"
        }
      ]
    })

    const res = await mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-11",
      endDate: "2099-08-14"
    })

    expect(res).toMatchObject({
      ok: true,
      vehicleId: "vehicle_1",
      available: true,
      conflictCount: 0,
      inquiryCount: 1,
      truncated: false
    })
    expect(res.message).toContain("普通咨询不会锁车")
    expect(JSON.stringify(res)).not.toContain("13800000000")
    expect(JSON.stringify(res)).not.toContain("不应返回")
    expect(vehicleField).toHaveBeenCalledWith({ status: true, priceDay: true, rentalDiscountTiers: true })
    expect(bookingWhere).toHaveBeenCalledWith({ vehicleId: "vehicle_1" })
  })

  test("没有同期咨询时返回可继续提交", async () => {
    const { mod } = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle" },
      bookings: [
        {
          startDate: "2099-07-01",
          endDate: "2099-07-03",
          status: "completed"
        }
      ]
    })

    const res = await mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-01",
      endDate: "2099-08-02"
    })

    expect(res.available).toBe(true)
    expect(res.conflictCount).toBe(0)
    expect(res.message).toContain("可预约")
  })

  test("第101条相关价格规则仍参与估价，不回退成基础低价", async () => {
    const priceRules = Array.from({ length: 100 }, (_, index) => ({ _id: `old_${index}`, startDate: "2098-01-01", endDate: "2098-01-02", dailyPrice: 500, version: 1 }))
    priceRules.push({ _id: "new_rule", label: "假日价格", startDate: "2099-08-01", endDate: "2099-08-02", dailyPrice: 1800, version: 2 })
    const { mod } = loadModule({ vehicle: { status: "idle", priceDay: 800 }, priceRules })
    const result = await mod.main({ vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-02" })
    expect(result).toMatchObject({ ok: true, priceSummary: { estimatedTotal: 3600, specialDayCount: 2 } })
  })

  test("价格规则超过完整扫描上限时不返回部分估价", async () => {
    const priceRules = Array.from({ length: 2001 }, (_, index) => ({ _id: `rule_${index}`, startDate: "2098-01-01", endDate: "2098-01-02", dailyPrice: 500 }))
    const { mod } = loadModule({ vehicle: { status: "idle", priceDay: 800 }, priceRules })
    const result = await mod.main({ vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-02" })
    expect(result).toMatchObject({ ok: false, code: "PRICE_RULES_INCOMPLETE" })
    expect(result).not.toHaveProperty("priceSummary")
  })

  test("记录超过扫描上限时保守提示顾问确认", async () => {
    const { mod } = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle" },
      bookings: [],
      total: 1001
    })

    const res = await mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-01",
      endDate: "2099-08-02"
    })

    expect(res.available).toBe(true)
    expect(res.truncated).toBe(true)
    expect(res.message).toContain("顾问确认")
  })

  test("已确认按日占用会阻止档期并返回特殊日期价格摘要与阶梯折扣", async () => {
    const { mod } = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle", priceDay: 800, rentalDiscountTiers: [{ minDays: 3, discountRate: 0.95 }] },
      occupiedDates: ["2099-08-02"],
      priceRules: [{ label: "暑期价", startDate: "2099-08-02", endDate: "2099-08-03", dailyPrice: 980, status: "active" }]
    })
    const res = await mod.main({ vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-03" })
    expect(res).toMatchObject({ ok: true, available: false, occupiedDayCount: 1 })
    expect(res.priceSummary).toMatchObject({
      baseDailyRate: 800,
      specialDayCount: 2,
      estimatedTotal: 2760,
      discountedTotal: 2622,
      savingsAmount: 138,
      hasDiscount: true,
      discountTier: {
        minDays: 3,
        days: 3,
        discountRate: 0.95,
        label: "连租满3天 9.5折",
        savingsAmount: 138
      }
    })
  })

  test("周租与短期租赁阶梯折扣计算验证", async () => {
    const { mod } = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle", priceDay: 1000, rentalDiscountTiers: [{ minDays: 7, discountRate: 0.9 }] }
    })
    const weekRes = await mod.main({ vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-07" })
    expect(weekRes.priceSummary).toMatchObject({
      estimatedTotal: 7000,
      discountedTotal: 6300,
      savingsAmount: 700,
      hasDiscount: true,
      discountTier: { minDays: 7, days: 7, discountRate: 0.9, label: "连租满7天 9折" }
    })

    const shortRes = await mod.main({ vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-02" })
    expect(shortRes.priceSummary).toMatchObject({
      estimatedTotal: 2000,
      discountedTotal: 2000,
      savingsAmount: 0,
      hasDiscount: false,
      discountTier: null
    })
  })

  test("未配置不打折，客户端不能注入优惠", async () => {
    const { mod } = loadModule({ vehicle: { status: "idle", priceDay: 1000 } })
    const res = await mod.main({
      vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-30",
      rentalDiscountTiers: [{ minDays: 2, discountRate: 0.1 }]
    })
    expect(res.priceSummary).toMatchObject({ hasDiscount: false, discountedTotal: 30000 })
  })

  test("未登录、非法日期和停用车辆均不可查询", async () => {
    const unauthorized = loadModule({
      openid: "",
      vehicle: { _id: "vehicle_1", status: "idle" }
    })
    expect((await unauthorized.mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-01",
      endDate: "2099-08-02"
    })).code).toBe("UNAUTHORIZED")

    const invalid = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle" }
    })
    const invalidResult = await invalid.mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-02-30",
      endDate: "2099-03-01"
    })
    expect(invalidResult.code).toBe("VALIDATION_ERROR")
    expect(invalid.vehicleGet).not.toHaveBeenCalled()

    const retired = loadModule({
      vehicle: { _id: "vehicle_1", status: "retired" }
    })
    expect((await retired.mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-01",
      endDate: "2099-08-02"
    })).code).toBe("NOT_AVAILABLE")
  })
})
