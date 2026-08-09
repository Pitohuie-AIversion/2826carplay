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
const BOOKING_MANAGE_DETAIL_FIELDS = {
  _id: true,
  openid: true,
  vehicleId: true,
  vehicleName: true,
  userName: true,
  phone: true,
  startDate: true,
  endDate: true,
  city: true,
  note: true,
  adminRemark: true,
  adminRemarkUpdatedAt: true,
  schedulePriority: true,
  coordinationStatus: true,
  coordinationUpdatedAt: true,
  latestQuoteId: true,
  latestQuoteVersion: true,
  quotedAt: true,
  confirmedAt: true,
  adjustmentRequestedAt: true,
  status: true,
  createdAt: true,
  updatedAt: true
}
const BOOKING_QUOTE_DETAIL_FIELDS = {
  _id: true,
  bookingId: true,
  vehicleId: true,
  vehicleName: true,
  startDate: true,
  endDate: true,
  rentalDays: true,
  baseRentalCents: true,
  protectionCents: true,
  serviceFeeCents: true,
  deliveryFeeCents: true,
  otherFeeCents: true,
  totalCents: true,
  depositText: true,
  validUntil: true,
  customerNote: true,
  adjustmentNote: true,
  version: true,
  status: true,
  responseStatus: true,
  createdAt: true,
  updatedAt: true,
  sentAt: true,
  confirmedAt: true,
  adjustmentRequestedAt: true,
  expiredAt: true
}
const BOOKING_CONFLICT_FIELDS = {
  _id: true,
  vehicleId: true,
  userName: true,
  phone: true,
  startDate: true,
  endDate: true,
  city: true,
  status: true,
  schedulePriority: true,
  coordinationStatus: true
}
const CONFLICT_BATCH_SIZE = 100
const MAX_CONFLICT_SCAN_RECORDS = 1000
const MAX_CONFLICT_RESULTS = 20

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

function getBookingId(item) {
  return String((item && (item._id || item.id)) || "").trim()
}

function mapQuote(item) {
  return {
    id: String((item && (item._id || item.id)) || ""),
    bookingId: String((item && item.bookingId) || ""),
    vehicleId: String((item && item.vehicleId) || ""),
    vehicleName: String((item && item.vehicleName) || ""),
    startDate: String((item && item.startDate) || ""),
    endDate: String((item && item.endDate) || ""),
    rentalDays: Math.max(0, Number((item && item.rentalDays) || 0)),
    baseRentalCents: Math.max(0, Number((item && item.baseRentalCents) || 0)),
    protectionCents: Math.max(0, Number((item && item.protectionCents) || 0)),
    serviceFeeCents: Math.max(0, Number((item && item.serviceFeeCents) || 0)),
    deliveryFeeCents: Math.max(0, Number((item && item.deliveryFeeCents) || 0)),
    otherFeeCents: Math.max(0, Number((item && item.otherFeeCents) || 0)),
    totalCents: Math.max(0, Number((item && item.totalCents) || 0)),
    depositText: String((item && item.depositText) || ""),
    validUntil: String((item && item.validUntil) || ""),
    customerNote: String((item && item.customerNote) || ""),
    adjustmentNote: String((item && item.adjustmentNote) || ""),
    version: Math.max(0, Number((item && item.version) || 0)),
    status: String((item && item.status) || "draft"),
    responseStatus: String((item && item.responseStatus) || ""),
    createdAt: formatTime(item && item.createdAt),
    updatedAt: formatTime(item && item.updatedAt),
    sentAt: formatTime(item && item.sentAt),
    confirmedAt: formatTime(item && item.confirmedAt),
    adjustmentRequestedAt: formatTime(item && item.adjustmentRequestedAt),
    expiredAt: formatTime(item && item.expiredAt)
  }
}

async function readBookingQuotes(bookingId) {
  try {
    const res = await db
      .collection("booking_quotes")
      .where({ bookingId })
      .field(BOOKING_QUOTE_DETAIL_FIELDS)
      .limit(50)
      .get()
    const list = res && Array.isArray(res.data) ? res.data.map(mapQuote) : []
    const draft = list.find((item) => item.status === "draft") || null
    const history = list
      .filter((item) => item.status !== "draft")
      .sort((prev, next) => next.version - prev.version)
      .slice(0, 20)
    return { draft, history, unavailable: false }
  } catch (error) {
    const message = String(error && (error.message || error.errMsg) || error)
    if (message.includes("Unexpected collection:") || message.includes("not exist")) {
      return { draft: null, history: [], unavailable: false }
    }
    throw error
  }
}

function hasValidDateRange(item) {
  const startDate = String((item && item.startDate) || "").trim()
  const endDate = String((item && (item.endDate || item.startDate)) || "").trim()
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
    /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
    startDate <= endDate
  )
}

function overlapsTarget(item, target) {
  if (!hasValidDateRange(item) || !hasValidDateRange(target)) {
    return false
  }

  const itemStart = String(item.startDate || "")
  const itemEnd = String(item.endDate || item.startDate || "")
  const targetStart = String(target.startDate || "")
  const targetEnd = String(target.endDate || target.startDate || "")
  return itemStart <= targetEnd && itemEnd >= targetStart
}

async function readVehicleBookings(vehicleId) {
  const list = []

  for (
    let offset = 0;
    offset <= MAX_CONFLICT_SCAN_RECORDS;
    offset += CONFLICT_BATCH_SIZE
  ) {
    const remaining = MAX_CONFLICT_SCAN_RECORDS + 1 - list.length
    const batchSize = Math.min(CONFLICT_BATCH_SIZE, remaining)
    const res = await db
      .collection("bookings")
      .where({ vehicleId })
      .field(BOOKING_CONFLICT_FIELDS)
      .skip(offset)
      .limit(batchSize)
      .get()
    const batch = res && Array.isArray(res.data) ? res.data : []
    list.push(...batch)
    if (batch.length < batchSize || list.length > MAX_CONFLICT_SCAN_RECORDS) {
      break
    }
  }

  return {
    list: list.slice(0, MAX_CONFLICT_SCAN_RECORDS),
    truncated: list.length > MAX_CONFLICT_SCAN_RECORDS
  }
}

function mapConflictBooking(item) {
  const bookingStatus = String((item && item.status) || "pending").trim() || "pending"
  const schedulePriority = ["priority", "normal", "standby"].includes(item && item.schedulePriority)
    ? item.schedulePriority
    : "normal"
  const coordinationStatus = bookingStatus === "completed" || bookingStatus === "cancelled"
    ? "resolved"
    : ["pending", "coordinating", "resolved"].includes(item && item.coordinationStatus)
      ? item.coordinationStatus
      : "pending"
  return {
    id: getBookingId(item),
    userName: String((item && item.userName) || "").trim(),
    phone: String((item && item.phone) || "").trim(),
    startDate: String((item && item.startDate) || "").trim(),
    endDate: String((item && (item.endDate || item.startDate)) || "").trim(),
    city: String((item && item.city) || "").trim(),
    status: bookingStatus,
    schedulePriority,
    coordinationStatus
  }
}

async function findBookingConflicts(target, targetId) {
  const vehicleId = String((target && target.vehicleId) || "").trim()
  if (
    !vehicleId ||
    String((target && target.status) || "pending") === "cancelled" ||
    !hasValidDateRange(target)
  ) {
    return {
      list: [],
      total: 0,
      truncated: false,
      unavailable: false,
      skipped: true
    }
  }

  try {
    const records = await readVehicleBookings(vehicleId)
    const conflicts = records.list
      .filter((item) => {
        const itemId = getBookingId(item)
        return (
          itemId &&
          itemId !== targetId &&
          String((item && item.vehicleId) || "").trim() === vehicleId &&
          String((item && item.status) || "pending").trim() !== "cancelled" &&
          overlapsTarget(item, target)
        )
      })
      .map(mapConflictBooking)
      .sort((prev, next) => {
        const dateOrder = prev.startDate.localeCompare(next.startDate)
        return dateOrder || prev.id.localeCompare(next.id)
      })

    return {
      list: conflicts.slice(0, MAX_CONFLICT_RESULTS),
      total: conflicts.length,
      truncated: records.truncated || conflicts.length > MAX_CONFLICT_RESULTS,
      unavailable: false,
      skipped: false
    }
  } catch (error) {
    console.warn({
      function: "bookingDetail",
      stage: "conflictQuery",
      bookingId: targetId,
      vehicleId,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return {
      list: [],
      total: 0,
      truncated: false,
      unavailable: true,
      skipped: false
    }
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
  } catch (error) {
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "bookingDetail",
      stage: "errorLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const id = String((event && event.id) || "").trim()

  try {
    const allowed = await hasOpenidCapability(openid, "booking_manage")
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      })
    }

    const res = await db
      .collection("bookings")
      .doc(id)
      .field(BOOKING_MANAGE_DETAIL_FIELDS)
      .get()
    const item = res && res.data ? res.data : null
    if (!item) {
      return createError("NOT_FOUND", "预约不存在")
    }

    const conflictResult = await findBookingConflicts(item, id)
    const quoteResult = await readBookingQuotes(id)

    return {
      ok: true,
      detail: {
        id: item._id || item.id || "",
        openid: item.openid || "",
        vehicleId: item.vehicleId || "",
        vehicleName: item.vehicleName || "",
        userName: item.userName || "",
        phone: item.phone || "",
        startDate: item.startDate || "",
        endDate: item.endDate || "",
        city: item.city || "",
        note: item.note || "",
        adminRemark: item.adminRemark || "",
        adminRemarkUpdatedAt: formatTime(item.adminRemarkUpdatedAt),
        schedulePriority: ["priority", "normal", "standby"].includes(item.schedulePriority)
          ? item.schedulePriority
          : "normal",
        coordinationStatus:
          item.status === "completed" || item.status === "cancelled"
            ? "resolved"
            : ["pending", "coordinating", "resolved"].includes(item.coordinationStatus)
              ? item.coordinationStatus
              : "pending",
        coordinationUpdatedAt: formatTime(item.coordinationUpdatedAt),
        latestQuoteId: item.latestQuoteId || "",
        latestQuoteVersion: Math.max(0, Number(item.latestQuoteVersion || 0)),
        quotedAt: formatTime(item.quotedAt),
        confirmedAt: formatTime(item.confirmedAt),
        adjustmentRequestedAt: formatTime(item.adjustmentRequestedAt),
        status: item.status || "pending",
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      },
      conflicts: conflictResult.list,
      conflictTotal: conflictResult.total,
      conflictsTruncated: conflictResult.truncated,
      conflictsUnavailable: conflictResult.unavailable,
      conflictCheckSkipped: conflictResult.skipped
      ,quoteDraft: quoteResult.draft
      ,quoteHistory: quoteResult.history
      ,quotesUnavailable: quoteResult.unavailable
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    console.error({
      function: "bookingDetail",
      authenticated: Boolean(openid),
      id,
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    await writeErrorLogBestEffort({
      function: "bookingDetail",
      bookingId: id,
      stage: "main",
      authenticated: Boolean(openid),
      errorMessage,
      occurredAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询预约详情失败，请稍后重试")
  }
}
