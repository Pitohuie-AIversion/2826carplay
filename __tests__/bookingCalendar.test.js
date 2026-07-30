const {
  normalizeMonthKey,
  shiftMonth,
  formatMonthTitle,
  buildMonthView
} = require("../shared/bookingCalendar")

describe("shared/bookingCalendar", () => {
  test("跨年切换月份并格式化标题", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01")
    expect(shiftMonth("2026-01", -1)).toBe("2025-12")
    expect(formatMonthTitle("2026-07")).toBe("2026 年 7 月")
    expect(normalizeMonthKey("2026-13")).toMatch(/^\d{4}-\d{2}$/)
  })

  test("跨日期预约会占用范围内的每一天", () => {
    const view = buildMonthView(
      "2026-07",
      [
        {
          id: "booking_1",
          vehicleId: "vehicle_1",
          startDate: "2026-07-10",
          endDate: "2026-07-12",
          status: "pending"
        },
        {
          id: "booking_2",
          vehicleId: "vehicle_2",
          startDate: "2026-07-11",
          endDate: "2026-07-11",
          status: "contacted"
        }
      ],
      "2026-07-11"
    )

    expect(view.summary).toEqual({
      bookingCount: 2,
      pendingCount: 1,
      vehicleCount: 2,
      conflictDayCount: 0
    })
    expect(view.cells.find((item) => item.date === "2026-07-10").bookingCount).toBe(1)
    expect(view.cells.find((item) => item.date === "2026-07-11").bookingCount).toBe(2)
    expect(view.cells.find((item) => item.date === "2026-07-12").bookingCount).toBe(1)
    expect(view.selectedBookings.map((item) => item.id)).toEqual(["booking_1", "booking_2"])
  })

  test("已取消预约不占用日历", () => {
    const view = buildMonthView(
      "2026-07",
      [
        {
          id: "booking_cancelled",
          vehicleId: "vehicle_1",
          startDate: "2026-07-20",
          endDate: "2026-07-22",
          status: "cancelled"
        }
      ],
      "2026-07-21"
    )

    expect(view.summary.bookingCount).toBe(0)
    expect(view.selectedBookings).toEqual([])
    expect(view.cells.find((item) => item.date === "2026-07-21").hasBookings).toBe(false)
  })

  test("日期倒置或格式错误的记录不计入日历", () => {
    const view = buildMonthView(
      "2026-07",
      [
        {
          id: "booking_reversed",
          startDate: "2026-07-20",
          endDate: "2026-07-19",
          status: "pending"
        },
        {
          id: "booking_invalid",
          startDate: "2026/07/20",
          endDate: "2026/07/21",
          status: "pending"
        }
      ],
      "2026-07-20"
    )

    expect(view.summary.bookingCount).toBe(0)
    expect(view.selectedBookings).toEqual([])
  })

  test("只把同一车辆的重叠预约标为冲突", () => {
    const view = buildMonthView(
      "2026-07",
      [
        {
          id: "booking_1",
          vehicleId: "vehicle_1",
          startDate: "2026-07-10",
          endDate: "2026-07-12",
          status: "pending"
        },
        {
          id: "booking_2",
          vehicleId: "vehicle_1",
          startDate: "2026-07-11",
          endDate: "2026-07-13",
          status: "contacted"
        },
        {
          id: "booking_3",
          vehicleId: "vehicle_2",
          startDate: "2026-07-11",
          endDate: "2026-07-11",
          status: "pending"
        }
      ],
      "2026-07-11"
    )

    expect(view.cells.find((item) => item.date === "2026-07-10").hasConflict).toBe(false)
    expect(view.cells.find((item) => item.date === "2026-07-11").conflictVehicleCount).toBe(1)
    expect(view.cells.find((item) => item.date === "2026-07-12").hasConflict).toBe(true)
    expect(view.cells.find((item) => item.date === "2026-07-13").hasConflict).toBe(false)
    expect(view.selectedConflictCount).toBe(1)
    expect(view.summary.conflictDayCount).toBe(2)
    expect(view.selectedBookings.find((item) => item.id === "booking_1").hasConflict).toBe(true)
    expect(view.selectedBookings.find((item) => item.id === "booking_2").hasConflict).toBe(true)
    expect(view.selectedBookings.find((item) => item.id === "booking_3").hasConflict).toBe(false)
  })
})
