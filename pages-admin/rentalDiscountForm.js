const { markUnsaved } = require("../shared/unsavedChanges")
const { MAX_RENTAL_DISCOUNT_TIERS } = require("../shared/rentalPricing")

function toDiscountRows(tiers) {
  return (Array.isArray(tiers) ? tiers : []).map((tier) => {
    const value = tier && typeof tier === "object" ? tier : {}
    return {
      minDays: value.minDays == null ? "" : String(value.minDays),
      discount: value.discountRate == null ? "" : String(Number((Number(value.discountRate) * 10).toFixed(10)))
    }
  })
}

function toDiscountTiers(rows) {
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    minDays: Number(row.minDays),
    discountRate: Number((Number(row.discount) / 10).toFixed(10))
  }))
}

function updateRows(page, rows) {
  page.setData({ discountRows: rows })
  markUnsaved(page, "车辆资料尚未保存，确定离开吗？")
}

const discountFormMethods = {
  handleAddDiscountTier() {
    if (this.data.isSubmitting || this.data.loading) return
    const rows = this.data.discountRows || []
    if (rows.length >= MAX_RENTAL_DISCOUNT_TIERS) {
      wx.showToast({ title: "连租折扣最多 8 档", icon: "none" })
      return
    }
    updateRows(this, rows.concat({ minDays: "", discount: "" }))
  },
  handleRemoveDiscountTier(event) {
    if (this.data.isSubmitting || this.data.loading) return
    const index = Number(event.currentTarget.dataset.index)
    const rows = this.data.discountRows || []
    if (!Number.isInteger(index) || index < 0 || index >= rows.length) return
    updateRows(this, rows.filter((row, idx) => idx !== index))
  },
  handleDiscountTierInput(event) {
    if (this.data.isSubmitting || this.data.loading) return
    const { field, index } = event.currentTarget.dataset
    const idx = Number(index)
    const rows = this.data.discountRows || []
    if (!["minDays", "discount"].includes(field) || !Number.isInteger(idx) || !rows[idx]) return
    updateRows(this, rows.map((row, i) => i === idx
      ? { ...row, [field]: String(event.detail.value || "").trim() }
      : row))
  }
}

module.exports = { toDiscountRows, toDiscountTiers, discountFormMethods }
