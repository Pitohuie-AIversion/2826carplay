const MAX_TOAST_TITLE_LENGTH = 10
const DEFAULT_TOAST_TITLE = "操作失败"

function normalizeTitle(value) {
  return String(value || "").trim().replace(/\s+/g, " ")
}

function truncateTitle(value) {
  const characters = Array.from(value)
  if (characters.length <= MAX_TOAST_TITLE_LENGTH) {
    return value
  }
  return `${characters.slice(0, MAX_TOAST_TITLE_LENGTH - 1).join("")}…`
}

function formatToastTitle(value, fallback) {
  const fallbackTitle = normalizeTitle(fallback) || DEFAULT_TOAST_TITLE
  const title = normalizeTitle(value)

  if (title && Array.from(title).length <= MAX_TOAST_TITLE_LENGTH) {
    return title
  }
  return truncateTitle(fallbackTitle)
}

/**
 * 使用最大余数法 (Hamilton-Hare) 计算分段百分比，保证各段百分比之和严格等于 100%
 * @param {Array<{key: string, label: string, value: number, [k: string]: any}>} segments 分段数组
 * @param {number} [customTotal] 可选的总量，缺省时自动求和
 * @returns {Array<object>} 附加了整型 percent 和 percentText 属性的分段数组
 */
function calculateRatioSegments(segments, customTotal) {
  const items = Array.isArray(segments) ? segments : []
  const total = Number.isFinite(customTotal) && customTotal > 0
    ? customTotal
    : items.reduce((sum, item) => sum + (Number(item && item.value) || 0), 0)

  if (!total) {
    return items.map((item) => ({
      ...item,
      percent: 0,
      percentText: "0%"
    }))
  }

  const rawPercents = items.map((item) => ((Number(item && item.value) || 0) / total) * 100)
  const targetSum = Math.round(rawPercents.reduce((sum, val) => sum + val, 0))
  const floors = rawPercents.map((val) => Math.floor(val))
  let remain = targetSum - floors.reduce((sum, n) => sum + n, 0)
  const order = rawPercents
    .map((value, index) => ({
      index,
      frac: value - floors[index]
    }))
    .sort((a, b) => b.frac - a.frac)

  const percents = floors.slice()
  for (let i = 0; i < remain && i < order.length; i++) {
    percents[order[i].index] += 1
  }

  return items.map((item, index) => ({
    ...item,
    percent: percents[index],
    percentText: `${percents[index]}%`
  }))
}

/**
 * 将多行冒号分隔的键值对文本解析为标签-数值对象列表
 * @param {string} summary 多行文本
 * @returns {Array<{label: string, value: string}>}
 */
function buildSummaryRows(summary) {
  return String(summary || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf("：")
      if (separatorIndex < 0) {
        return { label: "详情", value: line }
      }
      return {
        label: line.slice(0, separatorIndex),
        value: line.slice(separatorIndex + 1) || "—"
      }
    })
}

/**
 * 规整字符串数组：裁剪前后空白、过滤空串并去重
 * @param {Array<string>} input 
 * @returns {Array<string>}
 */
function normalizeStringArray(input) {
  if (!Array.isArray(input)) return []
  const result = []
  input.forEach((item) => {
    const value = String(item || "").trim()
    if (value && !result.includes(value)) {
      result.push(value)
    }
  })
  return result
}

module.exports = {
  MAX_TOAST_TITLE_LENGTH,
  formatToastTitle,
  calculateRatioSegments,
  buildSummaryRows,
  normalizeStringArray
}
