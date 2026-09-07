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

const BOOKING_STATUSES = ["pending", "contacted", "quoted", "adjustment_requested", "confirmed", "completed", "cancelled"]
const BOOKING_BATCH_SIZE = 100
const MAX_EXPORT_SOURCE_RECORDS = 2000
const ATTRIBUTION_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/
const ATTRIBUTION_CHANNELS = ["direct", "wechat_share", "moments", "qr", "official_account", "campaign"]
const ATTRIBUTION_SCENES = ["weekend_trip", "business_reception", "group_travel", "ev_experience"]
const BOOKING_EXPORT_FIELDS = {
  _id: true,
  id: true,
  vehicleId: true,
  vehicleName: true,
  userName: true,
  phone: true,
  startDate: true,
  endDate: true,
  city: true,
  note: true,
  adminRemark: true,
  schedulePriority: true,
  coordinationStatus: true,
  status: true,
  attribution: true,
  createdAt: true,
  updatedAt: true
}

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

function normalizeText(value, maxLength) {
  const text = String(value || "").trim()
  return maxLength && text.length > maxLength ? text.slice(0, maxLength) : text
}

function limitText(value, maxLength) {
  const text = String(value === undefined || value === null ? "" : value)
  return maxLength && text.length > maxLength ? text.slice(0, maxLength) : text
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

async function writeErrorLogBestEffort(payload) {
  try {
    await db.collection("error_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "bookingExportCsv",
      stage: "errorLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

async function writeAuditLogBestEffort(payload) {
  try {
    await db.collection("audit_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "bookingExportCsv",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

function normalizeFilters(event) {
  const payload = event && typeof event === "object" ? event : {}
  const status = normalizeText(payload.status, 50)
  const schedulePriority = normalizeText(payload.schedulePriority, 50)
  const coordinationStatus = normalizeText(payload.coordinationStatus, 50)
  const keyword = normalizeText(payload.keyword, 100).toUpperCase()
  const limitRaw = Number(payload.limit)
  const limit = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 500

  return {
    status,
    schedulePriority,
    coordinationStatus,
    keyword,
    limit: Math.min(Math.max(limit, 1), 500)
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
    !["priority", "normal", "standby"].includes(filters.schedulePriority)
  ) {
    return createError("VALIDATION_ERROR", "筛选条件不合法", {
      errors: [{ field: "schedulePriority", message: "预约优先级不合法" }]
    })
  }
  if (
    filters.coordinationStatus &&
    filters.coordinationStatus !== "all" &&
    !["pending", "coordinating", "resolved"].includes(filters.coordinationStatus)
  ) {
    return createError("VALIDATION_ERROR", "筛选条件不合法", {
      errors: [{ field: "coordinationStatus", message: "协调状态不合法" }]
    })
  }

  return { ok: true, value: filters }
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

function toTimestamp(input) {
  if (!input) {
    return 0
  }

  if (input instanceof Date) {
    return input.getTime() || 0
  }

  if (typeof input === "object" && typeof input.toDate === "function") {
    return input.toDate().getTime() || 0
  }

  return new Date(input).getTime() || 0
}

async function readBookingsByMode(ordered) {
  const list = []

  for (let offset = 0; offset <= MAX_EXPORT_SOURCE_RECORDS; offset += BOOKING_BATCH_SIZE) {
    const remaining = MAX_EXPORT_SOURCE_RECORDS + 1 - list.length
    const batchSize = Math.min(BOOKING_BATCH_SIZE, remaining)
    let query = db.collection("bookings").field(BOOKING_EXPORT_FIELDS)
    if (ordered) {
      query = query.orderBy("createdAt", "desc")
    }
    const res = await query.skip(offset).limit(batchSize).get()
    const batch = res && Array.isArray(res.data) ? res.data : []

    list.push(...batch)
    if (batch.length < batchSize || list.length > MAX_EXPORT_SOURCE_RECORDS) {
      break
    }
  }

  return {
    list: list.slice(0, MAX_EXPORT_SOURCE_RECORDS),
    truncated: list.length > MAX_EXPORT_SOURCE_RECORDS
  }
}

async function readBookings() {
  try {
    return await readBookingsByMode(true)
  } catch (indexError) {
    console.warn({
      function: "bookingExportCsv",
      stage: "indexFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    return readBookingsByMode(false)
  }
}

function pad2(value) {
  return `${value}`.padStart(2, "0")
}

function formatFileName(date) {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  const second = pad2(date.getSeconds())
  return `bookings_${year}${month}${day}_${hour}${minute}${second}.csv`
}

function escapeCsvCell(value) {
  const text = String(value === undefined || value === null ? "" : value)
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const formulaPrefixPattern =
    /^[\t\n\u0000]|^[\s\u0000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/
  const safeText = formulaPrefixPattern.test(normalized) ? `'${normalized}` : normalized
  const escaped = safeText.replace(/"/g, '""')
  const needWrap = /[",\n]/.test(escaped)
  return needWrap ? `"${escaped}"` : escaped
}

function buildCsv(items) {
  const header = [
    "提交时间",
    "状态",
    "预约优先级",
    "协调状态",
    "车辆名称",
    "联系人",
    "手机号",
    "城市",
    "开始日期",
    "结束日期",
    "用户备注",
    "管理员备注",
    "内容ID",
    "归因渠道",
    "归因场景",
    "最后更新时间",
    "预约ID"
  ]

  const lines = [header.map(escapeCsvCell).join(",")]
  items.forEach((item) => {
    lines.push(
      [
        item.createdAt,
        item.status,
        item.schedulePriorityText,
        item.coordinationStatusText,
        item.vehicleName,
        item.userName,
        item.phone,
        item.city,
        item.startDate,
        item.endDate,
        item.note,
        item.adminRemark,
        item.contentId,
        item.attributionChannel,
        item.attributionScene,
        item.updatedAt,
        item.id
      ]
        .map(escapeCsvCell)
        .join(",")
    )
  })

  return `\ufeff${lines.join("\r\n")}`
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const normalizedLogFilters = normalizeFilters(event)
  const logContext = {
    status: normalizedLogFilters.status || "all",
    schedulePriority: normalizedLogFilters.schedulePriority || "all",
    coordinationStatus: normalizedLogFilters.coordinationStatus || "all",
    limit: normalizedLogFilters.limit,
    keywordProvided: Boolean(normalizedLogFilters.keyword)
  }

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
    const bookingRecords = await readBookings()
    const rawList = bookingRecords.list

    const matchedList = rawList
      .map((item) => {
        const attributionSource = item.attribution && typeof item.attribution === "object" ? item.attribution : {}
        const rawContentId = String(attributionSource.contentId || "").trim()
        const rawChannel = String(attributionSource.channel || "").trim()
        const rawScene = String(attributionSource.scene || "").trim()
        return {
        id: normalizeText(item._id || item.id, 128),
        vehicleId: normalizeText(item.vehicleId, 128),
        vehicleName: limitText(item.vehicleName, 100),
        userName: limitText(item.userName, 50),
        phone: normalizeText(item.phone, 30),
        startDate: normalizeText(item.startDate, 20),
        endDate: normalizeText(item.endDate, 20),
        city: limitText(item.city, 50),
        note: limitText(item.note, 500),
        adminRemark: limitText(item.adminRemark, 200),
        contentId: ATTRIBUTION_ID_PATTERN.test(rawContentId) ? rawContentId : "",
        attributionChannel: ATTRIBUTION_CHANNELS.includes(rawChannel) ? rawChannel : "",
        attributionScene: ATTRIBUTION_SCENES.includes(rawScene) ? rawScene : "",
        schedulePriority: ["priority", "normal", "standby"].includes(item.schedulePriority)
          ? item.schedulePriority
          : "normal",
        schedulePriorityText:
          item.schedulePriority === "priority"
            ? "优先"
            : item.schedulePriority === "standby"
              ? "候补"
              : "常规",
        coordinationStatus:
          item.status === "completed" || item.status === "cancelled"
            ? "resolved"
            : ["pending", "coordinating", "resolved"].includes(item.coordinationStatus)
              ? item.coordinationStatus
              : "pending",
        coordinationStatusText:
          item.status === "completed" || item.status === "cancelled" || item.coordinationStatus === "resolved"
            ? "已协调"
            : item.coordinationStatus === "coordinating"
              ? "协调中"
              : "待协调",
        status: item.status || "pending",
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      }
      })
      .filter((item) => {
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
        return matchesKeyword(item, filters.keyword)
      })
      .sort((left, right) => toTimestamp(right.createdAt) - toTimestamp(left.createdAt))
    const list = matchedList.slice(0, filters.limit)
    const exportTruncated = matchedList.length > filters.limit
    const truncated = bookingRecords.truncated || exportTruncated

    const fileName = formatFileName(new Date())
    const csvText = buildCsv(list)

    await writeAuditLogBestEffort({
      openid,
      action: "bookingExportCsv",
      status: filters.status || "all",
      schedulePriority: filters.schedulePriority || "all",
      coordinationStatus: filters.coordinationStatus || "all",
      keywordProvided: Boolean(filters.keyword),
      limit: filters.limit,
      total: list.length,
      matchedTotal: matchedList.length,
      sourceTruncated: bookingRecords.truncated,
      exportTruncated,
      fileName
    })

    return {
      ok: true,
      filters,
      fileName,
      total: list.length,
      matchedTotal: matchedList.length,
      sourceTruncated: bookingRecords.truncated,
      exportTruncated,
      truncated,
      csvText
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    await writeErrorLogBestEffort({
      function: "bookingExportCsv",
      stage: "main",
      authenticated: Boolean(openid),
      ...logContext,
      errorMessage,
      occurredAt: new Date().toISOString()
    })

    console.error({
      function: "bookingExportCsv",
      authenticated: Boolean(openid),
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "导出失败，请稍后重试")
  }
}
