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

module.exports = {
  STATUS_TEXT_MAP,
  STATUS_CLASS_MAP,
  mapStatusText,
  mapStatusClass,
  canCancelBooking,
  canEditBooking
}
