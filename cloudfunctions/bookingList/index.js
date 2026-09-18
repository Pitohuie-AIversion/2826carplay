const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const BOOKING_MANAGE_LIST_FIELDS = {
  _id: true,
  openid: true,
  vehicleId: true,
  vehicleName: true,
  userName: true,
  phone: true,
  startDate: true,
  endDate: true,
  city: true,
  note: true,
  adminRemark: true,
  adminRemarkUpdatedAt: true,
  schedulePriority: true,
  coordinationStatus: true,
  status: true,
  createdAt: true,
  updatedAt: true
}

const BOOKING_STATUSES = ["pending", "contacted", "quoted", "adjustment_requested", "confirmed", "completed", "cancelled"]
const PRIORITY_VALUES = ["priority", "normal", "standby"]
const COORDINATION_VALUES = ["pending", "coordinating", "resolved"]
const BOOKING_BATCH_SIZE = 100
const MAX_BOOKING_RECORDS = 2000

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

  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasCapability(item, capability))
}

function normalizeFilters(event) {
  const payload = event && typeof event === "object" ? event : {}
  const status = String(payload.status || "").trim()
  const schedulePriority = String(payload.schedulePriority || "").trim()
  const coordinationStatus = String(payload.coordinationStatus || "").trim()
  const city = String(payload.city || "").trim()
  const keyword = String(payload.keyword || "").trim().toUpperCase()
  const limitRaw = Number(payload.limit)
  const pageRaw = Number(payload.page)
  const pageSizeRaw = Number(payload.pageSize)

  const limit = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 200
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.floor(pageSizeRaw) : 0

  return {
    status,
    schedulePriority,
    coordinationStatus,
    city,
    keyword,
    limit: Math.min(Math.max(limit, 1), MAX_BOOKING_RECORDS),
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

  if (
    filters.schedulePriority &&
    filters.schedulePriority !== "all" &&
    !PRIORITY_VALUES.includes(filters.schedulePriority)
  ) {
    return createError("VALIDATION_ERROR", "筛选条件不合法", {
      errors: [
        {
          field: "schedulePriority",
          message: "预约优先级不合法",
          value: filters.schedulePriority,
          allowed: ["all"].concat(PRIORITY_VALUES)
        }
      ]
    })
  }

  if (
    filters.coordinationStatus &&
    filters.coordinationStatus !== "all" &&
    !COORDINATION_VALUES.includes(filters.coordinationStatus)
  ) {
    return createError("VALIDATION_ERROR", "筛选条件不合法", {
      errors: [
        {
          field: "coordinationStatus",
          message: "协调状态不合法",
          value: filters.coordinationStatus,
          allowed: ["all"].concat(COORDINATION_VALUES)
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
    quoted: list.filter((item) => item.status === "quoted").length,
    adjustmentRequested: list.filter((item) => item.status === "adjustment_requested").length,
    confirmed: list.filter((item) => item.status === "confirmed").length,
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

async function readBookingsByMode(maxRecords, ordered) {
  const list = []

  for (let offset = 0; offset <= maxRecords; offset += BOOKING_BATCH_SIZE) {
    const remaining = maxRecords + 1 - list.length
    const batchSize = Math.min(BOOKING_BATCH_SIZE, remaining)
    let query = db.collection("bookings").field(BOOKING_MANAGE_LIST_FIELDS)
    if (ordered) {
      query = query.orderBy("createdAt", "desc")
    }
    const res = await query.skip(offset).limit(batchSize).get()
    const batch = res && Array.isArray(res.data) ? res.data : []

    list.push(...batch)
    if (batch.length < batchSize || list.length > maxRecords) {
      break
    }
  }

  return {
    list: list.slice(0, maxRecords),
    truncated: list.length > maxRecords
  }
}

async function readBookings(maxRecords) {
  try {
    return await readBookingsByMode(maxRecords, true)
  } catch (indexError) {
    console.warn({
      function: "bookingList",
      stage: "indexFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    return readBookingsByMode(maxRecords, false)
  }
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
    const bookingRecords = await readBookings(filters.limit)
    const rawList = bookingRecords.list

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
      schedulePriority: ["priority", "normal", "standby"].includes(item.schedulePriority)
        ? item.schedulePriority
        : "normal",
      coordinationStatus:
        item.status === "completed" || item.status === "cancelled"
          ? "resolved"
          : ["pending", "coordinating", "resolved"].includes(item.coordinationStatus)
            ? item.coordinationStatus
            : "pending",
      status: item.status || "pending",
      createdAt: formatTime(item.createdAt),
      updatedAt: formatTime(item.updatedAt)
    }))

    const filteredList = sortList(
      formattedList.filter((item) => {
        if (filters.status && filters.status !== "all" && item.status !== filters.status) {
          return false
        }
        if (
          filters.schedulePriority &&
          filters.schedulePriority !== "all" &&
          item.schedulePriority !== filters.schedulePriority
        ) {
          return false
        }
        if (
          filters.coordinationStatus &&
          filters.coordinationStatus !== "all" &&
          item.coordinationStatus !== filters.coordinationStatus
        ) {
          return false
        }
        if (filters.city && filters.city !== "all" && item.city !== filters.city) {
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
      truncated: bookingRecords.truncated,
      stats: buildStats(filteredList),
      dashboard: buildDashboardStats(formattedList),
      recentCreatedList: buildRecentCreatedList(formattedList),
      ...pagination,
      list
    }
  } catch (error) {
    console.error({
      function: "bookingList",
      authenticated: Boolean(openid),
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询预约列表失败，请稍后重试")
  }
}
