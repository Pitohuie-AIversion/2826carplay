const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50

function normalizeText(value, maxLen) {
  const text = String(value || "").trim()
  if (!text) {
    return ""
  }
  return maxLen && text.length > maxLen ? text.slice(0, maxLen) : text
}

function normalizeNumber(value, fallback) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return fallback
  }
  return num
}

function hasAdminRole(record) {
  if (!record || typeof record !== "object") {
    return false
  }

  if (record.role === "admin") {
    return true
  }

  if (Array.isArray(record.roles) && record.roles.includes("admin")) {
    return true
  }

  if (record.isAdmin === true || record.admin === true) {
    return true
  }

  return false
}

async function isAdminOpenid(openid) {
  if (!openid) {
    return false
  }

  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasAdminRole(item))
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  const pageRaw = normalizeNumber(payload.page, 0)
  const pageSizeRaw = normalizeNumber(payload.pageSize, DEFAULT_PAGE_SIZE)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0
  const pageSize = Math.min(Math.max(Math.floor(pageSizeRaw), 1), MAX_PAGE_SIZE)

  return {
    page,
    pageSize,
    func: normalizeText(payload.func, 80),
    keyword: normalizeText(payload.keyword, 80).toUpperCase()
  }
}

function formatTime(input) {
  if (!input) {
    return ""
  }

  if (typeof input === "string") {
    return input
  }

  if (input instanceof Date) {
    return input.toISOString()
  }

  if (typeof input === "object" && typeof input.toDate === "function") {
    return input.toDate().toISOString()
  }

  return ""
}

function toSearchText(item) {
  return [
    item.function,
    item.openid,
    item.targetOpenid,
    item.vehicleId,
    item.bookingId,
    item.stage,
    item.errorMessage,
    item.occurredAt
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase()
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "权限不足"
      }
    }

    const res = await db.collection("error_logs").limit(500).get()
    const rawList = res && Array.isArray(res.data) ? res.data : []

    const list = rawList
      .map((item) => ({
        id: item._id || "",
        function: String(item.function || "").trim(),
        stage: String(item.stage || "").trim(),
        openid: String(item.openid || "").trim(),
        targetOpenid: String(item.targetOpenid || "").trim(),
        vehicleId: String(item.vehicleId || "").trim(),
        bookingId: String(item.bookingId || "").trim(),
        errorMessage: String(item.errorMessage || "").trim(),
        stack: String(item.stack || "").trim(),
        occurredAt: formatTime(item.occurredAt),
        createdAt: formatTime(item.createdAt)
      }))
      .filter((item) => {
        if (input.func && item.function !== input.func) {
          return false
        }
        if (input.keyword && !toSearchText(item).includes(input.keyword)) {
          return false
        }
        return true
      })
      .sort((prev, next) => {
        const timePrev = new Date(prev.createdAt || prev.occurredAt || 0).getTime()
        const timeNext = new Date(next.createdAt || next.occurredAt || 0).getTime()
        return timeNext - timePrev
      })

    const offset = input.page * input.pageSize
    const paged = list.slice(offset, offset + input.pageSize)

    return {
      ok: true,
      page: input.page,
      pageSize: input.pageSize,
      total: list.length,
      hasMore: Boolean(offset + input.pageSize < list.length),
      list: paged
    }
  } catch (error) {
    console.error({
      function: "errorLogList",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "查询错误日志失败，请稍后重试"
    }
  }
}

