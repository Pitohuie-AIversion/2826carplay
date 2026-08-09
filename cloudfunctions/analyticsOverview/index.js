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
const ANALYTICS_VEHICLE_FIELDS = {
  brandModel: true
}
const ANALYTICS_EVENT_FIELDS = {
  eventType: true,
  vehicleId: true,
  createdAt: true
}
const QUOTE_ANALYTICS_FIELDS = {
  bookingId: true,
  status: true,
  sentAt: true,
  confirmedAt: true,
  adjustmentRequestedAt: true
}
const BOOKING_ANALYTICS_FIELDS = {
  status: true,
  createdAt: true
}
const MAX_EVENTS = 5000
const EVENT_BATCH_SIZE = 100
const DAY_MS = 24 * 60 * 60 * 1000
const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000
const EVENT_TYPES = [
  "garage_view",
  "vehicle_detail",
  "booking_start",
  "booking_submit",
  "favorite_add",
  "pricing_view",
  "rental_rules_view",
  "phone_call",
  "share",
  "availability_available",
  "availability_conflict",
  "availability_unknown"
]

function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || "").trim()).filter(Boolean)
    : []
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
  return values.some((item) =>
    ["booking_manage", "booking_manager", "vehicle_manage", "vehicle_manager"].includes(item)
  )
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
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function toChinaDayKey(timestamp) {
  return new Date(timestamp + CHINA_TIME_OFFSET_MS).toISOString().slice(0, 10)
}

function startOfChinaDay(timestamp) {
  const chinaDate = new Date(timestamp + CHINA_TIME_OFFSET_MS)
  return (
    Date.UTC(
      chinaDate.getUTCFullYear(),
      chinaDate.getUTCMonth(),
      chinaDate.getUTCDate()
    ) - CHINA_TIME_OFFSET_MS
  )
}

async function readEventsByMode(ordered) {
  const list = []
  for (let offset = 0; offset <= MAX_EVENTS; offset += EVENT_BATCH_SIZE) {
    const remaining = MAX_EVENTS + 1 - list.length
    const batchSize = Math.min(EVENT_BATCH_SIZE, remaining)
    let query = db.collection("analytics_events").field(ANALYTICS_EVENT_FIELDS)
    if (ordered) {
      query = query.orderBy("createdAt", "desc")
    }
    const res = await query.skip(offset).limit(batchSize).get()
    const batch = res && Array.isArray(res.data) ? res.data : []
    list.push(...batch)
    if (batch.length < batchSize || list.length > MAX_EVENTS) {
      break
    }
  }
  return {
    list: list.slice(0, MAX_EVENTS),
    truncated: list.length > MAX_EVENTS
  }
}

async function readEvents() {
  try {
    return await readEventsByMode(true)
  } catch (indexError) {
    return readEventsByMode(false)
  }
}

async function readCollectionRecords(collectionName, fields) {
  const list = []
  try {
    for (let offset = 0; offset <= MAX_EVENTS; offset += EVENT_BATCH_SIZE) {
      const remaining = MAX_EVENTS + 1 - list.length
      const batchSize = Math.min(EVENT_BATCH_SIZE, remaining)
      const res = await db.collection(collectionName).field(fields).skip(offset).limit(batchSize).get()
      const batch = res && Array.isArray(res.data) ? res.data : []
      list.push(...batch)
      if (batch.length < batchSize || list.length > MAX_EVENTS) break
    }
  } catch (error) {
    const message = String(error && (error.message || error.errMsg) || error)
    if (!message.includes("Unexpected collection:") && !message.includes("not exist")) throw error
  }
  return { list: list.slice(0, MAX_EVENTS), truncated: list.length > MAX_EVENTS }
}

function buildQuoteMetrics(bookings, quotes, start, now) {
  const periodBookings = bookings.filter((item) => {
    const timestamp = toTimestamp(item.createdAt)
    return timestamp >= start && timestamp <= now
  })
  const periodSentQuotes = quotes.filter((item) => {
    const timestamp = toTimestamp(item.sentAt)
    return timestamp >= start && timestamp <= now
  })
  const quotedBookingIds = new Set(periodSentQuotes.map((item) => String(item.bookingId || "")).filter(Boolean))
  const confirmedQuotes = periodSentQuotes.filter((item) => Boolean(toTimestamp(item.confirmedAt)))
  const adjustmentRequests = quotes.filter((item) => {
    const timestamp = toTimestamp(item.adjustmentRequestedAt)
    return timestamp >= start && timestamp <= now
  })
  const confirmDurations = confirmedQuotes
    .map((item) => toTimestamp(item.confirmedAt) - toTimestamp(item.sentAt))
    .filter((value) => value >= 0)
  return {
    submittedBookings: periodBookings.length,
    quotedBookings: quotedBookingIds.size,
    sentQuoteVersions: periodSentQuotes.length,
    confirmedQuoteVersions: confirmedQuotes.length,
    adjustmentRequests: adjustmentRequests.length,
    quoteSentRate: periodBookings.length ? Math.round((quotedBookingIds.size / periodBookings.length) * 1000) / 10 : 0,
    quoteConfirmationRate: periodSentQuotes.length ? Math.round((confirmedQuotes.length / periodSentQuotes.length) * 1000) / 10 : 0,
    averageConfirmationHours: confirmDurations.length
      ? Math.round((confirmDurations.reduce((sum, value) => sum + value, 0) / confirmDurations.length / 3600000) * 10) / 10
      : 0
  }
}

async function readVehicleName(vehicleId) {
  try {
    const res = await db
      .collection("vehicles")
      .doc(vehicleId)
      .field(ANALYTICS_VEHICLE_FIELDS)
      .get()
    const vehicle = res && res.data ? res.data : null
    return vehicle ? String(vehicle.brandModel || "").trim() || "未命名车辆" : "已下架车辆"
  } catch (error) {
    return "已下架车辆"
  }
}

function buildTrend(events, days, now) {
  const counts = {}
  events.forEach((item) => {
    const timestamp = toTimestamp(item.createdAt)
    if (timestamp) {
      const key = toChinaDayKey(timestamp)
      counts[key] = (counts[key] || 0) + 1
    }
  })
  const list = []
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const key = toChinaDayKey(now - offset * DAY_MS)
    list.push({
      key,
      label: key.slice(5),
      value: counts[key] || 0
    })
  }
  return list
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const requestedDays = Number(event && event.days)
  const days = requestedDays === 30 ? 30 : 7

  try {
    if (!(await canView(openid))) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "权限不足"
      }
    }

    const now = Date.now()
    const start = startOfChinaDay(now) - (days - 1) * DAY_MS
    const [records, bookingRecords, quoteRecords] = await Promise.all([
      readEvents(),
      readCollectionRecords("bookings", BOOKING_ANALYTICS_FIELDS),
      readCollectionRecords("booking_quotes", QUOTE_ANALYTICS_FIELDS)
    ])
    const events = records.list.filter((item) => {
      const timestamp = toTimestamp(item.createdAt)
      return timestamp >= start && timestamp <= now && EVENT_TYPES.includes(String(item.eventType || ""))
    })
    const metrics = EVENT_TYPES.reduce((acc, type) => {
      acc[type] = events.filter((item) => item.eventType === type).length
      return acc
    }, {})
    const vehicleScores = {}
    events.forEach((item) => {
      const vehicleId = String(item.vehicleId || "").trim()
      if (!vehicleId) {
        return
      }
      const current = vehicleScores[vehicleId] || {
        vehicleId,
        detailViews: 0,
        bookingStarts: 0,
        bookingSubmits: 0,
        favorites: 0,
        pricingViews: 0,
        rentalRuleViews: 0,
        score: 0
      }
      if (item.eventType === "vehicle_detail") {
        current.detailViews += 1
        current.score += 1
      } else if (item.eventType === "booking_start") {
        current.bookingStarts += 1
        current.score += 3
      } else if (item.eventType === "booking_submit") {
        current.bookingSubmits += 1
        current.score += 5
      } else if (item.eventType === "favorite_add") {
        current.favorites += 1
        current.score += 2
      } else if (item.eventType === "pricing_view") {
        current.pricingViews += 1
        current.score += 1
      } else if (item.eventType === "rental_rules_view") {
        current.rentalRuleViews += 1
        current.score += 1
      }
      vehicleScores[vehicleId] = current
    })
    const topVehicles = Object.values(vehicleScores)
      .sort((prev, next) => next.score - prev.score)
      .slice(0, 5)
    const names = await Promise.all(topVehicles.map((item) => readVehicleName(item.vehicleId)))

    return {
      ok: true,
      days,
      truncated: records.truncated,
      metrics,
      quoteMetrics: buildQuoteMetrics(bookingRecords.list, quoteRecords.list, start, now),
      conversionRate:
        metrics.vehicle_detail > 0
          ? Math.round((metrics.booking_submit / metrics.vehicle_detail) * 1000) / 10
          : 0,
      trend: buildTrend(events, days, now),
      topVehicles: topVehicles.map((item, index) => ({
        ...item,
        name: names[index]
      })),
      quoteDataTruncated: bookingRecords.truncated || quoteRecords.truncated
    }
  } catch (error) {
    console.error({
      function: "analyticsOverview",
      authenticated: Boolean(openid),
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "数据分析加载失败，请稍后重试"
    }
  }
}
