jest.mock("wx-server-sdk")

function createMockDb({ booking, quote, occupied = false }) {
  const bookingState = { ...booking, _id: "booking_1" }
  const quoteState = { ...quote, _id: "quote_1" }
  const serverDateValue = { __type: "serverDate" }
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const dayWrites = []
  const doc = (state) => ({
    field: () => ({ get: async () => ({ data: { ...state } }) }),
    update: async ({ data }) => { Object.assign(state, data); return { stats: { updated: 1 } } }
  })
  const db = {
    serverDate: jest.fn(() => serverDateValue),
    runTransaction: jest.fn((callback) => callback(db)),
    collection: jest.fn((name) => {
      if (name === "bookings") return { doc: () => doc(bookingState) }
      if (name === "booking_quotes") return { doc: () => doc(quoteState) }
      if (name === "vehicles") return { doc: () => ({ field: () => ({ get: async () => ({ data: { status: "idle", brandModel: "BMW M4" } }) }) }) }
      if (name === "vehicle_calendar_days") return {
        doc: (id) => ({
          field: () => ({ get: async () => {
            if (occupied) return { data: { blockId: "other", bookingId: "other_booking", kind: "booking" } }
            throw new Error("document not found")
          } }),
          set: async ({ data }) => { dayWrites.push({ id, ...data }); return { _id: id } }
        })
      }
      if (name === "vehicle_availability_blocks") return { doc: (id) => ({ set: async () => ({ _id: id }) }) }
      if (name === "audit_logs") return { add: auditAdd }
      if (name === "error_logs") return { add: jest.fn().mockResolvedValue({ _id: "error_1" }) }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }
  return { db, bookingState, quoteState, auditAdd, dayWrites }
}

async function loadModule(openid, db) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb(db)
  let mod
  jest.isolateModules(() => { mod = require("../cloudfunctions/bookingQuoteRespond/index") })
  return mod
}

function createQuotedState() {
  return createMockDb({
    booking: { openid: "user_1", status: "quoted", latestQuoteId: "quote_1", vehicleId: "vehicle_1", vehicleName: "BMW M4", startDate: "2099-08-01", endDate: "2099-08-03" },
    quote: { bookingId: "booking_1", status: "sent", version: 1, validUntil: "2099-12-31", sentAt: "2026-08-09T01:00:00.000Z" }
  })
}

describe("cloudfunctions/bookingQuoteRespond integration", () => {
  test("用户确认自己的有效报价且重复确认幂等", async () => {
    const mocks = createQuotedState()
    const mod = await loadModule("user_1", mocks.db)
    const first = await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })
    const second = await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })
    expect(first).toMatchObject({ ok: true, updated: true, bookingStatus: "confirmed" })
    expect(second).toMatchObject({ ok: true, updated: false, bookingStatus: "confirmed" })
    expect(mocks.bookingState.status).toBe("confirmed")
    expect(mocks.quoteState.status).toBe("confirmed")
    expect(mocks.dayWrites).toHaveLength(3)
  })

  test("并发档期已被占用时拒绝确认且不改变报价状态", async () => {
    const mocks = createMockDb({
      booking: { openid: "user_1", status: "quoted", latestQuoteId: "quote_1", vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-02" },
      quote: { bookingId: "booking_1", status: "sent", version: 1, validUntil: "2099-12-31" },
      occupied: true
    })
    const mod = await loadModule("user_1", mocks.db)
    const res = await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })
    expect(res.code).toBe("AVAILABILITY_CONFLICT")
    expect(mocks.bookingState.status).toBe("quoted")
    expect(mocks.quoteState.status).toBe("sent")
  })

  test("用户可申请调整且审计日志不保存调整正文", async () => {
    const mocks = createQuotedState()
    const mod = await loadModule("user_1", mocks.db)
    const res = await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "requestAdjustment", adjustmentNote: "希望取消取送车服务" })
    expect(res).toMatchObject({ ok: true, bookingStatus: "adjustment_requested" })
    expect(mocks.quoteState.adjustmentNote).toBe("希望取消取送车服务")
    expect(JSON.stringify(mocks.auditAdd.mock.calls)).not.toContain("希望取消取送车服务")
  })

  test("不能处理他人的报价", async () => {
    const mocks = createQuotedState()
    const mod = await loadModule("other_user", mocks.db)
    const res = await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })
    expect(res.code).toBe("FORBIDDEN")
    expect(mocks.bookingState.status).toBe("quoted")
  })
})
