const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const DEFAULT_PAGE_SIZE = 20
const MAX_PAGE_SIZE = 50
const FALLBACK_MAX_RECORDS = 500

function normalizeNumber(value, fallback) {
  const num = Number(value)
  return Number.isFinite(num) ? num : fallback
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  const pageRaw = normalizeNumber(payload.page, 0)
  const pageSizeRaw = normalizeNumber(payload.pageSize, DEFAULT_PAGE_SIZE)
  return {
    page: pageRaw > 0 ? Math.floor(pageRaw) : 0,
    pageSize: Math.min(Math.max(Math.floor(pageSizeRaw), 1), MAX_PAGE_SIZE)
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

function sortByCreatedAt(list) {
  return list.slice().sort((prev, next) => {
    return new Date(formatTime(next.createdAt) || 0).getTime() - new Date(formatTime(prev.createdAt) || 0).getTime()
  })
}

async function queryWithIndex(openid, page, pageSize) {
  const res = await db
    .collection("privacy_requests")
    .where({ openid })
    .orderBy("createdAt", "desc")
    .skip(page * pageSize)
    .limit(pageSize + 1)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return {
    list: list.slice(0, pageSize),
    hasMore: list.length > pageSize,
    truncated: false
  }
}

async function queryWithoutIndex(openid, page, pageSize) {
  const res = await db
    .collection("privacy_requests")
    .where({ openid })
    .limit(FALLBACK_MAX_RECORDS + 1)
    .get()
  const rawList = res && Array.isArray(res.data) ? res.data : []
  const truncated = rawList.length > FALLBACK_MAX_RECORDS
  const list = sortByCreatedAt(rawList.slice(0, FALLBACK_MAX_RECORDS))
  const start = page * pageSize
  return {
    list: list.slice(start, start + pageSize),
    hasMore: start + pageSize < list.length || truncated,
    truncated
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    if (!openid) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "未获取到用户身份"
      }
    }

    let result = null
    try {
      result = await queryWithIndex(openid, input.page, input.pageSize)
    } catch (indexError) {
      console.warn({
        function: "privacyRequestMyList",
        stage: "indexFallback",
        errorMessage:
          indexError && (indexError.message || indexError.errMsg)
            ? indexError.message || indexError.errMsg
            : String(indexError),
        createdAt: new Date().toISOString()
      })
      result = await queryWithoutIndex(openid, input.page, input.pageSize)
    }

    return {
      ok: true,
      page: input.page,
      pageSize: input.pageSize,
      hasMore: result.hasMore,
      truncated: result.truncated,
      list: result.list.map((item) => ({
        id: item._id || "",
        type: String(item.type || ""),
        description: String(item.description || ""),
        status: String(item.status || "pending"),
        resolutionNote: String(item.resolutionNote || ""),
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      }))
    }
  } catch (error) {
    console.error({
      function: "privacyRequestMyList",
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
