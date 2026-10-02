const {
  STATUS_TEXT_MAP,
  STATUS_CLASS_MAP,
  mapStatusText,
  mapStatusClass,
  canCancelBooking,
  canEditBooking,
  buildStatusGuidance,
  buildJourneyProgress,
  buildProgressSteps,
  buildListSummary,
  filterBookings
} = require("../shared/bookingStatus")

describe("bookingStatus shared module", () => {
  describe("STATUS_TEXT_MAP", () => {
    test("contains all 7 standard statuses", () => {
      const expectedKeys = ["pending", "contacted", "quoted", "adjustment_requested", "confirmed", "completed", "cancelled"]
      expectedKeys.forEach((key) => {
        expect(STATUS_TEXT_MAP).toHaveProperty(key)
        expect(typeof STATUS_TEXT_MAP[key]).toBe("string")
        expect(STATUS_TEXT_MAP[key].length).toBeGreaterThan(0)
      })
    })
  })

  describe("STATUS_CLASS_MAP", () => {
    test("contains all 7 standard statuses with status- prefix", () => {
      const expectedKeys = ["pending", "contacted", "quoted", "adjustment_requested", "confirmed", "completed", "cancelled"]
      expectedKeys.forEach((key) => {
        expect(STATUS_CLASS_MAP[key]).toMatch(/^status-/)
      })
    })
  })

  describe("mapStatusText", () => {
    test("maps pending to 待联系", () => {
      expect(mapStatusText("pending")).toBe("待联系")
    })
    test("maps contacted to 已联系", () => {
      expect(mapStatusText("contacted")).toBe("已联系")
    })
    test("maps quoted to 已报价", () => {
      expect(mapStatusText("quoted")).toBe("已报价")
    })
    test("maps adjustment_requested to 待调整", () => {
      expect(mapStatusText("adjustment_requested")).toBe("待调整")
    })
    test("maps confirmed to 已确认", () => {
      expect(mapStatusText("confirmed")).toBe("已确认")
    })
    test("maps completed to 已完成", () => {
      expect(mapStatusText("completed")).toBe("已完成")
    })
    test("maps cancelled to 已取消", () => {
      expect(mapStatusText("cancelled")).toBe("已取消")
    })
    test("returns 待联系 for unknown status", () => {
      expect(mapStatusText("unknown")).toBe("待联系")
    })
    test("returns 待联系 for null", () => {
      expect(mapStatusText(null)).toBe("待联系")
    })
    test("returns 待联系 for undefined", () => {
      expect(mapStatusText(undefined)).toBe("待联系")
    })
    test("trims whitespace", () => {
      expect(mapStatusText("  confirmed  ")).toBe("已确认")
    })
  })

  describe("mapStatusClass", () => {
    test("maps pending to status-pending", () => {
      expect(mapStatusClass("pending")).toBe("status-pending")
    })
    test("returns status-pending for unknown", () => {
      expect(mapStatusClass("unknown")).toBe("status-pending")
    })
    test("returns status-pending for null", () => {
      expect(mapStatusClass(null)).toBe("status-pending")
    })
  })

  describe("canCancelBooking", () => {
    test("allows cancellation for pending", () => {
      expect(canCancelBooking("pending")).toBe(true)
    })
    test("allows cancellation for contacted", () => {
      expect(canCancelBooking("contacted")).toBe(true)
    })
    test("allows cancellation for quoted", () => {
      expect(canCancelBooking("quoted")).toBe(true)
    })
    test("allows cancellation for adjustment_requested", () => {
      expect(canCancelBooking("adjustment_requested")).toBe(true)
    })
    test("allows cancellation for confirmed", () => {
      expect(canCancelBooking("confirmed")).toBe(true)
    })
    test("disallows cancellation for completed", () => {
      expect(canCancelBooking("completed")).toBe(false)
    })
    test("disallows cancellation for cancelled", () => {
      expect(canCancelBooking("cancelled")).toBe(false)
    })
    test("disallows cancellation for null", () => {
      expect(canCancelBooking(null)).toBe(false)
    })
  })

  describe("canEditBooking", () => {
    test("allows editing for pending", () => {
      expect(canEditBooking("pending")).toBe(true)
    })
    test("allows editing for contacted", () => {
      expect(canEditBooking("contacted")).toBe(true)
    })
    test("disallows editing for quoted", () => {
      expect(canEditBooking("quoted")).toBe(false)
    })
    test("disallows editing for confirmed", () => {
      expect(canEditBooking("confirmed")).toBe(false)
    })
    test("disallows editing for null", () => {
      expect(canEditBooking(null)).toBe(false)
    })
  })

  describe("buildStatusGuidance", () => {
    test("returns default pending guidance for list", () => {
      const guidance = buildStatusGuidance("pending")
      expect(guidance.title).toBe("等待顾问联系")
      expect(guidance.tone).toBe("pending")
      expect(guidance.desc).toContain("保持手机畅通")
    })

    test("returns detail guidance when requested", () => {
      const listGuidance = buildStatusGuidance("pending")
      const detailGuidance = buildStatusGuidance("pending", { mode: "detail" })
      expect(detailGuidance.title).toBe("等待顾问联系")
      expect(detailGuidance.tone).toBe("pending")
      expect(detailGuidance.desc).toContain("本次预约的联系信息")
    })

    test("handles all statuses cleanly", () => {
      const statuses = ["pending", "contacted", "quoted", "adjustment_requested", "confirmed", "completed", "cancelled"]
      statuses.forEach((status) => {
        const item = buildStatusGuidance(status)
        expect(typeof item.title).toBe("string")
        expect(typeof item.desc).toBe("string")
        expect(item.tone).toBe(status.includes("adjustment") ? "adjustment" : status)
      })
    })

    test("fallbacks gracefully for unknown status", () => {
      const guidance = buildStatusGuidance("unknown_state")
      expect(guidance.title).toBe("等待顾问联系")
    })
  })

  describe("buildJourneyProgress", () => {
    test("builds progress stages for pending", () => {
      const progress = buildJourneyProgress("pending")
      expect(progress.stageText).toContain("第 1 阶段")
      expect(progress.width).toBe("4%")
      expect(progress.stepOneClass).toBe("journey-step-current")
    })

    test("builds progress stages for confirmed", () => {
      const progress = buildJourneyProgress("confirmed")
      expect(progress.stageText).toContain("第 3 阶段")
      expect(progress.stepThreeClass).toBe("journey-step-current")
    })

    test("builds progress stages for cancelled", () => {
      const progress = buildJourneyProgress("cancelled")
      expect(progress.stageText).toBe("流程已结束")
      expect(progress.stepThreeClass).toBe("journey-step-cancelled")
    })
  })

  describe("buildProgressSteps", () => {
    test("builds 5-step array for normal active status", () => {
      const steps = buildProgressSteps("quoted")
      expect(steps.length).toBe(5)
      expect(steps[0].stateClass).toBe("progress-done")
      expect(steps[1].stateClass).toBe("progress-done")
      expect(steps[2].stateClass).toBe("progress-current")
      expect(steps[3].stateClass).toBe("progress-upcoming")
    })

    test("builds 3-step array for cancelled status", () => {
      const steps = buildProgressSteps("cancelled")
      expect(steps.length).toBe(3)
      expect(steps[1].showCancelledMark).toBe(true)
      expect(steps[1].stateClass).toBe("progress-cancelled")
    })
  })

  describe("buildListSummary & filterBookings", () => {
    const mockList = [
      { id: "1", status: "pending" },
      { id: "2", status: "confirmed" },
      { id: "3", status: "completed" },
      { id: "4", status: "cancelled" }
    ]

    test("builds list counts accurately", () => {
      const summary = buildListSummary(mockList)
      expect(summary).toEqual({
        ongoing: 2,
        completed: 1,
        cancelled: 1
      })
    })

    test("filters ongoing bookings", () => {
      const ongoing = filterBookings(mockList, "ongoing")
      expect(ongoing.map((i) => i.id)).toEqual(["1", "2"])
    })

    test("filters completed bookings", () => {
      const completed = filterBookings(mockList, "completed")
      expect(completed.map((i) => i.id)).toEqual(["3"])
    })

    test("filters cancelled bookings", () => {
      const cancelled = filterBookings(mockList, "cancelled")
      expect(cancelled.map((i) => i.id)).toEqual(["4"])
    })

    test("returns all when filter is all", () => {
      expect(filterBookings(mockList, "all").length).toBe(4)
    })
  })
})
