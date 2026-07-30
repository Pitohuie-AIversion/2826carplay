function pad(value) {
  return String(value).padStart(2, "0")
}

function normalizeMonthKey(value) {
  const text = String(value || "")
  const match = text.match(/^(\d{4})-(\d{2})$/)
  if (match) {
    const month = Number(match[2])
    if (month >= 1 && month <= 12) {
      return `${match[1]}-${match[2]}`
    }
  }
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
}

function shiftMonth(monthKey, offset) {
  const normalized = normalizeMonthKey(monthKey)
  const [year, month] = normalized.split("-").map(Number)
  const date = new Date(year, month - 1 + Number(offset || 0), 1)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`
}

function formatMonthTitle(monthKey) {
  const [year, month] = normalizeMonthKey(monthKey).split("-")
  return `${year} 年 ${Number(month)} 月`
}

function getConflictVehicleCount(bookings) {
  const vehicleCounts = new Map()
  const list = Array.isArray(bookings) ? bookings : []

  list.forEach((item) => {
    const vehicleId = String((item && item.vehicleId) || "").trim()
    if (!vehicleId) {
      return
    }
    vehicleCounts.set(vehicleId, (vehicleCounts.get(vehicleId) || 0) + 1)
  })

  return Array.from(vehicleCounts.values()).filter((count) => count > 1).length
}

function getConflictVehicleIds(bookings) {
  const vehicleCounts = new Map()
  const list = Array.isArray(bookings) ? bookings : []
  list.forEach((item) => {
    const vehicleId = String((item && item.vehicleId) || "").trim()
    if (vehicleId) {
      vehicleCounts.set(vehicleId, (vehicleCounts.get(vehicleId) || 0) + 1)
    }
  })
  return new Set(
    Array.from(vehicleCounts.entries())
      .filter((entry) => entry[1] > 1)
      .map((entry) => entry[0])
  )
}

function buildMonthView(monthKey, bookings, selectedDate) {
  const normalized = normalizeMonthKey(monthKey)
  const [year, month] = normalized.split("-").map(Number)
  const firstDate = new Date(year, month - 1, 1)
  const dayCount = new Date(year, month, 0).getDate()
  const monthStart = `${normalized}-01`
  const monthEnd = `${normalized}-${pad(dayCount)}`
  const todayDate = new Date()
  const today = `${todayDate.getFullYear()}-${pad(todayDate.getMonth() + 1)}-${pad(todayDate.getDate())}`
  const activeBookings = (Array.isArray(bookings) ? bookings : []).filter((item) => {
    if (String(item.status || "pending") === "cancelled") {
      return false
    }
    const startDate = String(item.startDate || "")
    const endDate = String(item.endDate || startDate)
    return (
      /^\d{4}-\d{2}-\d{2}$/.test(startDate) &&
      /^\d{4}-\d{2}-\d{2}$/.test(endDate) &&
      startDate <= endDate &&
      startDate <= monthEnd &&
      endDate >= monthStart
    )
  })
  const safeSelectedDate =
    String(selectedDate || "").startsWith(`${normalized}-`)
      ? String(selectedDate)
      : today.startsWith(`${normalized}-`)
        ? today
        : monthStart
  const cells = []

  for (let index = 0; index < firstDate.getDay(); index += 1) {
    cells.push({
      key: `empty-start-${index}`,
      empty: true
    })
  }

  for (let day = 1; day <= dayCount; day += 1) {
    const date = `${normalized}-${pad(day)}`
    const dayBookings = activeBookings.filter((item) => {
      const startDate = String(item.startDate || "")
      const endDate = String(item.endDate || startDate)
      return startDate <= date && endDate >= date
    })
    const conflictVehicleCount = getConflictVehicleCount(dayBookings)
    cells.push({
      key: date,
      date,
      day,
      empty: false,
      isToday: date === today,
      isSelected: date === safeSelectedDate,
      bookingCount: dayBookings.length,
      pendingCount: dayBookings.filter((item) => item.status === "pending").length,
      hasBookings: dayBookings.length > 0,
      hasConflict: conflictVehicleCount > 0,
      conflictVehicleCount
    })
  }

  while (cells.length % 7 !== 0) {
    cells.push({
      key: `empty-end-${cells.length}`,
      empty: true
    })
  }

  const selectedBookingsRaw = activeBookings
    .filter((item) => {
      const startDate = String(item.startDate || "")
      const endDate = String(item.endDate || startDate)
      return startDate <= safeSelectedDate && endDate >= safeSelectedDate
    })
    .slice()
    .sort((prev, next) => String(prev.startDate || "").localeCompare(String(next.startDate || "")))
  const conflictVehicleIds = getConflictVehicleIds(selectedBookingsRaw)
  const selectedBookings = selectedBookingsRaw.map((item) => ({
    ...item,
    hasConflict: conflictVehicleIds.has(String(item.vehicleId || "").trim())
  }))
  const selectedConflictCount = conflictVehicleIds.size

  return {
    monthKey: normalized,
    monthTitle: formatMonthTitle(normalized),
    selectedDate: safeSelectedDate,
    cells,
    selectedBookings,
    selectedConflictCount,
    summary: {
      bookingCount: activeBookings.length,
      pendingCount: activeBookings.filter((item) => item.status === "pending").length,
      vehicleCount: new Set(activeBookings.map((item) => item.vehicleId).filter(Boolean)).size,
      conflictDayCount: cells.filter((item) => !item.empty && item.hasConflict).length
    }
  }
}

module.exports = {
  normalizeMonthKey,
  shiftMonth,
  formatMonthTitle,
  getConflictVehicleCount,
  buildMonthView
}
