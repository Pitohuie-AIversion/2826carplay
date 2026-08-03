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
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const LOG_BATCH_SIZE = 100
const MAX_LOG_RECORDS = 2000
const AUDIT_LOG_FIELDS = {
  _id: true,
  action: true,
  openid: true,
  targetOpenid: true,
  vehicleId: true,
  brandModel: true,
  bookingId: true,
  requestId: true,
  requestType: true,
  imageAction: true,
  tokenProtected: true,
  toPermissions: true,
  cutoffDate: true,
  retentionDays: true,
  processed: true,
  deleted: true,
  failed: true,
  bookingCount: true,
  favoriteCount: true,
  privacyRequestCount: true,
  partial: true,
  logType: true,
  filter: true,
  total: true,
  matchedTotal: true,
  sourceTruncated: true,
  truncated: true,
  fromStatus: true,
  toStatus: true,
  status: true,
  schedulePriority: true,
  coordinationStatus: true,
  fromPriority: true,
  toPriority: true,
  fromCoordinationStatus: true,
  toCoordinationStatus: true,
  remarkLength: true,
  changedKeys: true,
  createdAt: true
}

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

function normalizeTextArray(value, maxItems, maxLen) {
  if (!Array.isArray(value)) {
    return []
  }
  return value
    .map((item) => normalizeText(item, maxLen))
    .filter(Boolean)
    .slice(0, maxItems)
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

  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
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
    action: normalizeText(payload.action, 50),
    keyword: normalizeText(payload.keyword, 50).toUpperCase()
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
  const source = [
    item.action,
    item.openid,
    item.targetOpenid,
    item.vehicleId,
    item.bookingId,
    item.requestId,
    item.requestType,
    item.imageAction,
    item.cutoffDate,
    item.changedKeys ? item.changedKeys.join(",") : "",
    item.fromStatus,
    item.toStatus,
    item.fromPriority,
    item.toPriority,
    item.fromCoordinationStatus,
    item.toCoordinationStatus
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase()

  return source
}

async function readAuditLogsByMode(ordered) {
  const list = []

  for (let offset = 0; offset <= MAX_LOG_RECORDS; offset += LOG_BATCH_SIZE) {
    const remaining = MAX_LOG_RECORDS + 1 - list.length
    const batchSize = Math.min(LOG_BATCH_SIZE, remaining)
    let query = db.collection("audit_logs").field(AUDIT_LOG_FIELDS)
    if (ordered) {
      query = query.orderBy("createdAt", "desc")
    }
    const res = await query.skip(offset).limit(batchSize).get()
    const batch = res && Array.isArray(res.data) ? res.data : []

    list.push(...batch)
    if (batch.length < batchSize || list.length > MAX_LOG_RECORDS) {
      break
    }
  }

  return {
    list: list.slice(0, MAX_LOG_RECORDS),
    truncated: list.length > MAX_LOG_RECORDS
  }
}

async function readAuditLogs() {
  try {
    return await readAuditLogsByMode(true)
  } catch (indexError) {
    console.warn({
      function: "auditLogList",
      stage: "indexFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    return readAuditLogsByMode(false)
  }
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

    const logRecords = await readAuditLogs()
    const rawList = logRecords.list

    const list = rawList
      .map((item) => ({
        id: normalizeText(item._id, 128),
        action: normalizeText(item.action, 80),
        openid: normalizeText(item.openid, 128),
        targetOpenid: normalizeText(item.targetOpenid, 128),
        vehicleId: normalizeText(item.vehicleId, 128),
        brandModel: normalizeText(item.brandModel, 100),
        bookingId: normalizeText(item.bookingId, 128),
        requestId: normalizeText(item.requestId, 128),
        requestType: normalizeText(item.requestType, 50),
        imageAction: normalizeText(item.imageAction, 50),
        tokenProtected: item.tokenProtected === true,
        toPermissions: normalizeTextArray(item.toPermissions, 20, 50),
        cutoffDate: normalizeText(item.cutoffDate, 50),
        retentionDays: Number(item.retentionDays) || 0,
        processed: Number(item.processed) || 0,
        deleted: Number(item.deleted) || 0,
        failed: Number(item.failed) || 0,
        bookingCount: Number(item.bookingCount) || 0,
        favoriteCount: Number(item.favoriteCount) || 0,
        privacyRequestCount: Number(item.privacyRequestCount) || 0,
        partial: item.partial === true,
        logType: normalizeText(item.logType, 50),
        filter: normalizeText(item.filter, 80),
        total: Number(item.total) || 0,
        matchedTotal: Number(item.matchedTotal) || 0,
        sourceTruncated: item.sourceTruncated === true,
        truncated: item.truncated === true,
        fromStatus: normalizeText(item.fromStatus, 50),
        toStatus: normalizeText(item.toStatus, 50),
        status: normalizeText(item.status, 50),
        schedulePriority: normalizeText(item.schedulePriority, 50),
        coordinationStatus: normalizeText(item.coordinationStatus, 50),
        fromPriority: normalizeText(item.fromPriority, 50),
        toPriority: normalizeText(item.toPriority, 50),
        fromCoordinationStatus: normalizeText(item.fromCoordinationStatus, 50),
        toCoordinationStatus: normalizeText(item.toCoordinationStatus, 50),
        remarkLength: Math.max(0, Math.floor(normalizeNumber(item.remarkLength, 0))),
        changedKeys: normalizeTextArray(item.changedKeys, 50, 80),
        createdAt: formatTime(item.createdAt)
      }))
      .filter((item) => {
        if (input.action && item.action !== input.action) {
          return false
        }
        if (input.keyword && !toSearchText(item).includes(input.keyword)) {
          return false
        }
        return true
      })
      .sort((prev, next) => new Date(next.createdAt || 0).getTime() - new Date(prev.createdAt || 0).getTime())

    const offset = input.page * input.pageSize
    const paged = list.slice(offset, offset + input.pageSize)

    return {
      ok: true,
      page: input.page,
      pageSize: input.pageSize,
      total: list.length,
      truncated: logRecords.truncated,
      hasMore: Boolean(offset + input.pageSize < list.length),
      list: paged
    }
  } catch (error) {
    console.error({
      function: "auditLogList",
      authenticated: Boolean(openid),
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "查询审计日志失败，请稍后重试"
    }
  }
}
