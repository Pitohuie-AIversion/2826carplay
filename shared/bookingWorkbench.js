const OVERDUE_MS = 24 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const PRIORITY_VALUES = ["priority", "normal", "standby"]
const COORDINATION_VALUES = ["pending", "coordinating", "resolved"]
const ACTIVE_STATUSES = ["pending", "contacted"]
const MODE_VALUES = [
  "todo",
  "pending",
  "priority",
  "overdue",
  "pickupAttention",
  "contactIssue",
  "standby",
  "coordinating"
]

function toTimestamp(value) {
  if (!value) {
    return 0
  }
  if (value instanceof Date) {
    return value.getTime() || 0
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().getTime() || 0
  }
  return new Date(value).getTime() || 0
}

function normalizeUsablePhone(value) {
  const phone = String(value || "").trim()
  const digitCount = phone.replace(/\D/g, "").length
  if (!/^\+?[0-9-]{6,20}$/.test(phone) || digitCount < 6 || digitCount > 15) {
    return ""
  }
  return phone
}

function toDateDayNumber(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!match) {
    return null
  }
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const timestamp = Date.UTC(year, month - 1, day)
  const date = new Date(timestamp)
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null
  }
  return Math.floor(timestamp / DAY_MS)
}

function toLocalDayNumber(timestamp) {
  const date = new Date(timestamp)
  return Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY_MS
  )
}

function normalizeBooking(item, now) {
  const source = item && typeof item === "object" ? item : {}
  const status = String(source.status || "pending").trim() || "pending"
  const schedulePriority = PRIORITY_VALUES.includes(source.schedulePriority)
    ? source.schedulePriority
    : "normal"
  const coordinationStatus =
    status === "completed" || status === "cancelled"
      ? "resolved"
      : COORDINATION_VALUES.includes(source.coordinationStatus)
        ? source.coordinationStatus
        : "pending"
  const createdTimestamp = toTimestamp(source.createdAt)
  const waitingMs = createdTimestamp ? Math.max(0, now - createdTimestamp) : 0
  const active = ACTIVE_STATUSES.includes(status)
  const todo = active && coordinationStatus !== "resolved"
  const overdue =
    todo &&
    coordinationStatus === "pending" &&
    Boolean(createdTimestamp) &&
    waitingMs >= OVERDUE_MS
  const pickupDay = toDateDayNumber(source.startDate)
  const pickupDays =
    pickupDay === null ? null : pickupDay - toLocalDayNumber(now)
  const pickupAttention =
    todo &&
    pickupDays !== null &&
    pickupDays <= 7
  const phoneAvailable = Boolean(normalizeUsablePhone(source.phone))
  const contactIssue = todo && !phoneAvailable
  const waitingHours = Math.floor(waitingMs / (60 * 60 * 1000))
  const waitingText = !createdTimestamp
    ? "提交时间待确认"
    : waitingHours < 1
      ? "等待不足 1 小时"
      : waitingHours < 24
        ? `已等待 ${waitingHours} 小时`
        : `已等待 ${Math.floor(waitingHours / 24)} 天`
  const badges = []

  if (overdue) {
    badges.push({ key: "overdue", text: "超时未处理", tone: "danger" })
  }
  if (pickupAttention) {
    const text =
      pickupDays < 0
        ? "用车日已过"
        : pickupDays === 0
          ? "今天用车"
          : pickupDays === 1
            ? "明天用车"
            : `${pickupDays} 天后用车`
    badges.push({
      key: "pickupAttention",
      text,
      tone: pickupDays <= 0 ? "danger" : "warning"
    })
  }
  if (schedulePriority === "priority") {
    badges.push({ key: "priority", text: "优先", tone: "warning" })
  } else if (schedulePriority === "standby") {
    badges.push({ key: "standby", text: "候补", tone: "muted" })
  }
  if (coordinationStatus === "coordinating") {
    badges.push({ key: "coordinating", text: "协调中", tone: "primary" })
  } else if (coordinationStatus === "pending" && !overdue) {
    badges.push({ key: "pending", text: "待协调", tone: "warning" })
  }

  let score = 0
  if (overdue) {
    score += 100
  }
  if (pickupAttention) {
    if (pickupDays < 0) {
      score += 90
    } else if (pickupDays === 0) {
      score += 80
    } else if (pickupDays === 1) {
      score += 65
    } else {
      score += 35
    }
  }
  if (contactIssue) {
    score += 55
  }
  if (schedulePriority === "priority") {
    score += 60
  } else if (schedulePriority === "standby") {
    score += 20
  }
  if (coordinationStatus === "coordinating") {
    score += 40
  } else if (coordinationStatus === "pending") {
    score += 10
  }

  return {
    ...source,
    id: String(source.id || source._id || "").trim(),
    status,
    schedulePriority,
    coordinationStatus,
    createdTimestamp,
    waitingHours,
    waitingText,
    active,
    todo,
    overdue,
    pickupDays,
    pickupAttention,
    phoneAvailable,
    contactIssue,
    badges,
    score
  }
}

function matchesMode(item, mode) {
  if (mode === "pending") {
    return item.todo && item.coordinationStatus === "pending"
  }
  if (mode === "priority") {
    return item.todo && item.schedulePriority === "priority"
  }
  if (mode === "overdue") {
    return item.overdue
  }
  if (mode === "pickupAttention") {
    return item.pickupAttention
  }
  if (mode === "contactIssue") {
    return item.contactIssue
  }
  if (mode === "standby") {
    return item.todo && item.schedulePriority === "standby"
  }
  if (mode === "coordinating") {
    return item.todo && item.coordinationStatus === "coordinating"
  }
  return item.todo
}

function buildBookingWorkbench(bookings, selectedMode, nowValue) {
  const now = Number.isFinite(Number(nowValue)) ? Number(nowValue) : Date.now()
  const mode = MODE_VALUES.includes(selectedMode) ? selectedMode : "todo"
  const normalized = (Array.isArray(bookings) ? bookings : []).map((item) =>
    normalizeBooking(item, now)
  )
  const active = normalized.filter((item) => item.active)
  const todo = active.filter((item) => item.todo)
  const queue = active
    .filter((item) => matchesMode(item, mode))
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }
      const leftTime = left.createdTimestamp || Number.MAX_SAFE_INTEGER
      const rightTime = right.createdTimestamp || Number.MAX_SAFE_INTEGER
      return leftTime - rightTime || left.id.localeCompare(right.id)
    })

  return {
    mode,
    queue,
    summary: {
      todo: todo.length,
      pending: todo.filter((item) => item.coordinationStatus === "pending").length,
      priority: todo.filter((item) => item.schedulePriority === "priority").length,
      overdue: todo.filter((item) => item.overdue).length,
      pickupAttention: todo.filter((item) => item.pickupAttention).length,
      contactIssue: todo.filter((item) => item.contactIssue).length,
      standby: todo.filter((item) => item.schedulePriority === "standby").length,
      coordinating: todo.filter((item) => item.coordinationStatus === "coordinating").length
    }
  }
}

module.exports = {
  OVERDUE_MS,
  normalizeUsablePhone,
  toDateDayNumber,
  normalizeBooking,
  buildBookingWorkbench
}
