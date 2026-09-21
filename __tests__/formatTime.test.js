const { formatDisplayTime, formatShortTime, formatRelativeTime, formatShortDate } = require("../shared/formatTime")

describe("formatTime shared module", () => {
  describe("formatDisplayTime", () => {
    test("formats valid timestamp to YYYY-MM-DD HH:mm", () => {
      const result = formatDisplayTime("2026-09-15T14:30:00")
      expect(result).toMatch(/^2026-09-15 14:30$/)
    })
    test("formats Date object", () => {
      const date = new Date(2026, 7, 20, 9, 5)
      const result = formatDisplayTime(date)
      expect(result).toBe("2026-08-20 09:05")
    })
    test("formats epoch milliseconds", () => {
      const ts = new Date(2026, 0, 1, 0, 0).getTime()
      const result = formatDisplayTime(ts)
      expect(result).toBe("2026-01-01 00:00")
    })
    test("returns empty string for null", () => {
      expect(formatDisplayTime(null)).toBe("")
    })
    test("returns empty string for undefined", () => {
      expect(formatDisplayTime(undefined)).toBe("")
    })
    test("returns empty string for empty string", () => {
      expect(formatDisplayTime("")).toBe("")
    })
    test("returns empty string for invalid date string", () => {
      expect(formatDisplayTime("not-a-date")).toBe("")
    })
    test("pads single-digit month and day", () => {
      const result = formatDisplayTime("2026-01-05T03:07:00")
      expect(result).toBe("2026-01-05 03:07")
    })
  })

  describe("formatShortTime", () => {
    test("formats valid timestamp to MM-DD HH:mm", () => {
      const result = formatShortTime("2026-09-15T14:30:00")
      expect(result).toBe("09-15 14:30")
    })
    test("returns dash for null", () => {
      expect(formatShortTime(null)).toBe("—")
    })
    test("returns dash for undefined", () => {
      expect(formatShortTime(undefined)).toBe("—")
    })
    test("returns dash for invalid date", () => {
      expect(formatShortTime("invalid")).toBe("—")
    })
    test("formats epoch milliseconds", () => {
      const ts = new Date(2026, 2, 10, 18, 45).getTime()
      const result = formatShortTime(ts)
      expect(result).toBe("03-10 18:45")
    })
  })

  describe("formatShortDate", () => {
    test("formats valid date to MM-DD", () => {
      expect(formatShortDate("2026-12-25")).toBe("12-25")
    })
    test("returns empty for null", () => {
      expect(formatShortDate(null)).toBe("")
    })
    test("returns empty for invalid", () => {
      expect(formatShortDate("xyz")).toBe("")
    })
  })

  describe("formatRelativeTime", () => {
    test("returns empty for null", () => {
      expect(formatRelativeTime(null)).toBe("")
    })
    test("returns empty for invalid date", () => {
      expect(formatRelativeTime("not-valid")).toBe("")
    })
    test("returns '刚刚' for very recent time", () => {
      const result = formatRelativeTime(Date.now() - 10000)
      expect(result).toBe("刚刚")
    })
    test("returns minutes ago", () => {
      const result = formatRelativeTime(Date.now() - 5 * 60000)
      expect(result).toBe("5 分钟前")
    })
    test("returns hours ago", () => {
      const result = formatRelativeTime(Date.now() - 3 * 3600000)
      expect(result).toBe("3 小时前")
    })
    test("returns days ago", () => {
      const result = formatRelativeTime(Date.now() - 7 * 86400000)
      expect(result).toBe("7 天前")
    })
    test("returns months ago", () => {
      const result = formatRelativeTime(Date.now() - 60 * 86400000)
      expect(result).toBe("2 个月前")
    })
    test("returns '即将到来' for future time", () => {
      const result = formatRelativeTime(Date.now() + 3600000)
      expect(result).toBe("即将到来")
    })
  })
})
