const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const BATCH_SIZE = 100
const MAX_SCAN_RECORDS = 1000
const AVAILABILITY_VEHICLE_FIELDS = {
  status: true
}

function createError(code, message, details) {
  const result = {
    ok: false,
    code: String(code || "VALIDATION_ERROR"),
    message: String(message || "参数错误")
  }

  if (details !== undefined) {
    result.details = details
  }

  return result
}
function isValidDateOnly(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
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
  const now = new Date(Date.now() + 8 * 60 * 60 * 1000)
  return now.toISOString().slice(0, 10)
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    vehicleId: String(payload.vehicleId || payload.carId || "").trim(),
    startDate: String(payload.startDate || "").trim(),
    endDate: String(payload.endDate || "").trim()
  }
}

function validateInput(input) {
  const errors = []

  if (!input.vehicleId || input.vehicleId.length > 128) {
    errors.push({ field: "vehicleId", message: "车辆 ID 格式不正确" })
  }
  if (!isValidDateOnly(input.startDate)) {
    errors.push({ field: "startDate", message: "取车日期格式不正确" })
  } else if (input.startDate < getTodayInChina()) {
    errors.push({ field: "startDate", message: "取车日期不能早于今天" })
  }
  if (!isValidDateOnly(input.endDate)) {
    errors.push({ field: "endDate", message: "还车日期格式不正确" })
  }
  if (
    isValidDateOnly(input.startDate) &&
    isValidDateOnly(input.endDate) &&
    input.endDate < input.startDate
  ) {
    errors.push({ field: "endDate", message: "还车日期不能早于取车日期" })
  }

  return errors
}

function isOverlappingBooking(item, input) {
  if (String((item && item.status) || "pending") === "cancelled") {
    return false
  }

  const startDate = String((item && item.startDate) || "").trim()
  const endDate = String((item && item.endDate) || startDate).trim()
  return Boolean(startDate && endDate && startDate <= input.endDate && endDate >= input.startDate)
}

async function queryVehicleBookings(vehicleId) {
  const countResult = await db.collection("bookings").where({ vehicleId }).count()
  const total = Math.max(0, Number((countResult && countResult.total) || 0))
  const scanCount = Math.min(total, MAX_SCAN_RECORDS)
  const list = []

  for (let offset = 0; offset < scanCount; offset += BATCH_SIZE) {
    const batchSize = Math.min(BATCH_SIZE, scanCount - offset)
    const res = await db
      .collection("bookings")
      .where({ vehicleId })
      .field({
        startDate: true,
        endDate: true,
        status: true
      })
      .skip(offset)
      .limit(batchSize)
      .get()
    const batch = res && Array.isArray(res.data) ? res.data : []
    list.push(...batch)
    if (batch.length < batchSize) {
      break
    }
  }

  return {
    list,
    truncated: total > MAX_SCAN_RECORDS
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

    const vehicleRes = await db
      .collection("vehicles")
      .doc(input.vehicleId)
      .field(AVAILABILITY_VEHICLE_FIELDS)
      .get()
    const vehicle = vehicleRes && vehicleRes.data ? vehicleRes.data : null
    if (!vehicle) {
      return createError("NOT_FOUND", "车辆不存在")
    }
    if (String(vehicle.status || "").trim() === "retired") {
      return createError("NOT_AVAILABLE", "车辆已停用，暂不可预约")
    }

    const queryResult = await queryVehicleBookings(input.vehicleId)
    const conflictCount = queryResult.list.filter((item) => isOverlappingBooking(item, input)).length
    const truncated = Boolean(queryResult.truncated)
    const available = conflictCount === 0 && !truncated
    let message = "当前未发现同期预约咨询，可继续提交"

    if (conflictCount > 0) {
      message = truncated
        ? `当前至少有 ${conflictCount} 条同期咨询，仍可提交候补`
        : `当前已有 ${conflictCount} 条同期咨询，仍可提交候补`
    } else if (truncated) {
      message = "历史预约较多，档期请以顾问确认为准"
    }

    return {
      ok: true,
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.endDate,
      available,
      conflictCount,
      truncated,
      message
    }
  } catch (error) {
    console.error({
      function: "vehicleAvailabilityCheck",
      vehicleId: input.vehicleId,
      startDate: input.startDate,
      endDate: input.endDate,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "档期查询失败，请稍后重试")
  }
}
