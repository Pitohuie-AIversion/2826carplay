jest.mock("wx-server-sdk")

function createMockDb({ booking, quote, occupied = false, vehicle = { status: "idle", brandModel: "BMW M4" } }) {
  const bookingState = { ...booking, _id: "booking_1" }
  const quoteState = { ...quote, _id: "quote_1" }
  const serverDateValue = { __type: "serverDate" }
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const analyticsAdd = jest.fn().mockResolvedValue({ _id: "analytics_1" })
  const dayWrites = []
  let inTransaction = false
  let operationCount = 0
  const countOperation = () => {
    if (inTransaction && ++operationCount > 100) throw new Error("Transaction exceeds 100 operations")
  }
  const doc = (state) => ({
    field: () => ({ get: async () => { countOperation(); return { data: { ...state } } } }),
    update: async ({ data }) => { countOperation(); Object.assign(state, data); return { stats: { updated: 1 } } }
  })
  const db = {
    serverDate: jest.fn(() => serverDateValue),
    runTransaction: jest.fn(async (callback) => {
      operationCount = 0
      inTransaction = true
      try { return await callback(db) } finally { inTransaction = false }
    }),
    collection: jest.fn((name) => {
      if (name === "bookings") return { doc: () => doc(bookingState) }
      if (name === "booking_quotes") return { doc: () => doc(quoteState) }
      if (name === "vehicles") return { doc: () => ({ field: () => ({ get: async () => { countOperation(); return { data: vehicle } } }) }) }
      if (name === "vehicle_calendar_days") return {
        doc: (id) => ({
          field: () => ({ get: async () => {
            countOperation()
            if (occupied) return { data: { blockId: "other", bookingId: "other_booking", kind: "booking" } }
            throw new Error("document not found")
          } }),
          set: async ({ data }) => { countOperation(); dayWrites.push({ id, ...data }); return { _id: id } }
        })
      }
      if (name === "vehicle_availability_blocks") return { doc: (id) => ({ set: async () => { countOperation(); return { _id: id } } }) }
      if (name === "audit_logs") return { add: auditAdd }
      if (name === "analytics_events") return { add: analyticsAdd }
      if (name === "error_logs") return { add: jest.fn().mockResolvedValue({ _id: "error_1" }) }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }
  return { db, bookingState, quoteState, auditAdd, analyticsAdd, dayWrites, getOperationCount: () => operationCount }
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

function createQuotedState(vehicle) {
  return createMockDb({
    ...(vehicle ? { vehicle } : {}),
    booking: { openid: "user_1", status: "quoted", latestQuoteId: "quote_1", vehicleId: "vehicle_1", vehicleName: "BMW M4", startDate: "2099-08-01", endDate: "2099-08-03", attribution: { contentId: "guide_1", channel: "wechat_share", scene: "weekend_trip", vehicleId: "vehicle_1" } },
    quote: { bookingId: "booking_1", status: "sent", version: 1, validUntil: "2099-12-31", sentAt: "2026-08-09T01:00:00.000Z" }
  })
}

describe("cloudfunctions/bookingQuoteRespond integration", () => {
  test.each([undefined, "", "legacy_unknown", " maintenance ", "retired"])("车辆状态 %s 不可确认，也不留下报价或档期写入", async (status) => {
    const mocks = createQuotedState({ status, brandModel: "待核对车辆" })
    const mod = await loadModule("user_1", mocks.db)
    expect(await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })).toMatchObject({ ok: false, code: "VEHICLE_NOT_OCCUPIABLE" })
    expect(mocks.bookingState.status).toBe("quoted")
    expect(mocks.quoteState.status).toBe("sent")
    expect(mocks.dayWrites).toEqual([])
    expect(mocks.auditAdd).not.toHaveBeenCalled()
    expect(mocks.analyticsAdd).not.toHaveBeenCalled()
  })

  test.each(["idle", "active"])("车辆有效状态 %s 保留确认和占用能力", async (status) => {
    const mocks = createQuotedState({ status })
    const mod = await loadModule("user_1", mocks.db)
    expect(await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })).toMatchObject({ ok: true, bookingStatus: "confirmed" })
    expect(mocks.dayWrites).toHaveLength(3)
  })

  test("含起止47个日期正好100次事务操作成功，48个日期不改变状态", async () => {
    for (const [endDate, expectedDays] of [["2099-09-16", 47], ["2099-09-17", 48]]) {
      const mocks = createQuotedState()
      mocks.bookingState.endDate = endDate
      const mod = await loadModule("user_1", mocks.db)
      const result = await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })
      if (expectedDays === 47) {
        expect(result.ok).toBe(true)
        expect(mocks.dayWrites).toHaveLength(47)
        expect(mocks.getOperationCount()).toBe(100)
      } else {
        expect(result.code).toBe("BOOKING_RANGE_TOO_LONG")
        expect(result.message).toContain("联系顾问")
        expect(mocks.bookingState.status).toBe("quoted")
        expect(mocks.quoteState.status).toBe("sent")
        expect(mocks.dayWrites).toEqual([])
        expect(mocks.getOperationCount()).toBeLessThanOrEqual(100)
      }
    }
  })
  test.each(["2099-02-30", "2099-13-01", "invalid"])("非法预约日期 %s 不会写入滚动后的档期", async (startDate) => {
    const mocks = createQuotedState()
    mocks.bookingState.startDate = startDate
    const mod = await loadModule("user_1", mocks.db)
    expect((await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })).code).toBe("BOOKING_DATES_INVALID")
    expect(mocks.bookingState.status).toBe("quoted")
    expect(mocks.dayWrites).toEqual([])
  })

  test("过期报价恢复待沟通，非法有效期拒绝确认，均不占用车辆", async () => {
    for (const validUntil of ["2020-01-01", "2099-02-30"]) {
      const mocks = createQuotedState()
      mocks.quoteState.validUntil = validUntil
      const mod = await loadModule("user_1", mocks.db)
      const res = await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })
      expect(res.code).toBe(validUntil === "2020-01-01" ? "QUOTE_EXPIRED" : "QUOTE_INVALID")
      expect(mocks.bookingState.status).toBe(validUntil === "2020-01-01" ? "contacted" : "quoted")
      expect(mocks.dayWrites).toEqual([])
    }
  })

  test("旧版本已确认报价不作为当前新报价的幂等成功返回", async () => {
    const mocks = createQuotedState()
    mocks.bookingState.status = "confirmed"
    mocks.bookingState.latestQuoteId = "quote_2"
    mocks.quoteState.status = "confirmed"
    const mod = await loadModule("user_1", mocks.db)
    expect((await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })).code).toBe("STATUS_NOT_ALLOWED")
  })

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
    expect(mocks.analyticsAdd).toHaveBeenCalledTimes(1)
    expect(mocks.analyticsAdd.mock.calls[0][0].data).toMatchObject({
      eventType: "content_booking_confirmed",
      contentId: "guide_1",
      vehicleId: "vehicle_1",
      channel: "wechat_share",
      scene: "weekend_trip"
    })
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

  test("历史预约中的非法归因字段不会写入匿名分析", async () => {
    const mocks = createQuotedState()
    mocks.bookingState.attribution = {
      contentId: "../private-note",
      channel: "unknown-channel",
      scene: "private-itinerary"
    }
    const mod = await loadModule("user_1", mocks.db)
    const res = await mod.main({ bookingId: "booking_1", quoteId: "quote_1", action: "confirm" })
    expect(res).toMatchObject({ ok: true, updated: true, bookingStatus: "confirmed" })
    expect(mocks.analyticsAdd).not.toHaveBeenCalled()
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
