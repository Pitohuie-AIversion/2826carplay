/**
 * 极境车库 - 车辆展示枚举与元数据字典 (Vehicle Display Labels & Options)
 *
 * 统一管理用户端与管理端车辆类型、能源动力、变速箱、运营状态文案与样式映射，
 * 消除多页面重复硬编码，便于未来拓展新车型与新状态。
 */

const VEHICLE_TYPE_LABEL_MAP = {
  sedan: "轿车",
  suv: "SUV",
  mpv: "MPV",
  sports: "跑车",
  truck: "卡车",
  other: "其他"
}

const STATUS_LABEL_MAP = {
  active: "在用",
  idle: "闲置",
  maintenance: "维修",
  retired: "停用"
}

const STATUS_CLASS_MAP = {
  active: "status-active",
  idle: "status-idle",
  maintenance: "status-maintenance",
  retired: "status-retired"
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "active", label: "在用" },
  { value: "idle", label: "闲置" },
  { value: "maintenance", label: "维修" },
  { value: "retired", label: "停用" }
]

const STATUS_OP_OPTIONS = [
  { value: "idle", label: "设为闲置" },
  { value: "active", label: "设为在用" },
  { value: "maintenance", label: "设为维修" }
]

const TRANSMISSION_LABEL_MAP = {
  manual: "手动挡",
  automatic: "自动挡"
}

const FUEL_TYPE_LABEL_MAP = {
  gasoline: "燃油",
  electric: "纯电",
  hybrid: "混动"
}

const ARCHIVE_REVIEW_LABEL_MAP = {
  pending: "待复核",
  reviewed: "已复核"
}

const CATEGORY_LABEL_MAP = {
  all: "全部",
  luxury_sedan: "豪华轿车",
  city_suv: "城市SUV",
  offroad: "硬派越野",
  supercar: "超级跑车",
  commuter_ev: "代步电车",
  pickup: "皮卡"
}

function getVehicleTypeLabel(type, fallback = "其他") {
  return (type && VEHICLE_TYPE_LABEL_MAP[type]) || fallback
}

function getVehicleStatusLabel(status, fallback = "未知") {
  return (status && STATUS_LABEL_MAP[status]) || fallback
}

function getVehicleStatusClass(status, fallback = "status-pending") {
  return (status && STATUS_CLASS_MAP[status]) || fallback
}

function getTransmissionLabel(transmission, fallback = "未知") {
  return (transmission && TRANSMISSION_LABEL_MAP[transmission]) || fallback
}

function getFuelTypeLabel(fuelType, fallback = "未知") {
  return (fuelType && FUEL_TYPE_LABEL_MAP[fuelType]) || fallback
}

const CLIENT_VEHICLE_STATUS_TEXT_MAP = {
  idle: "可预约",
  available: "可预约",
  active: "使用中",
  rented: "使用中",
  maintenance: "维护中",
  reserved: "已预约"
}

const CLIENT_VEHICLE_STATUS_CLASS_MAP = {
  idle: "status-idle",
  available: "status-idle",
  active: "status-active",
  rented: "status-active",
  maintenance: "status-maintenance",
  reserved: "status-reserved"
}

function getClientVehicleStatusText(status, fallbackText = "可预约") {
  const value = String(status || "").trim()
  return CLIENT_VEHICLE_STATUS_TEXT_MAP[value] || fallbackText
}

function getClientVehicleStatusClass(status, fallbackClass = "status-idle") {
  const value = String(status || "").trim()
  return CLIENT_VEHICLE_STATUS_CLASS_MAP[value] || fallbackClass
}

const FAVORITE_VEHICLE_STATUS_MAP = {
  idle: {
    status: "available",
    statusText: "可预约",
    statusClass: "status-available"
  },
  available: {
    status: "available",
    statusText: "可预约",
    statusClass: "status-available"
  },
  active: {
    status: "rented",
    statusText: "使用中",
    statusClass: "status-rented"
  },
  rented: {
    status: "rented",
    statusText: "使用中",
    statusClass: "status-rented"
  },
  maintenance: {
    status: "maintenance",
    statusText: "维护中",
    statusClass: "status-maintenance"
  },
  reserved: {
    status: "reserved",
    statusText: "已预约",
    statusClass: "status-reserved"
  }
}

function normalizeFavoriteVehicleStatus(status) {
  const value = String(status || "").trim()
  return Object.prototype.hasOwnProperty.call(FAVORITE_VEHICLE_STATUS_MAP, value)
    ? FAVORITE_VEHICLE_STATUS_MAP[value]
    : { status: "unknown", statusText: "状态待确认", statusClass: "status-pending" }
}

module.exports = {
  VEHICLE_TYPE_LABEL_MAP,
  STATUS_LABEL_MAP,
  STATUS_CLASS_MAP,
  STATUS_OPTIONS,
  STATUS_OP_OPTIONS,
  TRANSMISSION_LABEL_MAP,
  FUEL_TYPE_LABEL_MAP,
  ARCHIVE_REVIEW_LABEL_MAP,
  CATEGORY_LABEL_MAP,
  CLIENT_VEHICLE_STATUS_TEXT_MAP,
  CLIENT_VEHICLE_STATUS_CLASS_MAP,
  FAVORITE_VEHICLE_STATUS_MAP,
  normalizeFavoriteVehicleStatus,
  getVehicleTypeLabel,
  getVehicleStatusLabel,
  getVehicleStatusClass,
  getTransmissionLabel,
  getFuelTypeLabel,
  getClientVehicleStatusText,
  getClientVehicleStatusClass
}
