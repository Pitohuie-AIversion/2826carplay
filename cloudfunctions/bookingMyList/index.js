const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const FALLBACK_BATCH_SIZE = 100
const FALLBACK_MAX_RECORDS = 1000
const BOOKING_MY_LIST_FIELDS = {
  _id: true,
  vehicleId: true,
  vehicleName: true,
  userName: true,
  phone: true,
  startDate: true,
  endDate: true,
  city: true,
  note: true,
  status: true,
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

function normalizePageSize(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return 20
  }

  const intValue = Math.floor(num)
  if (intValue < 1) {
    return 1
  }

  if (intValue > 50) {
    return 50
  }

  return intValue
}

function buildVehicleDisplayIdentity(value) {
  const vehicleName = String(value || "").trim()
  const normalized = vehicleName.toUpperCase()
  const isPlateNumber = /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-HJ-NP-Z0-9]{5,6}$/.test(normalized)
  return isPlateNumber
    ? { vehicleName: "预约车辆", vehicleReference: `车牌尾号 ${normalized.slice(-2)}` }
    : { vehicleName: vehicleName || "预约车辆", vehicleReference: "" }
}

function toTimestamp(value) {
  if (!value) {
    return 0
  }

  if (value instanceof Date) {
    return value.getTime()
  }

  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().getTime()
  }

  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : 0
}

function sortBookingsByCreatedAt(list) {
  return list.slice().sort((left, right) => {
    const timeDiff = toTimestamp(right && right.createdAt) - toTimestamp(left && left.createdAt)
    if (timeDiff !== 0) {
      return timeDiff
    }

    return String((right && right._id) || "").localeCompare(String((left && left._id) || ""))
  })
}

async function queryWithConfiguredIndex(openid, page, pageSize) {
  const res = await db
    .collection("bookings")
    .where({ openid })
    .field(BOOKING_MY_LIST_FIELDS)
    .orderBy("createdAt", "desc")
    .skip(page * pageSize)
    .limit(pageSize + 1)
    .get()

  const rawList = res && Array.isArray(res.data) ? res.data : []
  return {
    rawList,
    hasMore: rawList.length > pageSize
  }
}

async function queryWithoutCompositeIndex(openid, page, pageSize) {
  const collected = []

  for (let offset = 0; offset <= FALLBACK_MAX_RECORDS; offset += FALLBACK_BATCH_SIZE) {
    const remaining = FALLBACK_MAX_RECORDS + 1 - collected.length
    const batchSize = Math.min(FALLBACK_BATCH_SIZE, remaining)
    const res = await db
      .collection("bookings")
      .where({ openid })
      .field(BOOKING_MY_LIST_FIELDS)
      .skip(offset)
      .limit(batchSize)
      .get()
    const batch = res && Array.isArray(res.data) ? res.data : []

    collected.push(...batch)
    if (batch.length < batchSize || collected.length > FALLBACK_MAX_RECORDS) {
      break
    }
  }

  const truncated = collected.length > FALLBACK_MAX_RECORDS
  const sorted = sortBookingsByCreatedAt(collected.slice(0, FALLBACK_MAX_RECORDS))
  const start = page * pageSize
  const end = start + pageSize

  return {
    rawList: sorted.slice(start, end),
    hasMore: end < sorted.length || (truncated && end <= FALLBACK_MAX_RECORDS)
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const pageSize = normalizePageSize((event && event.pageSize) || (event && event.limit))
  const pageRaw = Number(event && event.page)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0

  try {
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }

    let queryResult = null
    try {
      queryResult = await queryWithConfiguredIndex(openid, page, pageSize)
    } catch (indexError) {
      console.warn({
        function: "bookingMyList",
        stage: "indexFallback",
        errorMessage:
          indexError && (indexError.message || indexError.errMsg)
            ? indexError.message || indexError.errMsg
            : String(indexError),
        createdAt: new Date().toISOString()
      })
      queryResult = await queryWithoutCompositeIndex(openid, page, pageSize)
    }

    const rawList = queryResult.rawList
    const hasMore = queryResult.hasMore
    const list = rawList.length > pageSize ? rawList.slice(0, pageSize) : rawList

    return {
      ok: true,
      page,
      pageSize,
      hasMore,
      list: list.map((item) => {
        const vehicleIdentity = buildVehicleDisplayIdentity(item.vehicleName)
        return {
          id: item._id,
          vehicleId: item.vehicleId,
          ...vehicleIdentity,
          userName: item.userName || "",
          phone: item.phone || "",
          startDate: item.startDate || "",
          endDate: item.endDate || "",
          city: item.city || "",
          note: item.note || "",
          status: item.status || "pending",
          createdAt: item.createdAt,
          updatedAt: item.updatedAt
        }
      })
    }
  } catch (error) {
    console.error({
      function: "bookingMyList",
      authenticated: Boolean(openid),
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询预约失败，请稍后重试")
  }
}
