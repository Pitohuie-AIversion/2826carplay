const VEHICLE_TYPES = ["sedan", "suv", "mpv", "sports", "truck", "other"]

const VEHICLE_STATUSES = ["active", "idle", "maintenance", "retired"]

const TRANSMISSION_TYPES = ["manual", "automatic"]

const FUEL_TYPES = ["gasoline", "electric", "hybrid"]

const REQUIRED_FIELDS = ["plateNumber", "vehicleType", "brandModel", "registerDate", "status"]

const PROVINCES = "京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼"
const ALPHANUM = "A-HJ-NP-Z0-9"
const SPECIAL_END = "挂学警港澳领"

const COMMON_PLATE_RE = new RegExp(
  `^[${PROVINCES}][A-Z][${ALPHANUM}]{4}[${ALPHANUM}${SPECIAL_END}]$`
)
const NEV_SMALL_RE = new RegExp(`^[${PROVINCES}][A-Z][DF][${ALPHANUM}]{5}$`)
const NEV_LARGE_RE = new RegExp(`^[${PROVINCES}][A-Z][${ALPHANUM}]{5}[DF]$`)

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

function createOk(value) {
  return { ok: true, value }
}

function normalizePlateNumber(input) {
  return String(input || "").trim().toUpperCase()
}

function normalizeOptionalText(input) {
  if (input === undefined || input === null) {
    return undefined
  }

  const value = String(input || "").trim()
  return value || undefined
}

function normalizeOptionalInt(input) {
  if (input === undefined || input === null || input === "") {
    return undefined
  }

  const normalized = String(input).trim()
  if (!normalized) {
    return undefined
  }

  if (!/^\d+$/.test(normalized)) {
    return Number.NaN
  }

  return Number(normalized)
}

function isValidPlateNumber(plateNumber) {
  const plate = normalizePlateNumber(plateNumber)

  if (!plate) {
    return false
  }

  if (/\s/.test(plate)) {
    return false
  }

  return COMMON_PLATE_RE.test(plate) || NEV_SMALL_RE.test(plate) || NEV_LARGE_RE.test(plate)
}

function isValidYmdDate(dateStr) {
  const str = String(dateStr || "")

  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) {
    return { ok: false, reason: "FORMAT" }
  }

  const [yStr, mStr, dStr] = str.split("-")
  const year = Number(yStr)
  const month = Number(mStr)
  const day = Number(dStr)

  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { ok: false, reason: "FORMAT" }
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return { ok: false, reason: "RANGE" }
  }

  const date = new Date(year, month - 1, day)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return { ok: false, reason: "INVALID_DATE" }
  }

  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  if (date.getTime() > today.getTime()) {
    return { ok: false, reason: "FUTURE" }
  }

  return { ok: true }
}

function normalizeVehicleInput(input) {
  const payload = input && typeof input === "object" ? input : {}
  const plateNumber = normalizePlateNumber(payload.plateNumber)
  const brandModel = String(payload.brandModel || "").trim()
  const registerDate = String(payload.registerDate || "").trim()
  const vehicleType = payload.vehicleType
  const status = payload.status

  const location = normalizeOptionalText(payload.location)
  const transmission = normalizeOptionalText(payload.transmission)
  const fuelType = normalizeOptionalText(payload.fuelType)
  const vin = normalizeOptionalText(payload.vin)
  const engineNumber = normalizeOptionalText(payload.engineNumber)
  const note = normalizeOptionalText(payload.note)
  const seats = normalizeOptionalInt(payload.seats)
  const priceDay = normalizeOptionalInt(payload.priceDay)

  const normalized = {
    plateNumber,
    vehicleType,
    brandModel,
    registerDate,
    status
  }

  if (vin !== undefined) {
    normalized.vin = vin
  }
  if (engineNumber !== undefined) {
    normalized.engineNumber = engineNumber
  }
  if (note !== undefined) {
    normalized.note = note
  }
  if (location !== undefined) {
    normalized.location = location
  }
  if (transmission !== undefined) {
    normalized.transmission = transmission
  }
  if (fuelType !== undefined) {
    normalized.fuelType = fuelType
  }
  if (seats !== undefined) {
    normalized.seats = seats
  }
  if (priceDay !== undefined) {
    normalized.priceDay = priceDay
  }

  return normalized
}

function validateVehicle(input) {
  const value = normalizeVehicleInput(input)
  const errors = []

  REQUIRED_FIELDS.forEach((field) => {
    const v = value[field]
    if (v === undefined || v === null || (typeof v === "string" && !v.trim())) {
      errors.push({ field, message: "必填字段缺失" })
    }
  })

  if (value.plateNumber && !isValidPlateNumber(value.plateNumber)) {
    errors.push({ field: "plateNumber", message: "车牌号格式不合法", value: value.plateNumber })
  }

  if (value.vehicleType && !VEHICLE_TYPES.includes(value.vehicleType)) {
    errors.push({
      field: "vehicleType",
      message: "车辆类型不合法",
      value: value.vehicleType,
      allowed: VEHICLE_TYPES
    })
  }

  if (value.status && !VEHICLE_STATUSES.includes(value.status)) {
    errors.push({
      field: "status",
      message: "车辆状态不合法",
      value: value.status,
      allowed: VEHICLE_STATUSES
    })
  }

  if (value.transmission && !TRANSMISSION_TYPES.includes(value.transmission)) {
    errors.push({
      field: "transmission",
      message: "变速箱类型不合法",
      value: value.transmission,
      allowed: TRANSMISSION_TYPES
    })
  }

  if (value.fuelType && !FUEL_TYPES.includes(value.fuelType)) {
    errors.push({
      field: "fuelType",
      message: "燃油类型不合法",
      value: value.fuelType,
      allowed: FUEL_TYPES
    })
  }

  if (value.brandModel) {
    if (value.brandModel.length < 1 || value.brandModel.length > 50) {
      errors.push({
        field: "brandModel",
        message: "品牌型号长度需为 1-50",
        value: value.brandModel
      })
    }
  }

  if (value.registerDate) {
    const dateCheck = isValidYmdDate(value.registerDate)
    if (!dateCheck.ok) {
      errors.push({
        field: "registerDate",
        message:
          dateCheck.reason === "FUTURE"
            ? "注册日期不得晚于今天"
            : "注册日期格式不合法（YYYY-MM-DD）",
        value: value.registerDate,
        reason: dateCheck.reason
      })
    }
  }

  if (value.vin !== undefined) {
    if (value.vin.length > 32) {
      errors.push({ field: "vin", message: "VIN 长度不能超过 32", value: value.vin })
    }
  }

  if (value.engineNumber !== undefined) {
    if (value.engineNumber.length > 32) {
      errors.push({
        field: "engineNumber",
        message: "发动机号长度不能超过 32",
        value: value.engineNumber
      })
    }
  }

  if (value.note !== undefined) {
    if (value.note.length > 200) {
      errors.push({ field: "note", message: "备注长度不能超过 200", value: value.note })
    }
  }

  if (value.location !== undefined) {
    if (value.location.length > 20) {
      errors.push({ field: "location", message: "城市长度不能超过 20", value: value.location })
    }
  }

  if (value.seats !== undefined) {
    if (!Number.isInteger(value.seats) || value.seats < 1 || value.seats > 9) {
      errors.push({ field: "seats", message: "座位数需为 1-9 的整数", value: value.seats })
    }
  }

  if (value.priceDay !== undefined) {
    if (!Number.isInteger(value.priceDay) || value.priceDay < 0 || value.priceDay > 99999) {
      errors.push({ field: "priceDay", message: "日租金需为 0-99999 的整数", value: value.priceDay })
    }
  }

  if (errors.length) {
    return createError("VALIDATION_ERROR", "参数校验失败", { errors })
  }

  return createOk(value)
}

module.exports = {
  VEHICLE_TYPES,
  VEHICLE_STATUSES,
  TRANSMISSION_TYPES,
  FUEL_TYPES,
  REQUIRED_FIELDS,
  normalizePlateNumber,
  normalizeOptionalText,
  normalizeOptionalInt,
  isValidPlateNumber,
  isValidYmdDate,
  normalizeVehicleInput,
  validateVehicle,
  createError,
  createOk
}
