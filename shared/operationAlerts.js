const OVERDUE_PENDING_HOURS = 24
const QUOTE_EXPIRY_WARNING_HOURS = 48
const MAINTENANCE_WARNING_DAYS = 30
const COORDINATION_OVERDUE_HOURS = 48

const getTime = (d) => {
  const t = new Date(d).getTime()
  return Number.isNaN(t) ? null : t
}

function computeAlerts(bookings, vehicles, options) {
  const now = (options && options.now) || Date.now()
  const bList = Array.isArray(bookings) ? bookings : []
  const vList = Array.isArray(vehicles) ? vehicles : []
  const alerts = []

  // 1. Overdue pending
  const overduePending = bList.filter((b) => {
    if (String(b.status || "").trim() !== "pending") return false
    const t = getTime(b.createdAt)
    return t !== null && now - t > OVERDUE_PENDING_HOURS * 36e5
  })
  if (overduePending.length > 0) {
    const oldest = overduePending.reduce((a, b) => (getTime(a.createdAt) < getTime(b.createdAt) ? a : b))
    const hoursAgo = Math.floor((now - getTime(oldest.createdAt)) / 36e5)
    alerts.push({
      type: "overdue_pending",
      urgency: "high",
      title: `${overduePending.length} 条预约超 ${OVERDUE_PENDING_HOURS}h 未联系`,
      desc: `最早一条已等待 ${hoursAgo} 小时，建议尽快跟进`,
      actionRoute: "/pages/booking-workbench/booking-workbench",
      actionLabel: "进入工作台",
      relatedId: oldest._id || oldest.id || "",
      count: overduePending.length
    })
  }

  // 2. Expiring quotes
  const expiringQuotes = bList.filter((b) => {
    if (String(b.status || "").trim() !== "quoted") return false
    const q = b.latestQuote || b.quote
    if (!q || !q.validUntil) return false
    const t = getTime(q.validUntil)
    return t !== null && t - now > 0 && t - now <= QUOTE_EXPIRY_WARNING_HOURS * 36e5
  })
  if (expiringQuotes.length > 0) {
    const getQ = (item) => getTime((item.latestQuote || item.quote || {}).validUntil)
    const soonest = expiringQuotes.reduce((a, b) => (getQ(a) < getQ(b) ? a : b))
    const hoursLeft = Math.floor((getQ(soonest) - now) / 36e5)
    alerts.push({
      type: "expiring_quote",
      urgency: "medium",
      title: `${expiringQuotes.length} 条报价即将过期`,
      desc: `最近一条将在 ${hoursLeft} 小时后失效`,
      actionRoute: "/pages/booking-manage/booking-manage",
      actionLabel: "查看报价",
      relatedId: soonest._id || soonest.id || "",
      count: expiringQuotes.length
    })
  }

  // 3. Maintenance due
  const maintenanceDue = vList.filter((v) => {
    const d = v.archiveDate || v.nextMaintenanceDate
    if (!d) return false
    const t = getTime(d)
    return t !== null && t - now >= 0 && t - now <= MAINTENANCE_WARNING_DAYS * 864e5
  })
  if (maintenanceDue.length > 0) {
    const getV = (v) => getTime(v.archiveDate || v.nextMaintenanceDate)
    const nearest = maintenanceDue.reduce((a, b) => (getV(a) < getV(b) ? a : b))
    const daysLeft = Math.floor((getV(nearest) - now) / 864e5)
    alerts.push({
      type: "maintenance_due",
      urgency: "low",
      title: `${maintenanceDue.length} 辆车维保临期`,
      desc: `最近一辆将在 ${daysLeft} 天后到期`,
      actionRoute: "/pages-admin/vehicle-manage/vehicle-manage",
      actionLabel: "查看车辆",
      relatedId: nearest._id || nearest.id || "",
      count: maintenanceDue.length
    })
  }

  // 4. Overdue coordination
  const overdueCoordination = bList.filter((b) => {
    if (String(b.coordinationStatus || "").trim() !== "pending") return false
    const t = getTime(b.coordinationUpdatedAt || b.createdAt)
    return t !== null && now - t > COORDINATION_OVERDUE_HOURS * 36e5
  })
  if (overdueCoordination.length > 0) {
    alerts.push({
      type: "overdue_coordination",
      urgency: "medium",
      title: `${overdueCoordination.length} 条协调超 ${COORDINATION_OVERDUE_HOURS}h 未处理`,
      desc: "长时间待协调可能影响客户体验",
      actionRoute: "/pages/booking-workbench/booking-workbench",
      actionLabel: "进入工作台",
      relatedId: overdueCoordination[0]._id || overdueCoordination[0].id || "",
      count: overdueCoordination.length
    })
  }

  const PRIORITY = { high: 1, medium: 2, low: 3 }
  alerts.sort((a, b) => (PRIORITY[a.urgency] || 9) - (PRIORITY[b.urgency] || 9))
  return alerts
}

module.exports = {
  computeAlerts,
  OVERDUE_PENDING_HOURS,
  QUOTE_EXPIRY_WARNING_HOURS,
  MAINTENANCE_WARNING_DAYS,
  COORDINATION_OVERDUE_HOURS
}
