const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const BATCH_SIZE = 100
const MAX_RECORDS = 2000
const REQUEST_TYPES = ["access", "correction", "deletion"]
const REQUEST_STATUSES = ["pending", "processing", "completed", "rejected", "cancelled"]

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
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  const pageRaw = Number(payload.page)
  const pageSizeRaw = Number(payload.pageSize)
  const type = normalizeText(payload.type, 20)
  const status = normalizeText(payload.status, 20)
  return {
    page: Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0,
    pageSize:
      Number.isFinite(pageSizeRaw)
        ? Math.min(Math.max(Math.floor(pageSizeRaw), 1), MAX_PAGE_SIZE)
        : DEFAULT_PAGE_SIZE,
    type: REQUEST_TYPES.includes(type) ? type : "",
    status: REQUEST_STATUSES.includes(status) ? status : "",
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

async function readAllByMode(ordered) {
  const list = []
  for (let offset = 0; offset <= MAX_RECORDS; offset += BATCH_SIZE) {
    const remaining = MAX_RECORDS + 1 - list.length
    const limit = Math.min(BATCH_SIZE, remaining)
    let query = db.collection("privacy_requests")
    if (ordered) {
      query = query.orderBy("createdAt", "desc")
    }
    const res = await query.skip(offset).limit(limit).get()
    const batch = res && Array.isArray(res.data) ? res.data : []
    list.push(...batch)
    if (batch.length < limit || list.length > MAX_RECORDS) {
      break
    }
  }
  return {
    list: list.slice(0, MAX_RECORDS),
    truncated: list.length > MAX_RECORDS
  }
}

async function readAll() {
  try {
    return await readAllByMode(true)
  } catch (indexError) {
    console.warn({
      function: "privacyRequestList",
      stage: "indexFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    return readAllByMode(false)
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    if (!(await isAdminOpenid(openid))) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "权限不足"
      }
    }

    const records = await readAll()
    const list = records.list
      .map((item) => ({
        id: item._id || "",
        openid: String(item.openid || ""),
        type: String(item.type || ""),
        description: String(item.description || ""),
        status: String(item.status || "pending"),
        resolutionNote: String(item.resolutionNote || ""),
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      }))
      .filter((item) => {
        if (input.type && item.type !== input.type) {
          return false
        }
        if (input.status && item.status !== input.status) {
          return false
        }
        if (input.keyword && !`${item.id} ${item.openid}`.toUpperCase().includes(input.keyword)) {
          return false
        }
        return true
      })
      .sort((prev, next) => new Date(next.createdAt || 0).getTime() - new Date(prev.createdAt || 0).getTime())

    const offset = input.page * input.pageSize
    return {
      ok: true,
      page: input.page,
      pageSize: input.pageSize,
      total: list.length,
      truncated: records.truncated,
      hasMore: offset + input.pageSize < list.length,
      list: list.slice(offset, offset + input.pageSize)
    }
  } catch (error) {
    console.error({
      function: "privacyRequestList",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "隐私申请加载失败，请稍后重试"
    }
  }
}
