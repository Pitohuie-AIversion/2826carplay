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

module.exports = {
  MAX_RENTAL_DISCOUNT_TIERS,
  validateRentalDiscountTiers,
  normalizeRentalDiscountTiers,
  getRentalDiscountTier,
  calculateRentalDiscount
}
