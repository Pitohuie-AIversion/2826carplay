const STATUS_TEXT_MAP = {
  pending: "待联系",
  contacted: "已联系",
  quoted: "已报价",
  adjustment_requested: "待调整",
  confirmed: "已确认",
  completed: "已完成",
  cancelled: "已取消"
}
const STATUS_CLASS_MAP = {
  pending: "status-pending",
  contacted: "status-contacted",
  quoted: "status-quoted",
  adjustment_requested: "status-adjustment-requested",
  confirmed: "status-confirmed",
  completed: "status-completed",
  cancelled: "status-cancelled"
}
function mapStatusText(status) {
  const value = String(status || "").trim()
  return STATUS_TEXT_MAP[value] || "待联系"
}
function mapStatusClass(status) {
  const value = String(status || "").trim()
  return STATUS_CLASS_MAP[value] || "status-pending"
}
function canCancelBooking(status) {
  const value = String(status || "").trim()
  return ["pending", "contacted", "quoted", "adjustment_requested", "confirmed"].includes(value)
}
function canEditBooking(status) {
  const value = String(status || "").trim()
  return value === "pending" || value === "contacted"
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待联系" },
  { value: "contacted", label: "已联系" },
  { value: "quoted", label: "已报价" },
  { value: "adjustment_requested", label: "待调整" },
  { value: "confirmed", label: "已确认" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" }
]

const PRIORITY_TEXT_MAP = {
  priority: "优先",
  normal: "常规",
  standby: "候补"
}

const PRIORITY_OPTIONS = [
  { value: "all", label: "全部级别" },
  { value: "priority", label: "优先" },
  { value: "normal", label: "常规" },
  { value: "standby", label: "候补" }
]

const COORDINATION_TEXT_MAP = {
  pending: "待协调",
  coordinating: "协调中",
  resolved: "已协调"
}

const COORDINATION_OPTIONS = [
  { value: "all", label: "全部进度" },
  { value: "pending", label: "待协调" },
  { value: "coordinating", label: "协调中" },
  { value: "resolved", label: "已协调" }
]

function mapPriorityText(priority, fallback = "常规") {
  const value = String(priority || "").trim()
  return PRIORITY_TEXT_MAP[value] || fallback
}

function mapCoordinationText(coordination, fallback = "待协调") {
  const value = String(coordination || "").trim()
  return COORDINATION_TEXT_MAP[value] || fallback
}

const WORKBENCH_PRIORITY_OPTIONS = [
  { key: "priority", label: "优先" },
  { key: "normal", label: "常规" },
  { key: "standby", label: "候补" }
]

module.exports = {
  STATUS_TEXT_MAP,
  STATUS_CLASS_MAP,
  STATUS_OPTIONS,
  PRIORITY_TEXT_MAP,
  PRIORITY_OPTIONS,
  WORKBENCH_PRIORITY_OPTIONS,
  COORDINATION_TEXT_MAP,
  COORDINATION_OPTIONS,
  mapStatusText,
  mapStatusClass,
  mapPriorityText,
  mapCoordinationText,
  canCancelBooking,
  canEditBooking
}
