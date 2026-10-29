const { _test } = require("../../../cloudfunctions/contentGuideDetail/index")

describe("contentGuideDetail", () => {
  describe("toTimestamp", () => {
    const { toTimestamp } = _test

    it("should return 0 for falsy values", () => {
      expect(toTimestamp(null)).toBe(0)
      expect(toTimestamp(undefined)).toBe(0)
      expect(toTimestamp("")).toBe(0)
      expect(toTimestamp(0)).toBe(0)
      expect(toTimestamp(false)).toBe(0)
    })

    it("should return correct timestamp for Date instances", () => {
      const now = new Date()
      expect(toTimestamp(now)).toBe(now.getTime())
    })

    it("should return correct timestamp for objects with toDate() method", () => {
      const now = new Date()
      const firebaseTimestampMock = {
        toDate: () => now
      }
      expect(toTimestamp(firebaseTimestampMock)).toBe(now.getTime())
    })

    it("should return correct timestamp for valid date strings", () => {
      const dateString = "2023-01-01T12:00:00Z"
      const expectedTimestamp = new Date(dateString).getTime()
      expect(toTimestamp(dateString)).toBe(expectedTimestamp)
    })

    it("should return correct timestamp for valid numeric values", () => {
      const timestamp = 1672574400000 // 2023-01-01T12:00:00Z
      expect(toTimestamp(timestamp)).toBe(timestamp)
    })

    it("should return 0 for invalid date strings/values", () => {
      expect(toTimestamp("invalid-date-string")).toBe(0)
      expect(toTimestamp({})).toBe(0)
      expect(toTimestamp([])).toBe(0)
    })
  })
})
