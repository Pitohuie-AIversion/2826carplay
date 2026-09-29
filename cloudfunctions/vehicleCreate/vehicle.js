const { validateRentalDiscountTiers, normalizeRentalDiscountTiers } = require("./rentalPricing")
const VEHICLE_TYPES = ["sedan", "suv", "mpv", "sports", "truck", "other"]

const VEHICLE_STATUSES = ["active", "idle", "maintenance", "retired"]

const TRANSMISSION_TYPES = ["manual", "automatic"]

const FUEL_TYPES = ["gasoline", "electric", "hybrid"]

const ARCHIVE_REVIEW_STATUSES = ["pending", "reviewed"]

const DRIVETRAIN_OPTIONS = [
  "前置前驱 (FF)",
  "前置后驱 (FR)",
  "中置后驱 (MR)",
  "后置后驱 (RR)",
  "前置四驱 (4WD)",
  "全时四驱 (AWD)",
  "分时四驱 (Part-Time 4WD)",
  "智能四驱",
  "后轮驱动 (RWD)",
  "前轮驱动 (FWD)",
  "双电机四驱",
  "三电机四驱"
]

const PERFORMANCE_TEXT_FIELDS = ["acceleration", "horsepower", "drivetrain", "torque"]

const PERFORMANCE_ACCELERATION_RE = /^\d+(?:\.\d+)?\s*(?:s|秒)?$/i
const PERFORMANCE_HORSEPOWER_RE = /^\d+(?:\.\d+)?\s*(?:ps|hp|kw|千瓦|匹|马力)?$/i
const PERFORMANCE_TORQUE_RE = /^\d+(?:\.\d+)?\s*(?:n·m|nm|牛·米|牛米)?$/i

const PUBLIC_ARCHIVE_TEXT_FIELDS = [
  "publicInspectionSummary",
  "publicExteriorSummary",
  "publicInsuranceSummary",
  "publicAssistanceSummary"
]

const INTERNAL_ARCHIVE_TEXT_FIELDS = [
  "internalMaintenanceRecord",
  "internalInspectionRecord",
  "internalInsuranceRecord",
  "internalArchiveNote"
]

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

function normalizeOptionalTextField(payload, field) {
  if (!Object.prototype.hasOwnProperty.call(payload, field)) {
    return undefined
  }

  if (payload[field] === undefined) {
    return undefined
  }

  return String(payload[field] || "").trim()
}

function normalizeOptionalIntField(payload, field) {
  if (!Object.prototype.hasOwnProperty.call(payload, field) || payload[field] === undefined) {
    return undefined
  }

  if (payload[field] === null || String(payload[field]).trim() === "") {
    return null
  }

  return normalizeOptionalInt(payload[field])
}

function normalizePerformanceInput(raw) {
  if (raw === undefined || raw === null) {
    return undefined
  }

  const source = typeof raw === "object" ? raw : {}
  const result = {}

  PERFORMANCE_TEXT_FIELDS.forEach((field) => {
    if (!Object.prototype.hasOwnProperty.call(source, field)) {
      return
    }
    const value = String(source[field] || "").trim()
    result[field] = value || ""
  })

  if (Object.prototype.hasOwnProperty.call(source, "highlights")) {
    const rawHighlights = source.highlights
    if (Array.isArray(rawHighlights)) {
      const cleaned = rawHighlights
        .map((item) => String(item || "").trim())
        .filter((item) => item && item.length <= 20)
        .slice(0, 8)
      result.highlights = cleaned
    } else if (typeof rawHighlights === "string" && rawHighlights) {
      const cleaned = String(rawHighlights)
        .split(/[,，、\n;；]/)
        .map((item) => item.trim())
        .filter((item) => item && item.length <= 20)
        .slice(0, 8)
      result.highlights = cleaned
    } else {
      result.highlights = []
    }
  }

  if (Object.keys(result).length === 0) {
    return undefined
  }

  return result
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

function buildVehicleDisplayIdentity(value) {
  const vehicleName = String(value || "").trim()
  if (!isValidPlateNumber(vehicleName)) {
    return {
      vehicleName: vehicleName || "预约车辆",
      vehicleReference: ""
    }
  }

  const plateNumber = normalizePlateNumber(vehicleName)
  return {
    vehicleName: "预约车辆",
    vehicleReference: `车牌尾号 ${plateNumber.slice(-2)}`
  }
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

  const location = normalizeOptionalTextField(payload, "location")
  const transmission = normalizeOptionalTextField(payload, "transmission")
  const fuelType = normalizeOptionalTextField(payload, "fuelType")
  const vin = normalizeOptionalTextField(payload, "vin")
  const engineNumber = normalizeOptionalTextField(payload, "engineNumber")
  const publicDescription = normalizeOptionalTextField(payload, "publicDescription")
  const note = normalizeOptionalTextField(payload, "note")
  const publicMaterialsUpdatedDate = normalizeOptionalTextField(payload, "publicMaterialsUpdatedDate")
  const publicInspectionDate = normalizeOptionalTextField(payload, "publicInspectionDate")
  const publicArchiveReviewStatus = normalizeOptionalTextField(payload, "publicArchiveReviewStatus")
  const seats = normalizeOptionalIntField(payload, "seats")
  const priceDay = normalizeOptionalIntField(payload, "priceDay")

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
  if (publicDescription !== undefined) {
    normalized.publicDescription = publicDescription
  }
  if (note !== undefined) {
    normalized.note = note
  }
  if (publicMaterialsUpdatedDate !== undefined) {
    normalized.publicMaterialsUpdatedDate = publicMaterialsUpdatedDate
  }
  if (publicInspectionDate !== undefined) {
    normalized.publicInspectionDate = publicInspectionDate
  }
  if (publicArchiveReviewStatus !== undefined) {
    normalized.publicArchiveReviewStatus = publicArchiveReviewStatus
  }
  PUBLIC_ARCHIVE_TEXT_FIELDS.concat(INTERNAL_ARCHIVE_TEXT_FIELDS).forEach((field) => {
    const value = normalizeOptionalTextField(payload, field)
    if (value !== undefined) {
      normalized[field] = value
    }
  })
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
  if (payload.rentalDiscountTiers !== undefined) {
    normalized.rentalDiscountTiers = payload.rentalDiscountTiers
  }

  const normalizedPerformance = normalizePerformanceInput(payload.performance)
  if (normalizedPerformance !== undefined) {
    normalized.performance = normalizedPerformance
  }

  return normalized
}

function validateVehicle(input) {
  const value = normalizeVehicleInput(input)
  const errors = []
  if (value.rentalDiscountTiers !== undefined) {
    const message = validateRentalDiscountTiers(value.rentalDiscountTiers)
    if (message) errors.push({ field: "rentalDiscountTiers", message })
    else value.rentalDiscountTiers = normalizeRentalDiscountTiers(value.rentalDiscountTiers)
  }

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

  if (value.publicDescription !== undefined && value.publicDescription.length > 200) {
    errors.push({
      field: "publicDescription",
      message: "公开说明长度不能超过 200",
      value: value.publicDescription
    })
  }

  ;["publicMaterialsUpdatedDate", "publicInspectionDate"].forEach((field) => {
    if (!value[field]) {
      return
    }
    const dateCheck = isValidYmdDate(value[field])
    if (!dateCheck.ok) {
      errors.push({
        field,
        message: dateCheck.reason === "FUTURE" ? "日期不得晚于今天" : "日期格式不合法（YYYY-MM-DD）",
        value: value[field],
        reason: dateCheck.reason
      })
    }
  })

  if (
    value.publicArchiveReviewStatus &&
    !ARCHIVE_REVIEW_STATUSES.includes(value.publicArchiveReviewStatus)
  ) {
    errors.push({
      field: "publicArchiveReviewStatus",
      message: "公开档案复核状态不合法",
      value: value.publicArchiveReviewStatus,
      allowed: ARCHIVE_REVIEW_STATUSES
    })
  }

  PUBLIC_ARCHIVE_TEXT_FIELDS.forEach((field) => {
    if (value[field] !== undefined && value[field].length > 200) {
      errors.push({ field, message: "公开摘要长度不能超过 200", value: value[field] })
    }
  })

  INTERNAL_ARCHIVE_TEXT_FIELDS.forEach((field) => {
    if (value[field] !== undefined && value[field].length > 500) {
      errors.push({ field, message: "内部记录长度不能超过 500", value: value[field] })
    }
  })

  if (value.location !== undefined) {
    if (value.location.length > 20) {
      errors.push({ field: "location", message: "城市长度不能超过 20", value: value.location })
    }
  }

  if (value.seats !== undefined && value.seats !== null) {
    if (!Number.isInteger(value.seats) || value.seats < 1 || value.seats > 9) {
      errors.push({ field: "seats", message: "座位数需为 1-9 的整数", value: value.seats })
    }
  }

  if (value.priceDay !== undefined && value.priceDay !== null) {
    if (!Number.isInteger(value.priceDay) || value.priceDay < 0 || value.priceDay > 99999) {
      errors.push({ field: "priceDay", message: "日租金需为 0-99999 的整数", value: value.priceDay })
    }
  }

  if (value.performance !== undefined && value.performance !== null) {
    const perf = value.performance
    if (perf.acceleration !== undefined && perf.acceleration !== "") {
      if (String(perf.acceleration).length > 20 || !PERFORMANCE_ACCELERATION_RE.test(String(perf.acceleration))) {
        errors.push({ field: "performance.acceleration", message: "百公里加速格式不合法（如 3.4s 或 6.5）", value: perf.acceleration })
      }
    }
    if (perf.horsepower !== undefined && perf.horsepower !== "") {
      if (String(perf.horsepower).length > 20 || !PERFORMANCE_HORSEPOWER_RE.test(String(perf.horsepower))) {
        errors.push({ field: "performance.horsepower", message: "马力格式不合法（如 450Ps、300kW、280匹）", value: perf.horsepower })
      }
    }
    if (perf.torque !== undefined && perf.torque !== "") {
      if (String(perf.torque).length > 20 || !PERFORMANCE_TORQUE_RE.test(String(perf.torque))) {
        errors.push({ field: "performance.torque", message: "扭矩格式不合法（如 530N·m、380牛米）", value: perf.torque })
      }
    }
    if (perf.drivetrain !== undefined && perf.drivetrain !== "") {
      const driveStr = String(perf.drivetrain)
      if (driveStr.length > 30) {
        errors.push({ field: "performance.drivetrain", message: "驱动方式长度不能超过 30", value: driveStr })
      }
    }
    if (Array.isArray(perf.highlights)) {
      if (perf.highlights.length > 8) {
        errors.push({ field: "performance.highlights", message: "配置标签不能超过 8 项", value: perf.highlights.length })
      }
      perf.highlights.forEach((tag, idx) => {
        if (typeof tag !== "string" || tag.length === 0 || tag.length > 20) {
          errors.push({ field: `performance.highlights[${idx}]`, message: "每项配置标签需为 1-20 字", value: tag })
        }
      })
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
  ARCHIVE_REVIEW_STATUSES,
  DRIVETRAIN_OPTIONS,
  PERFORMANCE_TEXT_FIELDS,
  PUBLIC_ARCHIVE_TEXT_FIELDS,
  INTERNAL_ARCHIVE_TEXT_FIELDS,
  REQUIRED_FIELDS,
  normalizePlateNumber,
  normalizeOptionalText,
  normalizeOptionalInt,
  normalizePerformanceInput,
  isValidPlateNumber,
  buildVehicleDisplayIdentity,
  isValidYmdDate,
  normalizeVehicleInput,
  validateVehicle,
  createError,
  createOk
}
