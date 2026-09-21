const {
  calculateDaysDiff,
  calculateMaintenanceHealth,
  buildFleetMaintenanceSummary
} = require("../shared/vehicleMaintenance")

describe("vehicleMaintenance helper", () => {
  const baseDate = new Date(2026, 8, 20) // 2026-09-20

  test("calculateDaysDiff 精确计算日期跨度", () => {
    expect(calculateDaysDiff("2026-09-25", baseDate)).toBe(5)
    expect(calculateDaysDiff("2026-09-20", baseDate)).toBe(0)
    expect(calculateDaysDiff("2026-09-18", baseDate)).toBe(-2)
    expect(calculateDaysDiff("invalid-date", baseDate)).toBeNull()
    expect(calculateDaysDiff("", baseDate)).toBeNull()
  })

  test("calculateMaintenanceHealth 正确划定紧迫度等级", () => {
    // 逾期情况
    const overdueCar = { id: "c1", archiveDate: "2026-09-15" }
    const resOverdue = calculateMaintenanceHealth(overdueCar, baseDate)
    expect(resOverdue.urgency).toBe("urgent")
    expect(resOverdue.isOverdue).toBe(true)
    expect(resOverdue.tip).toContain("已逾期 5 天")

    // 7天内即将到期
    const imminentCar = { id: "c2", archiveReview: "2026-09-23" }
    const resImminent = calculateMaintenanceHealth(imminentCar, baseDate)
    expect(resImminent.urgency).toBe("urgent")
    expect(resImminent.isOverdue).toBe(false)
    expect(resImminent.tip).toContain("3 天内需维保")

    // 30天内到期
    const upcomingCar = { id: "c3", archiveDate: "2026-10-10" }
    const resUpcoming = calculateMaintenanceHealth(upcomingCar, baseDate)
    expect(resUpcoming.urgency).toBe("upcoming")
    expect(resUpcoming.tip).toContain("本月内需保养")

    // 正常状态 (超过30天)
    const healthyCar = { id: "c4", archiveDate: "2026-12-01", archiveReview: "2027-01-01" }
    const resHealthy = calculateMaintenanceHealth(healthyCar, baseDate)
    expect(resHealthy.urgency).toBe("healthy")
    expect(resHealthy.tip).toBe("维保状态正常")

    // 未设置维保信息
    const untrackedCar = { id: "c5" }
    const resUntracked = calculateMaintenanceHealth(untrackedCar, baseDate)
    expect(resUntracked.urgency).toBe("untracked")
  })

  test("buildFleetMaintenanceSummary 聚合车队维保概览统计", () => {
    const fleet = [
      { id: "c1", archiveDate: "2026-09-15" }, // urgent (overdue)
      { id: "c2", archiveReview: "2026-09-23" }, // urgent (3 days)
      { id: "c3", archiveDate: "2026-10-10" }, // upcoming (20 days)
      { id: "c4", archiveDate: "2026-12-01" }, // healthy
      { id: "c5" } // untracked
    ]

    const summary = buildFleetMaintenanceSummary(fleet, baseDate)

    expect(summary.total).toBe(5)
    expect(summary.urgentCount).toBe(2)
    expect(summary.upcomingCount).toBe(1)
    expect(summary.healthyCount).toBe(1)
    expect(summary.untrackedCount).toBe(1)
    expect(summary.attentionRequired).toBe(3)
  })
})
