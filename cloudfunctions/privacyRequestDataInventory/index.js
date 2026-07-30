const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const BATCH_SIZE = 100
const MAX_RECORDS = 200
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

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

function normalizeBooking(item) {
  return {
    id: String((item && item._id) || ""),
    vehicleId: String((item && item.vehicleId) || ""),
    vehicleName: String((item && item.vehicleName) || ""),
    userName: String((item && item.userName) || ""),
    phone: String((item && item.phone) || ""),
    city: String((item && item.city) || ""),
    note: String((item && item.note) || ""),
    startDate: String((item && item.startDate) || ""),
    endDate: String((item && item.endDate) || ""),
    status: String((item && item.status) || ""),
    createdAt: formatTime(item && item.createdAt),
    updatedAt: formatTime(item && item.updatedAt)
  }
}

function normalizeFavorite(item) {
  return {
    id: String((item && item._id) || ""),
    vehicleId: String((item && item.vehicleId) || ""),
    createdAt: formatTime(item && item.createdAt),
    updatedAt: formatTime(item && item.updatedAt)
  }
}

function normalizePrivacyRequest(item) {
  return {
    id: String((item && item._id) || ""),
    type: String((item && item.type) || ""),
    status: String((item && item.status) || ""),
    description: String((item && item.description) || ""),
    resolutionNote: String((item && item.resolutionNote) || ""),
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

  try {
    if (!(await isAdminOpenid(adminOpenid))) {
      return createError("FORBIDDEN", "权限不足")
    }
    if (!REQUEST_ID_PATTERN.test(requestId)) {
      return createError("VALIDATION_ERROR", "申请 ID 格式不正确")
    }

    let request = null
    try {
      const requestRes = await db.collection("privacy_requests").doc(requestId).get()
      request = requestRes && requestRes.data ? requestRes.data : null
    } catch (error) {
      request = null
    }
    if (!request) {
      return createError("NOT_FOUND", "隐私申请不存在")
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
    const unavailable = []
    if (!bookingsResult.available) {
      unavailable.push("bookings")
    }
    if (!favoritesResult.available) {
      unavailable.push("favorites")
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
    if (requestsResult.truncated) {
      truncated.push("privacyRequests")
    }
    const partial = unavailable.length > 0 || truncated.length > 0

    await writeAuditLogBestEffort({
      openid: adminOpenid,
      action: "privacyRequestDataInventory",
      requestId,
      requestType: String(request.type || ""),
      bookingCount: bookingsResult.list.length,
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
      categories: {
        bookings: {
          count: bookingsResult.list.length,
          truncated: bookingsResult.truncated,
          list: bookingsResult.list.map(normalizeBooking)
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
    }
  } catch (error) {
    console.error({
      function: "privacyRequestDataInventory",
      adminOpenid,
      requestId,
      errorMessage:
        error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "相关数据核验失败，请稍后重试")
  }
}
