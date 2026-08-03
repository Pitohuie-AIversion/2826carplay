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

module.exports = {
  REQUIRED_FIELDS,
  buildVehicleFormProgress
}
