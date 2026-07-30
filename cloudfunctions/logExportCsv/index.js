const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const BATCH_SIZE = 100
const MAX_SCAN_RECORDS = 2000
const MAX_EXPORT_RECORDS = 500

function createError(code, message) {
  return {
    ok: false,
    code: String(code || "VALIDATION_ERROR"),
    message: String(message || "参数校验失败")
  }
}

function hasAdminRole(record) {
  return Boolean(
    record &&
      (record.role === "admin" ||
        (Array.isArray(record.roles) && record.roles.includes("admin")) ||
        record.isAdmin === true ||
        record.admin === true)
  )
}

async function isAdminOpenid(openid) {
  if (!openid) {
    return false
  }
  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some(hasAdminRole)
}

function normalizeText(value, maxLength) {
  const text = String(value || "").trim()
  return maxLength && text.length > maxLength ? text.slice(0, maxLength) : text
}

function normalizeInput(event) {
  const payload = event && typeof event === "object" ? event : {}
  const limitNumber = Number(payload.limit)
  return {
    logType: normalizeText(payload.logType, 20),
    filter: normalizeText(payload.filter, 80),
    keyword: normalizeText(payload.keyword, 80).toUpperCase(),
    limit: Number.isFinite(limitNumber)
      ? Math.min(Math.max(Math.floor(limitNumber), 1), MAX_EXPORT_RECORDS)
      : MAX_EXPORT_RECORDS
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

async function readLogsByMode(collectionName, ordered) {
  const list = []
  for (let offset = 0; offset <= MAX_SCAN_RECORDS; offset += BATCH_SIZE) {
    const remaining = MAX_SCAN_RECORDS + 1 - list.length
    const limit = Math.min(BATCH_SIZE, remaining)
    let query = db.collection(collectionName)
    if (ordered) {
      query = query.orderBy("createdAt", "desc")
    }
    const res = await query.skip(offset).limit(limit).get()
    const batch = res && Array.isArray(res.data) ? res.data : []
    list.push(...batch)
    if (batch.length < limit || list.length > MAX_SCAN_RECORDS) {
      break
    }
  }
  return {
    list: list.slice(0, MAX_SCAN_RECORDS),
    truncated: list.length > MAX_SCAN_RECORDS
  }
}

async function readLogs(collectionName) {
  try {
    return await readLogsByMode(collectionName, true)
  } catch (indexError) {
    console.warn({
      function: "logExportCsv",
      stage: "indexFallback",
      collection: collectionName,
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    return readLogsByMode(collectionName, false)
  }
}

function normalizeAuditLog(item) {
  return {
    action: String((item && item.action) || "").trim(),
    openid: String((item && item.openid) || "").trim(),
    targetOpenid: String((item && item.targetOpenid) || "").trim(),
    vehicleId: String((item && item.vehicleId) || "").trim(),
    bookingId: String((item && item.bookingId) || "").trim(),
    requestId: String((item && item.requestId) || "").trim(),
    requestType: String((item && item.requestType) || "").trim(),
    fromStatus: String((item && item.fromStatus) || "").trim(),
    toStatus: String((item && item.toStatus) || "").trim(),
    changedKeys: Array.isArray(item && item.changedKeys)
      ? item.changedKeys.map((value) => String(value || "").trim()).filter(Boolean)
      : [],
    createdAt: formatTime(item && item.createdAt)
  }
}

function normalizeErrorLog(item) {
  return {
    function: String((item && item.function) || "").trim(),
    stage: String((item && item.stage) || "").trim(),
    openid: String((item && item.openid) || "").trim(),
    targetOpenid: String((item && item.targetOpenid) || "").trim(),
    vehicleId: String((item && item.vehicleId) || "").trim(),
    bookingId: String((item && item.bookingId) || "").trim(),
    targetStatus: String((item && item.targetStatus) || "").trim(),
    errorCode: String((item && item.errorCode) || "").trim(),
    errorMessage: String((item && item.errorMessage) || "").trim(),
    occurredAt: formatTime(item && item.occurredAt),
    createdAt: formatTime(item && item.createdAt)
  }
}

function auditSearchText(item) {
  return [
    item.action,
    item.openid,
    item.targetOpenid,
    item.vehicleId,
    item.bookingId,
    item.requestId,
    item.requestType,
    item.fromStatus,
    item.toStatus,
    item.changedKeys.join(",")
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase()
}

function errorSearchText(item) {
  return [
    item.function,
    item.stage,
    item.openid,
    item.targetOpenid,
    item.vehicleId,
    item.bookingId,
    item.targetStatus,
    item.errorCode,
    item.errorMessage,
    item.occurredAt
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase()
}

function protectSpreadsheetText(value) {
  const text = String(value === undefined || value === null ? "" : value)
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text
}

function escapeCsvCell(value) {
  return `"${protectSpreadsheetText(value).replace(/"/g, '""')}"`
}

function buildCsv(headers, rows) {
  return `\uFEFF${[headers].concat(rows).map((row) => row.map(escapeCsvCell).join(",")).join("\r\n")}`
}

function formatFileDate(date) {
  const pad = (number) => String(number).padStart(2, "0")
  return `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(
    date.getHours()
  )}${pad(date.getMinutes())}`
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
    const message =
      error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "logExportCsv",
      stage: "auditLog",
      errorMessage: message,
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeInput(event)

  try {
    if (!(await isAdminOpenid(openid))) {
      return createError("FORBIDDEN", "权限不足")
    }
    if (!["audit", "error"].includes(input.logType)) {
      return createError("VALIDATION_ERROR", "日志类型不正确")
    }

    const isAudit = input.logType === "audit"
    const source = await readLogs(isAudit ? "audit_logs" : "error_logs")
    const normalized = source.list.map(isAudit ? normalizeAuditLog : normalizeErrorLog)
    const filtered = normalized
      .filter((item) => {
        const primary = isAudit ? item.action : item.function
        if (input.filter && primary !== input.filter) {
          return false
        }
        if (input.keyword) {
          const searchText = isAudit ? auditSearchText(item) : errorSearchText(item)
          if (!searchText.includes(input.keyword)) {
            return false
          }
        }
        return true
      })
      .sort((prev, next) => {
        const prevTime = new Date(prev.createdAt || prev.occurredAt || 0).getTime()
        const nextTime = new Date(next.createdAt || next.occurredAt || 0).getTime()
        return nextTime - prevTime
      })
    const exported = filtered.slice(0, input.limit)
    const headers = isAudit
      ? [
          "时间",
          "操作",
          "操作者OpenID",
          "目标OpenID",
          "车辆ID",
          "预约ID",
          "隐私申请ID",
          "申请类型",
          "原状态",
          "目标状态",
          "变更字段"
        ]
      : [
          "时间",
          "云函数",
          "阶段",
          "操作者OpenID",
          "目标OpenID",
          "车辆ID",
          "预约ID",
          "目标状态",
          "错误码",
          "错误信息"
        ]
    const rows = exported.map((item) =>
      isAudit
        ? [
            item.createdAt,
            item.action,
            item.openid,
            item.targetOpenid,
            item.vehicleId,
            item.bookingId,
            item.requestId,
            item.requestType,
            item.fromStatus,
            item.toStatus,
            item.changedKeys.join("|")
          ]
        : [
            item.createdAt || item.occurredAt,
            item.function,
            item.stage,
            item.openid,
            item.targetOpenid,
            item.vehicleId,
            item.bookingId,
            item.targetStatus,
            item.errorCode,
            item.errorMessage
          ]
    )
    const truncated = source.truncated || filtered.length > exported.length

    await writeAuditLogBestEffort({
      openid,
      action: "logExportCsv",
      logType: input.logType,
      filter: input.filter,
      total: exported.length,
      matchedTotal: filtered.length,
      sourceTruncated: source.truncated,
      truncated
    })

    return {
      ok: true,
      logType: input.logType,
      total: exported.length,
      matchedTotal: filtered.length,
      sourceTruncated: source.truncated,
      truncated,
      fileName: `${input.logType === "audit" ? "audit-logs" : "error-logs"}-${formatFileDate(
        new Date()
      )}.csv`,
      csvText: buildCsv(headers, rows)
    }
  } catch (error) {
    console.error({
      function: "logExportCsv",
      openid,
      logType: input.logType,
      errorMessage:
        error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "日志导出失败，请稍后重试")
  }
}
