/**
 * 极境车库 - 日期与租期业务计算工具集 (Date & Rental Span Utilities)
 *
 * 集中管理租期计算、日期格式校验、区间重叠判断与日期展示格式化，
 * 消除跨页面与云函数间的冗余实现，提供高可靠的单一日历/时间基准。
 */

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/
const MS_PER_DAY = 86400000

/**
 * 校验日期字符串是否为合法的 YYYY-MM-DD
 * @param {string} value 
 * @returns {boolean}
 */
function isValidDateFormat(value) {
  if (typeof value !== "string" || !DATE_REGEX.test(value)) {
    return false
  }
  const parts = value.split("-").map(Number)
  const year = parts[0]
  const month = parts[1]
  const day = parts[2]
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return false
  }
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

/**
 * 校验起止日期范围是否合法 (格式正确且 startDate <= endDate)
 * @param {string} startDate 
 * @param {string} endDate 
 * @returns {boolean}
 */
function isDateRangeValid(startDate, endDate) {
  if (!isValidDateFormat(startDate) || !isValidDateFormat(endDate)) {
    return false
  }
  return String(startDate) <= String(endDate)
}

/**
 * 计算两个日期之间的包含首尾日的租赁天数 (Inclusive Rental Days)
 * @param {string} startDate YYYY-MM-DD
 * @param {string} endDate YYYY-MM-DD
 * @returns {number} 租赁天数，异常或倒置返回 0
 */
function calculateRentalDays(startDate, endDate) {
  const startStr = String(startDate || "").trim()
  const endStr = String(endDate || "").trim()
  if (!DATE_REGEX.test(startStr) || !DATE_REGEX.test(endStr)) {
    return 0
  }
  const start = Date.parse(`${startStr}T00:00:00Z`)
  const end = Date.parse(`${endStr}T00:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return 0
  }
  return Math.max(1, Math.round((end - start) / MS_PER_DAY) + 1)
}

/**
 * 格式化租期描述文案 (如 "3 天"、"1 天")
 * @param {string} startDate 
 * @param {string} endDate 
 * @param {object} [options] 
 * @param {string} [options.fallback="—"] 
 * @param {boolean} [options.withNights=false] 是否带晚数 (如 "3 天 2 晚")
 * @returns {string}
 */
function formatDateSpan(startDate, endDate, options = {}) {
  const fallback = options.fallback || "—"
  const days = calculateRentalDays(startDate, endDate)
  if (days <= 0) {
    return fallback
  }
  if (options.withNights) {
    const nights = Math.max(0, days - 1)
    return `${days} 天 ${nights} 晚`
  }
  return `${days} 天`
}

/**
 * 在指定日期上增加/减少天数
 * @param {string} dateStr YYYY-MM-DD
 * @param {number} days 增加天数 (可为负数)
 * @returns {string} YYYY-MM-DD，若输入无效返回空字符串
 */
function addDays(dateStr, days) {
  if (!isValidDateFormat(dateStr) || !Number.isInteger(days)) {
    return ""
  }
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  const newYear = date.getUTCFullYear()
  const newMonth = String(date.getUTCMonth() + 1).padStart(2, "0")
  const newDay = String(date.getUTCDate()).padStart(2, "0")
  return `${newYear}-${newMonth}-${newDay}`
}

/**
 * 判断两个闭区间日期是否重叠
 * @param {string} startA 
 * @param {string} endA 
 * @param {string} startB 
 * @param {string} endB 
 * @returns {boolean}
 */
function isDateOverlap(startA, endA, startB, endB) {
  if (
    !isDateRangeValid(startA, endA) ||
    !isDateRangeValid(startB, endB)
  ) {
    return false
  }
  return !(String(endA) < String(startB) || String(startA) > String(endB))
}

/**
 * 判断某个具体日期是否落在起止日期区间内
 * @param {string} date 
 * @param {string} startDate 
 * @param {string} endDate 
 * @returns {boolean}
 */
function isDateInRange(date, startDate, endDate) {
  if (!isValidDateFormat(date) || !isDateRangeValid(startDate, endDate)) {
    return false
  }
  return String(date) >= String(startDate) && String(date) <= String(endDate)
}

/**
 * 比较两个日期
 * @param {string} dateA 
 * @param {string} dateB 
 * @returns {number} -1 (dateA < dateB), 0 (相等), 1 (dateA > dateB)
 */
function compareDates(dateA, dateB) {
  const strA = String(dateA || "").trim()
  const strB = String(dateB || "").trim()
  if (strA < strB) return -1
  if (strA > strB) return 1
  return 0
}

/**
 * 格式化 Date 实例或日期值为 YYYY-MM-DD
 * @param {Date|number|string} [date] Date对象、时间戳或可解析字符串，默认当前时间
 * @returns {string} YYYY-MM-DD
 */
function formatDate(date) {
  const d = date instanceof Date
    ? date
    : (date !== undefined && date !== null ? new Date(date) : new Date())
  if (Number.isNaN(d.getTime())) return ""
  const year = d.getFullYear()
  const month = `${d.getMonth() + 1}`.padStart(2, "0")
  const day = `${d.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

/**
 * 获取跨度描述文案（如 "当日取还"、"3 天跨度"）
 * @param {string} startDate 
 * @param {string} endDate 
 * @param {string} [fallback="待选择日期"] 异常或空时的兜底文案
 * @returns {string}
 */
function getDateSpanText(startDate, endDate, fallback = "待选择日期") {
  const start = new Date(`${String(startDate || "")}T00:00:00`)
  const end = new Date(`${String(endDate || "")}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return fallback
  }
  const days = Math.round((end.getTime() - start.getTime()) / MS_PER_DAY)
  return days === 0 ? "当日取还" : `${days} 天跨度`
}

/**
 * 获取中国标准时间 (UTC+8) 的 YYYY-MM-DD 日期字符串
 * @param {Date|number|string} [date] 可选的基准时间，缺省为当前时间
 * @returns {string} YYYY-MM-DD
 */
function getChinaToday(date) {
  const time = date instanceof Date
    ? date.getTime()
    : (date !== undefined && date !== null ? new Date(date).getTime() : Date.now())
  if (Number.isNaN(time)) return ""
  return new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/**
 * 格式化日期为中文 "M月D日" (例如 "2026-10-08" -> "10月08日")
 * @param {string} value 
 * @param {string} [fallback="—"] 
 * @returns {string}
 */
function formatMonthDay(value, fallback = "—") {
  const text = String(value || "").trim()
  const match = text.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return match ? `${match[1]}月${match[2]}日` : fallback
}

module.exports = {
  DATE_REGEX,
  MS_PER_DAY,
  isValidDateFormat,
  isDateRangeValid,
  calculateRentalDays,
  formatDateSpan,
  getDateSpanText,
  formatDate,
  addDays,
  isDateOverlap,
  isDateInRange,
  compareDates,
  getChinaToday,
  formatMonthDay
}

