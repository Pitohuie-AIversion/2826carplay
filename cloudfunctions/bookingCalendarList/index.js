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
const BOOKING_CALENDAR_FIELDS = {
  _id: true,
  vehicleId: true,
  vehicleName: true,
  startDate: true,
  endDate: true,
  status: true
}
const BOOKING_BATCH_SIZE = 100
const MAX_BOOKING_RECORDS = 2000

function createError(code, message) {
  return {
    ok: false,
    code: String(code || "INTERNAL_ERROR"),
    message: String(message || "查询失败")
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => String(item || "").trim()).filter(Boolean)
}

function hasAccess(record) {
  if (!record || typeof record !== "object") {
    return false
  }
  if (
    record.role === "admin" ||
    record.isAdmin === true ||
    record.admin === true ||
    (Array.isArray(record.roles) && record.roles.includes("admin"))
  ) {
    return true
  }
  const values = normalizeStringArray(
    [record.role].concat(record.roles || [], record.permissions || [])
  )
  return values.includes("booking_manage") || values.includes("booking_manager")
}

async function canView(openid) {
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
  return list.some(hasAccess)
}

function normalizeMonth(value) {
  const month = String(value || "").trim()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    return ""
  }
  return month
}

function getMonthRange(month) {
  const [year, monthNumber] = month.split("-").map(Number)
  const dayCount = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate()
  return {
    monthStart: `${month}-01`,
    monthEnd: `${month}-${String(dayCount).padStart(2, "0")}`
  }
}

function isActiveInRange(item, monthStart, monthEnd) {
  const status = String((item && item.status) || "pending").trim()
  const startDate = String((item && item.startDate) || "").trim()
  const endDate = String((item && (item.endDate || item.startDate)) || "").trim()
  return (
    status !== "cancelled" &&
    /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
    startDate <= endDate &&
    startDate <= monthEnd &&
    endDate >= monthStart
  )
}

async function readBookingsByMode(monthStart, monthEnd, ranged) {
  const list = []

  for (
    let offset = 0;
    offset <= MAX_BOOKING_RECORDS;
    offset += BOOKING_BATCH_SIZE
  ) {
    const remaining = MAX_BOOKING_RECORDS + 1 - list.length
    const batchSize = Math.min(BOOKING_BATCH_SIZE, remaining)
    let query = db.collection("bookings").field(BOOKING_CALENDAR_FIELDS)
    if (ranged) {
      query = query.where({
        startDate: db.command.lte(monthEnd),
        endDate: db.command.gte(monthStart)
      })
    }
    const res = await query.skip(offset).limit(batchSize).get()
    const batch = res && Array.isArray(res.data) ? res.data : []
    list.push(...batch)
    if (batch.length < batchSize || list.length > MAX_BOOKING_RECORDS) {
      break
    }
  }

  return {
    list: list.slice(0, MAX_BOOKING_RECORDS),
    truncated: list.length > MAX_BOOKING_RECORDS
  }
}

async function readBookings(monthStart, monthEnd) {
  try {
    return await readBookingsByMode(monthStart, monthEnd, true)
  } catch (indexError) {
    console.warn({
      function: "bookingCalendarList",
      stage: "rangeQueryFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    return readBookingsByMode(monthStart, monthEnd, false)
  }
}

async function writeErrorLogBestEffort(payload) {
  try {
    await db.collection("error_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {}
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const month = normalizeMonth(event && event.month)

  try {
    if (!(await canView(openid))) {
      return createError("FORBIDDEN", "权限不足")
    }
    if (!month) {
      return createError("VALIDATION_ERROR", "月份格式不正确")
    }

    const range = getMonthRange(month)
    const records = await readBookings(range.monthStart, range.monthEnd)
    const list = records.list
      .filter((item) => isActiveInRange(item, range.monthStart, range.monthEnd))
      .map((item) => ({
        id: String(item._id || item.id || "").trim(),
        vehicleId: String(item.vehicleId || "").trim(),
        vehicleName: String(item.vehicleName || "").trim(),
        startDate: String(item.startDate || "").trim(),
        endDate: String(item.endDate || item.startDate || "").trim(),
        status: String(item.status || "pending").trim() || "pending"
      }))
      .sort((prev, next) => {
        const dateOrder = prev.startDate.localeCompare(next.startDate)
        return dateOrder || prev.vehicleName.localeCompare(next.vehicleName)
      })

    return {
      ok: true,
      month,
      monthStart: range.monthStart,
      monthEnd: range.monthEnd,
      total: list.length,
      truncated: records.truncated,
      list
    }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "bookingCalendarList",
      stage: "main",
      month,
      authenticated: Boolean(openid),
      errorMessage:
        error && (error.message || error.errMsg)
          ? String(error.message || error.errMsg).slice(0, 300)
          : String(error).slice(0, 300),
      occurredAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "预约日历加载失败，请稍后重试")
  }
}
