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
const BATCH_SIZE = 100
const MAX_RECORDS = 200
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/
const MODES = new Set(["inventory", "export"])
const REQUEST_HEADER_FIELDS = {
  _id: true,
  openid: true,
  type: true,
  status: true,
  description: true,
  createdAt: true
}
const INVENTORY_FIELDS = {
  bookings: {
    _id: true,
    vehicleId: true,
    vehicleName: true,
    userName: true,
    phone: true,
    city: true,
    note: true,
    startDate: true,
    endDate: true,
    status: true,
    createdAt: true,
    updatedAt: true
  },
  booking_quotes: {
    _id: true,
    bookingId: true,
    vehicleId: true,
    vehicleName: true,
    startDate: true,
    endDate: true,
    rentalDays: true,
    totalCents: true,
    depositText: true,
    validUntil: true,
    customerNote: true,
    adjustmentNote: true,
    version: true,
    status: true,
    createdAt: true,
    updatedAt: true
  },
  favorites: {
    _id: true,
    vehicleId: true,
    createdAt: true,
    updatedAt: true
  },
  privacy_requests: {
    _id: true,
    type: true,
    status: true,
    description: true,
    resolutionNote: true,
    createdAt: true,
    updatedAt: true
  }
}
const CSV_HEADERS = [
  "数据类别",
  "用户OpenID",
  "记录ID",
  "车辆ID",
  "车辆名称",
  "姓名",
  "手机号",
  "城市",
  "备注",
  "开始日期",
  "结束日期",
  "业务状态",
  "申请类型",
  "申请说明",
  "处理反馈",
  "创建时间",
  "更新时间"
]

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
  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some(hasAdminRole)
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

function trimText(value, maxLength) {
  return String(value == null ? "" : value).trim().slice(0, maxLength)
}

function limitText(value, maxLength) {
  return String(value == null ? "" : value).slice(0, maxLength)
}

function protectSpreadsheetFormula(value) {
  const text = String(value == null ? "" : value)
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text
}

function escapeCsvCell(value) {
  const protectedValue = protectSpreadsheetFormula(value)
  return `"${protectedValue.replace(/"/g, '""')}"`
}

function buildCsvText(subjectOpenid, categories) {
  const rows = []
  const safeOpenid = trimText(subjectOpenid, 128)
  categories.bookings.list.forEach((item) => {
    rows.push([
      "预约记录",
      safeOpenid,
      trimText(item.id, 128),
      trimText(item.vehicleId, 128),
      limitText(item.vehicleName, 100),
      limitText(item.userName, 100),
      trimText(item.phone, 30),
      limitText(item.city, 50),
      limitText(item.note, 500),
      trimText(item.startDate, 30),
      trimText(item.endDate, 30),
      trimText(item.status, 50),
      "",
      "",
      "",
      trimText(item.createdAt, 50),
      trimText(item.updatedAt, 50)
    ])
  })
  categories.quotes.list.forEach((item) => {
    rows.push([
      "报价记录",
      safeOpenid,
      trimText(item.id, 128),
      trimText(item.vehicleId, 128),
      limitText(item.vehicleName, 100),
      "",
      "",
      "",
      limitText([item.customerNote, item.adjustmentNote].filter(Boolean).join("；调整说明："), 500),
      trimText(item.startDate, 30),
      trimText(item.endDate, 30),
      trimText(`${item.status} / v${item.version}`, 50),
      "",
      limitText(item.depositText, 500),
      `预估总额：${Number(item.totalCents || 0) / 100} 元；有效至：${trimText(item.validUntil, 30)}`,
      trimText(item.createdAt, 50),
      trimText(item.updatedAt, 50)
    ])
  })
  categories.favorites.list.forEach((item) => {
    rows.push([
      "收藏记录",
      safeOpenid,
      trimText(item.id, 128),
      trimText(item.vehicleId, 128),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "已收藏",
      "",
      "",
      "",
      trimText(item.createdAt, 50),
      trimText(item.updatedAt, 50)
    ])
  })
  categories.privacyRequests.list.forEach((item) => {
    rows.push([
      "隐私申请",
      safeOpenid,
      trimText(item.id, 128),
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      "",
      trimText(item.status, 50),
      trimText(item.type, 50),
      limitText(item.description, 500),
      limitText(item.resolutionNote, 500),
      trimText(item.createdAt, 50),
      trimText(item.updatedAt, 50)
    ])
  })
  rows.push([
    "匿名分析说明",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "匿名分析事件不保存 OpenID、姓名、手机号、城市或备注，因此无法关联到具体用户。",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    ""
  ])

  return `\ufeff${[CSV_HEADERS, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\r\n")}`
}

function buildExportFileName(requestId) {
  const now = new Date()
  const pad = (value) => String(value).padStart(2, "0")
  const dateText = `${now.getUTCFullYear()}${pad(now.getUTCMonth() + 1)}${pad(
    now.getUTCDate()
  )}-${pad(now.getUTCHours())}${pad(now.getUTCMinutes())}`
  return `privacy-data-${requestId}-${dateText}.csv`
}

function sortByCreatedAtDesc(list) {
  return list.sort(
    (prev, next) =>
      new Date(formatTime(next && next.createdAt) || 0).getTime() -
      new Date(formatTime(prev && prev.createdAt) || 0).getTime()
  )
}

async function readByOpenid(collectionName, openid) {
  const records = []
  try {
    for (let offset = 0; offset <= MAX_RECORDS; offset += BATCH_SIZE) {
      const remaining = MAX_RECORDS + 1 - records.length
      const limit = Math.min(BATCH_SIZE, remaining)
      const res = await db
        .collection(collectionName)
        .where({ openid })
        .field(INVENTORY_FIELDS[collectionName])
        .skip(offset)
        .limit(limit)
        .get()
      const batch = res && Array.isArray(res.data) ? res.data : []
      records.push(...batch)
      if (batch.length < limit || records.length > MAX_RECORDS) {
        break
      }
    }
    return {
      available: true,
      list: sortByCreatedAtDesc(records.slice(0, MAX_RECORDS)),
      truncated: records.length > MAX_RECORDS
    }
  } catch (error) {
    console.warn({
      function: "privacyRequestDataInventory",
      stage: "readCategory",
      category: collectionName,
      errorMessage:
        error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return {
      available: false,
      list: [],
      truncated: false
    }
  }
}

async function readQuotesByBookingIds(bookingIds) {
  const records = []
  try {
    const ids = Array.from(
      new Set(
        (Array.isArray(bookingIds) ? bookingIds : [])
          .map((item) => String(item || "").trim())
          .filter(Boolean)
      )
    )
    for (let index = 0; index < ids.length && records.length <= MAX_RECORDS; index += 1) {
      const remaining = MAX_RECORDS + 1 - records.length
      const res = await db
        .collection("booking_quotes")
        .where({ bookingId: ids[index] })
        .field(INVENTORY_FIELDS.booking_quotes)
        .limit(remaining)
        .get()
      const list = res && Array.isArray(res.data) ? res.data : []
      records.push(...list)
    }
    return {
      available: true,
      list: sortByCreatedAtDesc(records.slice(0, MAX_RECORDS)),
      truncated: records.length > MAX_RECORDS
    }
  } catch (error) {
    console.warn({
      function: "privacyRequestDataInventory",
      stage: "readCategory",
      category: "booking_quotes",
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return { available: false, list: [], truncated: false }
  }
}

function normalizeBooking(item) {
  return {
    id: trimText(item && item._id, 128),
    vehicleId: trimText(item && item.vehicleId, 128),
    vehicleName: limitText(item && item.vehicleName, 100),
    userName: limitText(item && item.userName, 100),
    phone: trimText(item && item.phone, 30),
    city: limitText(item && item.city, 50),
    note: limitText(item && item.note, 500),
    startDate: trimText(item && item.startDate, 30),
    endDate: trimText(item && item.endDate, 30),
    status: trimText(item && item.status, 50),
    createdAt: formatTime(item && item.createdAt),
    updatedAt: formatTime(item && item.updatedAt)
  }
}

function normalizeFavorite(item) {
  return {
    id: trimText(item && item._id, 128),
    vehicleId: trimText(item && item.vehicleId, 128),
    createdAt: formatTime(item && item.createdAt),
    updatedAt: formatTime(item && item.updatedAt)
  }
}

function normalizeQuote(item) {
  return {
    id: trimText(item && item._id, 128),
    bookingId: trimText(item && item.bookingId, 128),
    vehicleId: trimText(item && item.vehicleId, 128),
    vehicleName: limitText(item && item.vehicleName, 100),
    startDate: trimText(item && item.startDate, 30),
    endDate: trimText(item && item.endDate, 30),
    rentalDays: Math.max(0, Number((item && item.rentalDays) || 0)),
    totalCents: Math.max(0, Number((item && item.totalCents) || 0)),
    depositText: limitText(item && item.depositText, 500),
    validUntil: trimText(item && item.validUntil, 30),
    customerNote: limitText(item && item.customerNote, 500),
    adjustmentNote: limitText(item && item.adjustmentNote, 500),
    version: Math.max(0, Number((item && item.version) || 0)),
    status: trimText(item && item.status, 50),
    createdAt: formatTime(item && item.createdAt),
    updatedAt: formatTime(item && item.updatedAt)
  }
}

function normalizePrivacyRequest(item) {
  return {
    id: trimText(item && item._id, 128),
    type: trimText(item && item.type, 50),
    status: trimText(item && item.status, 50),
    description: limitText(item && item.description, 500),
    resolutionNote: limitText(item && item.resolutionNote, 500),
    createdAt: formatTime(item && item.createdAt),
    updatedAt: formatTime(item && item.updatedAt)
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
    const message =
      error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "privacyRequestDataInventory",
      stage: "auditLog",
      errorMessage: message,
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const adminOpenid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = event && typeof event === "object" ? event : {}
  const requestId = String(input.requestId || "").trim()
  const mode = String(input.mode || "inventory").trim()

  try {
    if (!(await isAdminOpenid(adminOpenid))) {
      return createError("FORBIDDEN", "权限不足")
    }
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      return createError("VALIDATION_ERROR", "申请 ID 格式不正确")
    }
    if (!MODES.has(mode)) {
      return createError("VALIDATION_ERROR", "操作模式不正确")
    }

    let request = null
    try {
      const requestRes = await db
        .collection("privacy_requests")
        .doc(requestId)
        .field(REQUEST_HEADER_FIELDS)
        .get()
      request = requestRes && requestRes.data ? requestRes.data : null
    } catch (error) {
      request = null
    }
    if (!request) {
      return createError("NOT_FOUND", "隐私申请不存在")
    }
    if (mode === "export" && String(request.type || "") !== "access") {
      return createError("REQUEST_TYPE_NOT_EXPORTABLE", "仅查询信息申请可导出个人数据")
    }

    const subjectOpenid = String(request.openid || "").trim()
    if (!subjectOpenid) {
      return createError("INVALID_REQUEST_DATA", "该申请缺少用户身份，无法核验")
    }

    const [bookingsResult, favoritesResult, requestsResult] = await Promise.all([
      readByOpenid("bookings", subjectOpenid),
      readByOpenid("favorites", subjectOpenid),
      readByOpenid("privacy_requests", subjectOpenid)
    ])
    const quotesResult = await readQuotesByBookingIds(
      bookingsResult.list.map((item) => item && item._id)
    )
    const unavailable = []
    if (!bookingsResult.available) {
      unavailable.push("bookings")
    }
    if (!favoritesResult.available) {
      unavailable.push("favorites")
    }
    if (!quotesResult.available) {
      unavailable.push("quotes")
    }
    if (!requestsResult.available) {
      unavailable.push("privacyRequests")
    }
    const truncated = []
    if (bookingsResult.truncated) {
      truncated.push("bookings")
    }
    if (favoritesResult.truncated) {
      truncated.push("favorites")
    }
    if (quotesResult.truncated) {
      truncated.push("quotes")
    }
    if (requestsResult.truncated) {
      truncated.push("privacyRequests")
    }
    const partial = unavailable.length > 0 || truncated.length > 0
    const categories = {
      bookings: {
        count: bookingsResult.list.length,
        truncated: bookingsResult.truncated,
        list: bookingsResult.list.map(normalizeBooking)
      },
      quotes: {
        count: quotesResult.list.length,
        truncated: quotesResult.truncated,
        list: quotesResult.list.map(normalizeQuote)
      },
      favorites: {
        count: favoritesResult.list.length,
        truncated: favoritesResult.truncated,
        list: favoritesResult.list.map(normalizeFavorite)
      },
      privacyRequests: {
        count: requestsResult.list.length,
        truncated: requestsResult.truncated,
        list: requestsResult.list.map(normalizePrivacyRequest)
      }
    }

    if (mode === "export") {
      if (partial) {
        return createError("INVENTORY_INCOMPLETE", "相关数据不完整，暂不能导出")
      }
      const csvText = buildCsvText(subjectOpenid, categories)
      const fileName = buildExportFileName(requestId)
      const exportedAt = db.serverDate()
      const exportStateRes = await db.collection("privacy_requests").doc(requestId).update({
        data: {
          dataExportedAt: exportedAt,
          dataExportedBy: adminOpenid,
          updatedAt: exportedAt
        }
      })
      const exportStateUpdated =
        Number(exportStateRes && exportStateRes.stats && exportStateRes.stats.updated) || 0
      if (exportStateUpdated < 1) {
        return createError("EXPORT_STATE_CONFLICT", "申请状态已发生变化，请刷新后重试")
      }
      await writeAuditLogBestEffort({
        openid: adminOpenid,
        action: "privacyRequestDataExportCsv",
        requestId,
        requestType: String(request.type || ""),
        bookingCount: categories.bookings.count,
        quoteCount: categories.quotes.count,
        favoriteCount: categories.favorites.count,
        privacyRequestCount: categories.privacyRequests.count,
        partial: false
      })
      return {
        ok: true,
        fileName,
        csvText,
        bookingCount: categories.bookings.count,
        quoteCount: categories.quotes.count,
        favoriteCount: categories.favorites.count,
        privacyRequestCount: categories.privacyRequests.count
      }
    }

    await writeAuditLogBestEffort({
      openid: adminOpenid,
      action: "privacyRequestDataInventory",
      requestId,
      requestType: String(request.type || ""),
      bookingCount: bookingsResult.list.length,
      quoteCount: quotesResult.list.length,
      favoriteCount: favoritesResult.list.length,
      privacyRequestCount: requestsResult.list.length,
      partial
    })

    return {
      ok: true,
      partial,
      unavailable,
      truncated,
      maxRecordsPerCategory: MAX_RECORDS,
      request: {
        id: requestId,
        type: String(request.type || ""),
        status: String(request.status || ""),
        description: String(request.description || ""),
        openid: subjectOpenid,
        createdAt: formatTime(request.createdAt)
      },
      categories
    }
  } catch (error) {
    console.error({
      function: "privacyRequestDataInventory",
      authenticated: Boolean(adminOpenid),
      requestId,
      errorMessage:
        error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "相关数据核验失败，请稍后重试")
  }
}
