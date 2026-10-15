const MAX_RENTAL_DISCOUNT_TIERS = 8

function validateRentalDiscountTiers(input) {
  if (!Array.isArray(input) || input.length > MAX_RENTAL_DISCOUNT_TIERS) {
    return "连租折扣最多设置 8 档"
  }
  const days = new Set()
  for (const tier of input) {
    if (!tier || !Number.isInteger(tier.minDays) || tier.minDays < 2 || tier.minDays > 90) {
      return "连租天数需为 2-90 的整数"
    }
    if (!Number.isFinite(tier.discountRate) || tier.discountRate < 0.01 || tier.discountRate > 0.99 ||
        Math.abs(tier.discountRate * 100 - Math.round(tier.discountRate * 100)) > 1e-8) {
      return "折扣需为 0.1-9.9 折，最多一位小数"
    }
    if (days.has(tier.minDays)) return "连租天数不能重复"
    days.add(tier.minDays)
  }
  return ""
}

function normalizeRentalDiscountTiers(input) {
  if (validateRentalDiscountTiers(input)) return []
  return input.map((tier) => ({
    minDays: tier.minDays,
    discountRate: tier.discountRate,
    label: `连租满${tier.minDays}天 ${Number((tier.discountRate * 10).toFixed(1))}折`
  })).sort((a, b) => b.minDays - a.minDays)
}

function getRentalDiscountTier(daysCount, tiers) {
  const days = Number.isInteger(daysCount) ? daysCount : 0
  return normalizeRentalDiscountTiers(tiers).find((t) => days >= t.minDays) || null
}

function calculateRentalDiscount(originalTotal, daysCount, tiers) {
  const raw = Number.isFinite(originalTotal) && originalTotal > 0 ? originalTotal : 0
  const tier = getRentalDiscountTier(daysCount, tiers)
  if (!tier || raw === 0) {
    return {
      hasDiscount: false,
      discountTier: null,
      discountRate: 1,
      discountLabel: "",
      originalTotal: raw,
      savingsAmount: 0,
      discountedTotal: raw
    }
  }
  const discountedTotal = Math.round(raw * tier.discountRate)
  const savingsAmount = raw - discountedTotal
  return {
    hasDiscount: savingsAmount > 0,
    discountTier: {
      minDays: tier.minDays,
      discountRate: tier.discountRate,
      label: tier.label,
      savingsAmount
    },
    discountRate: tier.discountRate,
    discountLabel: tier.label,
    originalTotal: raw,
    savingsAmount,
    discountedTotal
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86400000

function internalCalcDays(startDate, endDate) {
  const startStr = String(startDate || "").trim()
  const endStr = String(endDate || "").trim()
  if (!DATE_PATTERN.test(startStr) || !DATE_PATTERN.test(endStr)) return 0
  const start = Date.parse(`${startStr}T00:00:00Z`)
  const end = Date.parse(`${endStr}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0
  return Math.max(1, Math.round((end - start) / MS_PER_DAY) + 1)
}

function internalAddDays(dateStr, days) {
  if (typeof dateStr !== "string" || !DATE_PATTERN.test(dateStr) || !Number.isInteger(days)) return ""
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  const newYear = date.getUTCFullYear()
  const newMonth = String(date.getUTCMonth() + 1).padStart(2, "0")
  const newDay = String(date.getUTCDate()).padStart(2, "0")
  return `${newYear}-${newMonth}-${newDay}`
}

/**
 * 节假日与周末动态定价试算引擎 (Seasonal & Holiday Pricing Engine)
 * @param {number} baseDailyRate 基础单日租金
 * @param {string} startDate 租期开始日 YYYY-MM-DD
 * @param {string} endDate 租期结束日 YYYY-MM-DD
 * @param {object} [options={}] 配置项
 * @param {Array} [options.tiers] 连租梯度折扣配置
 * @param {number} [options.weekendMultiplier=1] 周末加价倍率 (如 1.15 代表 +15%)
 * @param {Array} [options.holidayRules=[]] 节假日加价规则
 * @param {object} [options.customDateRates={}] 指定特定日期独立价格覆盖
 * @returns {object} 价格明细矩阵与总计
 */
function calculateDynamicRentalPricing(baseDailyRate, startDate, endDate, options = {}) {
  const baseRate = Number.isFinite(baseDailyRate) && baseDailyRate > 0 ? Math.round(baseDailyRate) : 0
  const daysCount = internalCalcDays(startDate, endDate)

  if (baseRate === 0 || daysCount === 0) {
    return {
      rentalDays: daysCount,
      baseDailyRate: baseRate,
      dailyBreakdown: [],
      originalTotal: 0,
      hasDiscount: false,
      discountTier: null,
      discountRate: 1,
      discountLabel: "",
      savingsAmount: 0,
      discountedTotal: 0
    }
  }

  const {
    tiers = [],
    weekendMultiplier = 1,
    holidayRules = [],
    customDateRates = {}
  } = options

  const dailyBreakdown = []
  let currentDate = startDate
  let originalTotal = 0

  for (let i = 0; i < daysCount; i++) {
    const parts = currentDate.split("-").map(Number)
    const dateObj = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]))
    const dayOfWeek = dateObj.getUTCDay()
    const isWeekend = dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0

    let rate = baseRate
    let ruleTag = "base"
    let ruleDesc = "平时价"
    let multiplier = 1

    if (customDateRates && Object.prototype.hasOwnProperty.call(customDateRates, currentDate)) {
      rate = Math.round(Number(customDateRates[currentDate]) || baseRate)
      ruleTag = "custom"
      ruleDesc = "专享价"
      multiplier = baseRate > 0 ? Number((rate / baseRate).toFixed(2)) : 1
    } else {
      const matchedHoliday = Array.isArray(holidayRules)
        ? holidayRules.find(
            (h) => h && h.startDate && h.endDate && currentDate >= h.startDate && currentDate <= h.endDate
          )
        : null

      if (matchedHoliday) {
        multiplier = Number(matchedHoliday.multiplier) || 1
        rate = Math.round(baseRate * multiplier)
        ruleTag = "holiday"
        ruleDesc = matchedHoliday.name || "节假日"
      } else if (isWeekend && weekendMultiplier > 1) {
        multiplier = weekendMultiplier
        rate = Math.round(baseRate * multiplier)
        ruleTag = "weekend"
        ruleDesc = "周末峰值"
      }
    }

    originalTotal += rate
    dailyBreakdown.push({
      date: currentDate,
      dayOfWeek,
      ruleTag,
      ruleDesc,
      multiplier,
      rate
    })

    currentDate = addDays(currentDate, 1)
  }

  const discountInfo = calculateRentalDiscount(originalTotal, daysCount, tiers)

  return {
    rentalDays: daysCount,
    baseDailyRate: baseRate,
    dailyBreakdown,
    originalTotal,
    hasDiscount: discountInfo.hasDiscount,
    discountTier: discountInfo.discountTier,
    discountRate: discountInfo.discountRate,
    discountLabel: discountInfo.discountLabel,
    savingsAmount: discountInfo.savingsAmount,
    discountedTotal: discountInfo.discountedTotal
  }
}

module.exports = {
  MAX_RENTAL_DISCOUNT_TIERS,
  validateRentalDiscountTiers,
  normalizeRentalDiscountTiers,
  getRentalDiscountTier,
  calculateRentalDiscount,
  calculateDynamicRentalPricing
}
