const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 5
const RECENT_BOOKING_LIMIT = 100
const FALLBACK_BATCH_SIZE = 100
const FALLBACK_MAX_RECORDS = 1000
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{12,64}$/

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

function normalizeText(value, maxLen) {
  const text = String(value || "").trim()
  if (!text) {
    return ""
  }

  if (maxLen && text.length > maxLen) {
    return text.slice(0, maxLen)
  }

  return text
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    vehicleId: normalizeText(payload.vehicleId, 64),
    userName: normalizeText(payload.userName, 20),
    phone: normalizeText(payload.phone, 20),
    startDate: normalizeText(payload.startDate, 20),
    endDate: normalizeText(payload.endDate, 20),
    city: normalizeText(payload.city, 20),
    note: normalizeText(payload.note, 200),
    requestId: String(payload.requestId || "").trim()
  }
}

function isValidDateOnly(value) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ""))
  if (!match) {
    return false
  }

  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function getTodayInChina() {
  const chinaOffsetMs = 8 * 60 * 60 * 1000
  return new Date(Date.now() + chinaOffsetMs).toISOString().slice(0, 10)
}

function validateInput(input) {
  const errors = []

  if (!input.vehicleId) {
    errors.push({ field: "vehicleId", message: "车辆 ID 不能为空" })
  }

  if (!input.userName) {
    errors.push({ field: "userName", message: "姓名不能为空" })
  }

  if (!input.phone) {
    errors.push({ field: "phone", message: "手机号不能为空" })
  } else if (!/^1\d{10}$/.test(input.phone)) {
    errors.push({ field: "phone", message: "手机号格式不正确" })
  }

  if (!input.startDate) {
    errors.push({ field: "startDate", message: "取车日期不能为空" })
  } else if (!isValidDateOnly(input.startDate)) {
    errors.push({ field: "startDate", message: "取车日期格式不正确" })
  } else if (input.startDate < getTodayInChina()) {
    errors.push({ field: "startDate", message: "取车日期不能早于今天" })
  }

  if (!input.endDate) {
    errors.push({ field: "endDate", message: "还车日期不能为空" })
  } else if (!isValidDateOnly(input.endDate)) {
    errors.push({ field: "endDate", message: "还车日期格式不正确" })
  }

  if (
    isValidDateOnly(input.startDate) &&
    isValidDateOnly(input.endDate) &&
    input.endDate < input.startDate
  ) {
    errors.push({ field: "endDate", message: "还车日期不能早于取车日期" })
  }

  if (!input.city) {
    errors.push({ field: "city", message: "城市不能为空" })
  }

  if (input.requestId && !REQUEST_ID_PATTERN.test(input.requestId)) {
    errors.push({
      field: "requestId",
      message: "请求标识格式不正确"
    })
  }

  return errors
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

function isActiveBooking(booking) {
  const status = String((booking && booking.status) || "").trim()
  return status !== "cancelled" && status !== "completed"
}

async function queryRecentBookings(openid) {
  try {
    const res = await db
      .collection("bookings")
      .where({ openid })
      .orderBy("createdAt", "desc")
      .limit(RECENT_BOOKING_LIMIT)
      .get()

    return res && Array.isArray(res.data) ? res.data : []
  } catch (indexError) {
    console.warn({
      function: "bookingCreate",
      stage: "indexFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
  }

  const collected = []
  for (let offset = 0; offset <= FALLBACK_MAX_RECORDS; offset += FALLBACK_BATCH_SIZE) {
    const remaining = FALLBACK_MAX_RECORDS + 1 - collected.length
    const batchSize = Math.min(FALLBACK_BATCH_SIZE, remaining)
    const res = await db
      .collection("bookings")
      .where({ openid })
      .skip(offset)
      .limit(batchSize)
      .get()
    const batch = res && Array.isArray(res.data) ? res.data : []

    collected.push(...batch)
    if (batch.length < batchSize || collected.length > FALLBACK_MAX_RECORDS) {
      break
    }
  }

  return collected
    .slice(0, FALLBACK_MAX_RECORDS)
    .sort((left, right) => toTimestamp(right && right.createdAt) - toTimestamp(left && left.createdAt))
}

async function checkBookingSubmission(openid, input) {
  const list = await queryRecentBookings(openid)

  const duplicate = list.some(
    (item) =>
      isActiveBooking(item) &&
      String(item.vehicleId || "").trim() === input.vehicleId &&
      String(item.startDate || "").trim() === input.startDate &&
      String(item.endDate || "").trim() === input.endDate
  )
  if (duplicate) {
    return createError("DUPLICATE_BOOKING", "相同车辆和日期的预约已提交，请勿重复预约")
  }

  const windowStart = Date.now() - RATE_LIMIT_WINDOW_MS
  const recentCount = list.filter((item) => toTimestamp(item && item.createdAt) >= windowStart).length
  if (recentCount >= RATE_LIMIT_MAX_REQUESTS) {
    return createError("RATE_LIMITED", "预约提交过于频繁，请稍后再试")
  }

  return null
}

function buildBookingDocumentId(openid, requestId) {
  return crypto
    .createHash("sha256")
    .update(`${openid}:${requestId}`)
    .digest("hex")
    .slice(0, 32)
}

async function findIdempotentBooking(openid, requestId) {
  if (!requestId) {
    return null
  }

  const bookingId = buildBookingDocumentId(openid, requestId)
  try {
    const res = await db.collection("bookings").doc(bookingId).get()
    const booking = res && res.data ? res.data : null
    if (!booking) {
      return { bookingId, existing: false, conflict: false }
    }

    const sameRequest =
      String(booking.openid || "").trim() === openid &&
      String(booking.requestId || "").trim() === requestId
    return {
      bookingId,
      existing: sameRequest,
      conflict: !sameRequest
    }
  } catch (error) {
    return { bookingId, existing: false, conflict: false }
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
      function: "bookingCreate",
      stage: "errorLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
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
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }

    console.error({
      function: "bookingCreate",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }

    const errors = validateInput(input)
    if (errors.length) {
      return createError("VALIDATION_ERROR", "参数校验失败", { errors })
    }

    const idempotency = await findIdempotentBooking(openid, input.requestId)
    if (idempotency && idempotency.conflict) {
      return createError("IDEMPOTENCY_CONFLICT", "请求标识冲突，请修改预约信息后重试")
    }
    if (idempotency && idempotency.existing) {
      return {
        ok: true,
        id: idempotency.bookingId,
        duplicated: true,
        message: "预约信息已提交，请勿重复操作"
      }
    }

    const submissionError = await checkBookingSubmission(openid, input)
    if (submissionError) {
      return submissionError
    }

    const vehicleRes = await db.collection("vehicles").doc(input.vehicleId).get()
    const vehicle = vehicleRes && vehicleRes.data ? vehicleRes.data : null
    if (!vehicle) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    if (String(vehicle.status || "").trim() === "retired") {
      return createError("NOT_AVAILABLE", "车辆已停用，暂不可预约")
    }

    const bookingData = {
      openid,
      vehicleId: input.vehicleId,
      vehicleName: normalizeText(vehicle.name || vehicle.plateNumber || "", 50),
      userName: input.userName,
      phone: input.phone,
      startDate: input.startDate,
      endDate: input.endDate,
      city: input.city,
      note: input.note,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      status: "pending",
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    let bookingId = ""
    if (idempotency && input.requestId) {
      bookingId = idempotency.bookingId
      await db.collection("bookings").doc(bookingId).set({
        data: bookingData
      })
    } else {
      const addRes = await db.collection("bookings").add({
        data: bookingData
      })
      bookingId = addRes && (addRes._id || addRes.id) ? addRes._id || addRes.id : ""
    }

    await writeAuditLogBestEffort({
      openid,
      action: "bookingCreate",
      bookingId,
      vehicleId: input.vehicleId,
      vehicleName: bookingData.vehicleName,
      startDate: input.startDate,
      endDate: input.endDate,
      city: input.city
    })

    return {
      ok: true,
      id: bookingId,
      message: "预约信息已提交，客服将尽快联系您"
    }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "bookingCreate",
      openid,
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.endDate,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : ""
    })

    console.error({
      function: "bookingCreate",
      openid,
      vehicleId: input.vehicleId,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "预约提交失败，请稍后重试")
  }
}
