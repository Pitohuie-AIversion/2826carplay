const REQUIRED_FIELDS = [
  { key: "plateNumber", label: "车牌号" },
  { key: "vehicleType", label: "车辆类型" },
  { key: "brandModel", label: "品牌型号" },
  { key: "registerDate", label: "注册日期" },
  { key: "status", label: "使用状态" }
]

function hasValue(value) {
  return String(value === undefined || value === null ? "" : value).trim().length > 0
}

function buildVehicleFormProgress(form) {
  const source = form && typeof form === "object" ? form : {}
  const missing = REQUIRED_FIELDS.filter((field) => !hasValue(source[field.key]))
  const completed = REQUIRED_FIELDS.length - missing.length
  const ready = missing.length === 0

  return {
    completed,
    total: REQUIRED_FIELDS.length,
    percent: Math.round((completed / REQUIRED_FIELDS.length) * 100),
    ready,
    plateNumberComplete: hasValue(source.plateNumber),
    vehicleTypeComplete: hasValue(source.vehicleType),
    brandModelComplete: hasValue(source.brandModel),
    registerDateComplete: hasValue(source.registerDate),
    statusComplete: hasValue(source.status),
    nextField: ready ? "" : missing[0].key,
    hint: ready ? "必填信息已完整，可以提交" : `下一项：填写${missing[0].label}`
  }
}

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

/**
 * 清洗并截断车辆表单通用文本字段输入
 * @param {string} field 字段名
 * @param {any} rawValue 用户输入值
 * @returns {any} 清洗并截断后的值
 */
function cleanVehicleTextInput(field, rawValue) {
  let value = rawValue
  if (field === "brandModel") {
    value = String(value || "").slice(0, 50)
  }
  if (field === "location") {
    value = String(value || "").slice(0, 20)
  }
  if (field === "vin" || field === "engineNumber") {
    value = String(value || "").slice(0, 32)
  }
  if (field === "publicDrivingTips") {
    value = String(value || "").slice(0, 500)
  }
  if (field === "publicDescription" || field === "note") {
    value = String(value || "").slice(0, 200)
  }
  if (PUBLIC_ARCHIVE_TEXT_FIELDS.includes(field)) {
    value = String(value || "").slice(0, 200)
  }
  if (INTERNAL_ARCHIVE_TEXT_FIELDS.includes(field)) {
    value = String(value || "").slice(0, 500)
  }
  if (field === "seats") {
    value = String(value || "").replace(/\D/g, "").slice(0, 1)
  }
  if (field === "priceDay") {
    value = String(value || "").replace(/\D/g, "").slice(0, 5)
  }
  return value
}

/**
 * 清洗并截断车辆性能参数字段输入
 * @param {string} field 性能字段（acceleration, horsepower, torque 等）
 * @param {any} rawValue 用户输入值
 * @returns {string} 清洗后的文本
 */
function cleanPerformanceValue(field, rawValue) {
  const value = String(rawValue || "")
  if (field === "acceleration") {
    return value.replace(/[^\d.s秒]/g, "").slice(0, 12)
  }
  if (field === "horsepower") {
    return value.replace(/[^\d.kKwWpPsShH匹马力千瓦]/g, "").slice(0, 16)
  }
  if (field === "torque") {
    return value.replace(/[^\d.nN·mM牛米]/g, "").slice(0, 18)
  }
  return value.slice(0, 30)
}

/**
 * 生成清空选填字段的 patch 对象
 * @param {string} field 字段路径
 * @returns {object|null}
 */
function getClearOptionalFieldPatch(field) {
  const allowed = [
    "archiveDate",
    "archiveReview",
    "publicMaterialsUpdatedDate",
    "publicInspectionDate",
    "performance.drivetrain",
    "transmission",
    "fuelType"
  ]
  if (!allowed.includes(field)) {
    return null
  }
  const patch = { [`form.${field}`]: "" }
  if (field === "performance.drivetrain") {
    patch.drivetrainIndex = -1
    patch.drivetrainLabel = ""
  }
  if (field === "transmission" || field === "fuelType") {
    patch[`${field}Index`] = 0
    patch[`${field}Label`] = ""
  }
  return patch
}

module.exports = {
  REQUIRED_FIELDS,
  PUBLIC_ARCHIVE_TEXT_FIELDS,
  INTERNAL_ARCHIVE_TEXT_FIELDS,
  buildVehicleFormProgress,
  cleanVehicleTextInput,
  cleanPerformanceValue,
  getClearOptionalFieldPatch
}

