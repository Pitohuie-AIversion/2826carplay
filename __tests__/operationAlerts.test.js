const {
  computeAlerts,
  OVERDUE_PENDING_HOURS,
  QUOTE_EXPIRY_WARNING_HOURS,
  MAINTENANCE_WARNING_DAYS,
  COORDINATION_OVERDUE_HOURS
} = require("../shared/operationAlerts")

describe("operationAlerts shared module", () => {
  const NOW = new Date("2026-09-20T12:00:00").getTime()

  describe("overdue pending detection", () => {
    test("flags pending booking older than threshold", () => {
      const bookings = [
        { _id: "b1", status: "pending", createdAt: new Date(NOW - 30 * 3600000).toISOString() }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      const alert = alerts.find((a) => a.type === "overdue_pending")
      expect(alert).toBeDefined()
      expect(alert.urgency).toBe("high")
      expect(alert.count).toBe(1)
    })
    test("does not flag recent pending booking", () => {
      const bookings = [
        { _id: "b1", status: "pending", createdAt: new Date(NOW - 2 * 3600000).toISOString() }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      expect(alerts.find((a) => a.type === "overdue_pending")).toBeUndefined()
    })
    test("does not flag contacted booking", () => {
      const bookings = [
        { _id: "b1", status: "contacted", createdAt: new Date(NOW - 48 * 3600000).toISOString() }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      expect(alerts.find((a) => a.type === "overdue_pending")).toBeUndefined()
    })
    test("counts multiple overdue bookings", () => {
      const bookings = [
        { _id: "b1", status: "pending", createdAt: new Date(NOW - 30 * 3600000).toISOString() },
        { _id: "b2", status: "pending", createdAt: new Date(NOW - 50 * 3600000).toISOString() }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      const alert = alerts.find((a) => a.type === "overdue_pending")
      expect(alert.count).toBe(2)
      expect(alert.relatedId).toBe("b2")
    })
  })

  describe("expiring quote detection", () => {
    test("flags quoted booking with quote expiring soon", () => {
      const bookings = [
        {
          _id: "b1",
          status: "quoted",
          latestQuote: { validUntil: new Date(NOW + 20 * 3600000).toISOString() }
        }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      const alert = alerts.find((a) => a.type === "expiring_quote")
      expect(alert).toBeDefined()
      expect(alert.urgency).toBe("medium")
      expect(alert.count).toBe(1)
    })
    test("does not flag quote with plenty of time", () => {
      const bookings = [
        {
          _id: "b1",
          status: "quoted",
          latestQuote: { validUntil: new Date(NOW + 72 * 3600000).toISOString() }
        }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      expect(alerts.find((a) => a.type === "expiring_quote")).toBeUndefined()
    })
    test("does not flag already expired quote", () => {
      const bookings = [
        {
          _id: "b1",
          status: "quoted",
          latestQuote: { validUntil: new Date(NOW - 3600000).toISOString() }
        }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      expect(alerts.find((a) => a.type === "expiring_quote")).toBeUndefined()
    })
    test("uses quote field as fallback for latestQuote", () => {
      const bookings = [
        {
          _id: "b1",
          status: "quoted",
          quote: { validUntil: new Date(NOW + 10 * 3600000).toISOString() }
        }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      expect(alerts.find((a) => a.type === "expiring_quote")).toBeDefined()
    })
  })

  describe("maintenance due detection", () => {
    test("flags vehicle with archiveDate within threshold", () => {
      const vehicles = [
        { _id: "v1", archiveDate: new Date(NOW + 15 * 86400000).toISOString() }
      ]
      const alerts = computeAlerts([], vehicles, { now: NOW })
      const alert = alerts.find((a) => a.type === "maintenance_due")
      expect(alert).toBeDefined()
      expect(alert.urgency).toBe("low")
      expect(alert.count).toBe(1)
    })
    test("does not flag vehicle with distant archiveDate", () => {
      const vehicles = [
        { _id: "v1", archiveDate: new Date(NOW + 60 * 86400000).toISOString() }
      ]
      const alerts = computeAlerts([], vehicles, { now: NOW })
      expect(alerts.find((a) => a.type === "maintenance_due")).toBeUndefined()
    })
    test("does not flag vehicle with past archiveDate", () => {
      const vehicles = [
        { _id: "v1", archiveDate: new Date(NOW - 86400000).toISOString() }
      ]
      const alerts = computeAlerts([], vehicles, { now: NOW })
      expect(alerts.find((a) => a.type === "maintenance_due")).toBeUndefined()
    })
    test("uses nextMaintenanceDate as fallback", () => {
      const vehicles = [
        { _id: "v1", nextMaintenanceDate: new Date(NOW + 5 * 86400000).toISOString() }
      ]
      const alerts = computeAlerts([], vehicles, { now: NOW })
      expect(alerts.find((a) => a.type === "maintenance_due")).toBeDefined()
    })
  })

  describe("overdue coordination detection", () => {
    test("flags booking with stale coordination", () => {
      const bookings = [
        {
          _id: "b1",
          status: "pending",
          coordinationStatus: "pending",
          coordinationUpdatedAt: new Date(NOW - 60 * 3600000).toISOString()
        }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      const alert = alerts.find((a) => a.type === "overdue_coordination")
      expect(alert).toBeDefined()
      expect(alert.urgency).toBe("medium")
    })
    test("does not flag recent coordination", () => {
      const bookings = [
        {
          _id: "b1",
          status: "pending",
          coordinationStatus: "pending",
          coordinationUpdatedAt: new Date(NOW - 12 * 3600000).toISOString()
        }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      expect(alerts.find((a) => a.type === "overdue_coordination")).toBeUndefined()
    })
    test("does not flag resolved coordination", () => {
      const bookings = [
        {
          _id: "b1",
          status: "pending",
          coordinationStatus: "resolved",
          coordinationUpdatedAt: new Date(NOW - 100 * 3600000).toISOString()
        }
      ]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      expect(alerts.find((a) => a.type === "overdue_coordination")).toBeUndefined()
    })
  })

  describe("sorting and edge cases", () => {
    test("sorts alerts by urgency: high > medium > low", () => {
      const bookings = [
        { _id: "b1", status: "pending", createdAt: new Date(NOW - 30 * 3600000).toISOString() },
        {
          _id: "b2",
          status: "quoted",
          latestQuote: { validUntil: new Date(NOW + 10 * 3600000).toISOString() }
        }
      ]
      const vehicles = [
        { _id: "v1", archiveDate: new Date(NOW + 5 * 86400000).toISOString() }
      ]
      const alerts = computeAlerts(bookings, vehicles, { now: NOW })
      expect(alerts.length).toBeGreaterThanOrEqual(3)
      const urgencies = alerts.map((a) => a.urgency)
      const indexH = urgencies.indexOf("high")
      const indexM = urgencies.indexOf("medium")
      const indexL = urgencies.indexOf("low")
      if (indexH >= 0 && indexM >= 0) expect(indexH).toBeLessThan(indexM)
      if (indexM >= 0 && indexL >= 0) expect(indexM).toBeLessThan(indexL)
    })
    test("returns empty array for empty inputs", () => {
      expect(computeAlerts([], [], { now: NOW })).toEqual([])
    })
    test("returns empty array for null inputs", () => {
      expect(computeAlerts(null, null, { now: NOW })).toEqual([])
    })
    test("handles bookings without createdAt gracefully", () => {
      const bookings = [{ _id: "b1", status: "pending" }]
      const alerts = computeAlerts(bookings, [], { now: NOW })
      expect(alerts.find((a) => a.type === "overdue_pending")).toBeUndefined()
    })
    test("exported thresholds match expected defaults", () => {
      expect(OVERDUE_PENDING_HOURS).toBe(24)
      expect(QUOTE_EXPIRY_WARNING_HOURS).toBe(48)
      expect(MAINTENANCE_WARNING_DAYS).toBe(30)
      expect(COORDINATION_OVERDUE_HOURS).toBe(48)
    })
  })
})
