const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const BOOKING_STATUSES = ["pending", "contacted", "completed", "cancelled"]

function createError(code, message, details) {
  const result = {
    ok: false,
    code: String(code || "VALIDATION_ERROR"),
    message: String(message || "参数校验失败")
  }

  if (details !== undefined) {
    result.details = details
  }

  return result
}

function createOk(value) {
  return { ok: true, value }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  const list = []
  value.forEach((item) => {
    const text = String(item || "").trim()
    if (text && !list.includes(text)) {
      list.push(text)
    }
  })
  return list
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

function hasCapability(record, capability) {
  if (hasAdminRole(record)) {
    return true
  }

  const merged = normalizeStringArray([record && record.role].concat((record && record.roles) || [], (record && record.permissions) || []))
  if (capability === "booking_manage") {
    return merged.includes("booking_manage") || merged.includes("booking_manager")
  }

  return false
}

async function hasOpenidCapability(openid, capability) {
  if (!openid) {
    return false
  }

  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasCapability(item, capability))
}

function normalizeFilters(event) {
  const payload = event && typeof event === "object" ? event : {}
  const status = String(payload.status || "").trim()
  const keyword = String(payload.keyword || "").trim().toUpperCase()
  const limitRaw = Number(payload.limit)
  const pageRaw = Number(payload.page)
  const pageSizeRaw = Number(payload.pageSize)

  const limit = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 200
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.floor(pageSizeRaw) : 0

  return {
    status,
    keyword,
    limit: Math.min(Math.max(limit, 1), 500),
    page,
    pageSize: pageSize > 0 ? Math.min(Math.max(pageSize, 1), 100) : 0
  }
}

function validateFilters(event) {
  const filters = normalizeFilters(event)

  if (filters.status && filters.status !== "all" && !BOOKING_STATUSES.includes(filters.status)) {
    return createError("VALIDATION_ERROR", "筛选条件不合法", {
      errors: [
        {
          field: "status",
          message: "预约状态不合法",
          value: filters.status,
          allowed: ["all"].concat(BOOKING_STATUSES)
        }
      ]
    })
  }

  return createOk(filters)
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

function toTimestamp(input) {
  if (!input) {
    return 0
  }

  if (typeof input === "string") {
    return new Date(input).getTime() || 0
  }

  if (input instanceof Date) {
    return input.getTime() || 0
  }

  if (typeof input === "object" && typeof input.toDate === "function") {
    return input.toDate().getTime() || 0
  }

  return 0
}

function buildStats(list) {
  const stats = {
    total: list.length
  }

  BOOKING_STATUSES.forEach((status) => {
    stats[status] = list.filter((item) => item.status === status).length
  })

  return stats
}

function buildDashboardStats(list) {
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  return {
    total: list.length,
    pending: list.filter((item) => item.status === "pending").length,
    contacted: list.filter((item) => item.status === "contacted").length,
    completed: list.filter((item) => item.status === "completed").length,
    cancelled: list.filter((item) => item.status === "cancelled").length,
    recentCreated7d: list.filter((item) => {
      const createdAt = toTimestamp(item.createdAt)
      return createdAt >= sevenDaysAgo && createdAt <= now
    }).length
  }
}

function matchesKeyword(item, keyword) {
  if (!keyword) {
    return true
  }

  const source = [
    item.vehicleName,
    item.vehicleId,
    item.userName,
    item.phone,
    item.city,
    item.note,
    item.adminRemark,
    item.status
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase()

  return source.includes(keyword)
}

function sortList(list) {
  return list.slice().sort((prev, next) => {
    const nextTime = new Date(next.createdAt || 0).getTime()
    const prevTime = new Date(prev.createdAt || 0).getTime()
    return nextTime - prevTime
  })
}

function buildRecentCreatedList(list) {
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  return list
    .filter((item) => {
      const createdAt = toTimestamp(item.createdAt)
      return createdAt >= sevenDaysAgo && createdAt <= now
    })
    .sort((prev, next) => toTimestamp(next.createdAt) - toTimestamp(prev.createdAt))
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      vehicleName: item.vehicleName,
      userName: item.userName,
      city: item.city,
      startDate: item.startDate,
      endDate: item.endDate,
      status: item.status,
      createdAt: item.createdAt
    }))
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""

  try {
    const allowed = await hasOpenidCapability(openid, "booking_manage")
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    const check = validateFilters(event)
    if (!check.ok) {
      return check
    }

    const filters = check.value
    const res = await db.collection("bookings").limit(filters.limit).get()
    const rawList = res && Array.isArray(res.data) ? res.data : []

    const formattedList = rawList.map((item) => ({
      id: item._id || item.id || "",
      openid: item.openid || "",
      vehicleId: item.vehicleId || "",
      vehicleName: item.vehicleName || "",
      userName: item.userName || "",
      phone: item.phone || "",
      startDate: item.startDate || "",
      endDate: item.endDate || "",
      city: item.city || "",
      note: item.note || "",
      adminRemark: item.adminRemark || "",
      adminRemarkUpdatedAt: formatTime(item.adminRemarkUpdatedAt),
      status: item.status || "pending",
      createdAt: formatTime(item.createdAt),
      updatedAt: formatTime(item.updatedAt)
    }))

    const filteredList = sortList(
      formattedList.filter((item) => {
        if (filters.status && filters.status !== "all" && item.status !== filters.status) {
          return false
        }

        return matchesKeyword(item, filters.keyword)
      })
    )

    const offset = filters.pageSize ? filters.page * filters.pageSize : 0
    const list = filters.pageSize ? filteredList.slice(offset, offset + filters.pageSize) : filteredList

    const pagination = filters.pageSize
      ? {
          page: filters.page,
          pageSize: filters.pageSize,
          hasMore: Boolean(offset + filters.pageSize < filteredList.length)
        }
      : {}

    return {
      ok: true,
      filters,
      total: filteredList.length,
      stats: buildStats(filteredList),
      dashboard: buildDashboardStats(formattedList),
      recentCreatedList: buildRecentCreatedList(formattedList),
      ...pagination,
      list
    }
  } catch (error) {
    console.error({
      function: "bookingList",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询预约列表失败，请稍后重试")
  }
}
