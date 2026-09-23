const DEFAULT_RENTAL_DISCOUNT_TIERS = [
  { minDays: 30, discountRate: 0.75, label: "月租尊享 75折" },
  { minDays: 15, discountRate: 0.85, label: "半月特惠 85折" },
  { minDays: 7, discountRate: 0.90, label: "周租专享 9折" },
  { minDays: 3, discountRate: 0.95, label: "连租特惠 95折" }
]

function getRentalDiscountTier(daysCount) {
  const days = Number.isInteger(daysCount) ? daysCount : 0
  if (days < 3) return null
  return DEFAULT_RENTAL_DISCOUNT_TIERS.find((t) => days >= t.minDays) || null
}

function calculateRentalDiscount(originalTotal, daysCount) {
  const raw = Number.isFinite(originalTotal) && originalTotal > 0 ? originalTotal : 0
  const tier = getRentalDiscountTier(daysCount)
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
    hasDiscount: true,
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
  DEFAULT_RENTAL_DISCOUNT_TIERS,
  getRentalDiscountTier,
  calculateRentalDiscount
}
