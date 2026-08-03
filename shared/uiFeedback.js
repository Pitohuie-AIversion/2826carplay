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

module.exports = {
  MAX_TOAST_TITLE_LENGTH,
  formatToastTitle
}
