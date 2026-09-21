const {
  STATUS_TEXT_MAP,
  STATUS_CLASS_MAP,
  mapStatusText,
  mapStatusClass,
  canCancelBooking,
  canEditBooking
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
})
