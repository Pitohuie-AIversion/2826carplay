/**
 * 极境车库 - 车队维保与年检计划看板状态核算
 */

const ONE_DAY_MS = 24 * 60 * 60 * 1000

function parseLocalDate(dateStr) {
  if (!dateStr || typeof dateStr !== "string") return null
  const m = dateStr.trim().match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/)
  if (!m) return null
  const y = Number(m[1])
  const mon = Number(m[2]) - 1
  const d = Number(m[3])
  const dt = new Date(y, mon, d)
  return Number.isNaN(dt.getTime()) ? null : dt
}

function calculateDaysDiff(targetDateStr, baseDateInput) {
  const target = parseLocalDate(targetDateStr)
  if (!target) return null
  const base = baseDateInput instanceof Date ? baseDateInput : new Date()
  const baseMidnight = new Date(base.getFullYear(), base.getMonth(), base.getDate())
  const targetMidnight = new Date(target.getFullYear(), target.getMonth(), target.getDate())
  return Math.round((targetMidnight.getTime() - baseMidnight.getTime()) / ONE_DAY_MS)
}

function calculateMaintenanceHealth(vehicleInput, baseDate) {
  const vehicle = vehicleInput && typeof vehicleInput === "object" ? vehicleInput : {}
  const archiveDate = vehicle.archiveDate || ""
  const archiveReview = vehicle.archiveReview || ""

  const daysToMaintenance = calculateDaysDiff(archiveDate, baseDate)
  const daysToReview = calculateDaysDiff(archiveReview, baseDate)

  let urgency = "untracked"
  let tip = "维保日期待录入"
  let isOverdue = false

  if (daysToMaintenance !== null || daysToReview !== null) {
    const minDays = Math.min(
      daysToMaintenance !== null ? daysToMaintenance : Infinity,
      daysToReview !== null ? daysToReview : Infinity
    )

    if (minDays < 0) {
      urgency = "urgent"
      isOverdue = true
      if (daysToMaintenance !== null && daysToMaintenance < 0) {
        tip = `保养已逾期 ${Math.abs(daysToMaintenance)} 天`
      } else {
        tip = `年检已逾期 ${Math.abs(daysToReview)} 天`
      }
    } else if (minDays <= 7) {
      urgency = "urgent"
      tip = minDays === 0 ? "今日到期需维保" : `${minDays} 天内需维保`
    } else if (minDays <= 30) {
      urgency = "upcoming"
      tip = `本月内需保养 (${minDays}天)`
    } else {
      urgency = "healthy"
      tip = "维保状态正常"
    }
  }

  return {
    vehicleId: String(vehicle.id || vehicle._id || ""),
    daysToMaintenance,
    daysToReview,
    urgency,
    tip,
    isOverdue,
    archiveDate,
    archiveReview
  }
}

function buildFleetMaintenanceSummary(vehicles, baseDate) {
  const list = Array.isArray(vehicles) ? vehicles : []
  let urgentCount = 0
  let upcomingCount = 0
  let healthyCount = 0
  let untrackedCount = 0

  list.forEach((v) => {
    const health = calculateMaintenanceHealth(v, baseDate)
    if (health.urgency === "urgent") urgentCount++
    else if (health.urgency === "upcoming") upcomingCount++
    else if (health.urgency === "healthy") healthyCount++
    else untrackedCount++
  })

  return {
    total: list.length,
    urgentCount,
    upcomingCount,
    healthyCount,
    untrackedCount,
    attentionRequired: urgentCount + upcomingCount
  }
}

module.exports = {
  parseLocalDate,
  calculateDaysDiff,
  calculateMaintenanceHealth,
  buildFleetMaintenanceSummary
}
