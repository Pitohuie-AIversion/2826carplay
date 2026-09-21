/**
 * 极境车库 - 客户跟进标签体系
 */

const PRESET_CUSTOMER_TAGS = [
  "老客户",
  "高意向",
  "需要送车",
  "长租意向",
  "车损敏感",
  "跨城用车",
  "待二次回访"
]

const TAG_COLOR_MAP = {
  老客户: { bg: "rgba(208, 158, 90, 0.15)", text: "#E8C88B", border: "rgba(208, 158, 90, 0.35)" },
  高意向: { bg: "rgba(229, 83, 83, 0.15)", text: "#FF7875", border: "rgba(229, 83, 83, 0.35)" },
  需要送车: { bg: "rgba(82, 143, 255, 0.15)", text: "#79A8FF", border: "rgba(82, 143, 255, 0.35)" },
  长租意向: { bg: "rgba(46, 204, 113, 0.15)", text: "#5CDBD3", border: "rgba(46, 204, 113, 0.35)" },
  车损敏感: { bg: "rgba(243, 156, 18, 0.15)", text: "#FFC069", border: "rgba(243, 156, 18, 0.35)" },
  跨城用车: { bg: "rgba(155, 89, 182, 0.15)", text: "#B37FEB", border: "rgba(155, 89, 182, 0.35)" },
  待二次回访: { bg: "rgba(250, 140, 22, 0.15)", text: "#FFBB96", border: "rgba(250, 140, 22, 0.35)" }
}

const DEFAULT_TAG_STYLE = {
  bg: "rgba(141, 152, 170, 0.15)",
  text: "#A6B5CC",
  border: "rgba(141, 152, 170, 0.3)"
}

function normalizeTags(input) {
  let list = []
  if (Array.isArray(input)) {
    list = input
  } else if (typeof input === "string") {
    list = input.split(/[,，、|\s]+/)
  }
  const set = new Set()
  list.forEach((raw) => {
    const tag = String(raw || "").trim()
    if (tag.length > 0 && tag.length <= 12) {
      set.add(tag)
    }
  })
  return Array.from(set).slice(0, 5)
}

function hasMatchingTag(booking, targetTag) {
  if (!booking || !targetTag) return false
  const tags = Array.isArray(booking.tags) ? booking.tags : normalizeTags(booking.tags)
  const query = String(targetTag).trim().toLowerCase()
  return tags.some((t) => t.toLowerCase() === query)
}

function getTagStyle(tagName) {
  return TAG_COLOR_MAP[tagName] || DEFAULT_TAG_STYLE
}

module.exports = {
  PRESET_CUSTOMER_TAGS,
  normalizeTags,
  hasMatchingTag,
  getTagStyle
}
