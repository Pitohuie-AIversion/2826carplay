jest.mock("wx-server-sdk")

function createMockDb({ booking, quotes = {} }) {
  const bookingState = { ...booking }
  const quoteState = { ...quotes }
  const serverDateValue = { __type: "serverDate" }
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

  function docApi(state, id) {
    const get = jest.fn(async () => {
      if (!state[id]) throw new Error("document not found")
      return { data: { ...state[id] } }
    })
    return {
      field: jest.fn(() => ({ get })),
      get,
      set: jest.fn(async ({ data }) => {
        state[id] = { ...data, _id: id }
        return { stats: { created: 1 } }
      }),
      update: jest.fn(async ({ data }) => {
        if (!state[id]) throw new Error("document not found")
        state[id] = { ...state[id], ...data, _id: id }
        return { stats: { updated: 1 } }
      }),
      remove: jest.fn(async () => {
        delete state[id]
        return { stats: { removed: 1 } }
      })
    }
  }

  const db = {
    serverDate: jest.fn(() => serverDateValue),
    runTransaction: jest.fn((callback) => callback(db)),
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: jest.fn(() => ({ field: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ data: [{ role: "admin" }] }) })) })) })) }
      }
      if (name === "bookings") return { doc: (id) => docApi({ booking_1: bookingState }, id) }
      if (name === "booking_quotes") return { doc: (id) => docApi(quoteState, id) }
      if (name === "audit_logs") return { add: auditAdd }
      if (name === "error_logs") return { add: jest.fn().mockResolvedValue({ _id: "error_1" }) }
      if (name === "app_configs") return { where: jest.fn(() => ({ field: jest.fn(() => ({ limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ data: [] }) })) })) })) }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  // booking 文档需要保持同一可变对象引用。
  db.collection = jest.fn((name) => {
    if (name === "roles") return { where: () => ({ field: () => ({ limit: () => ({ get: async () => ({ data: [{ role: "admin" }] }) }) }) }) }
    if (name === "bookings") {
      return {
        doc: (id) => ({
          field: () => ({ get: async () => id === "booking_1" ? { data: { ...bookingState, _id: id } } : (() => { throw new Error("document not found") })() }),
          update: async ({ data }) => { Object.assign(bookingState, data); return { stats: { updated: 1 } } }
        })
      }
    }
    if (name === "booking_quotes") return { doc: (id) => docApi(quoteState, id) }
    if (name === "audit_logs") return { add: auditAdd }
    if (name === "error_logs") return { add: jest.fn().mockResolvedValue({ _id: "error_1" }) }
    if (name === "app_configs") return { where: () => ({ field: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) }) }) }
    throw new Error(`Unexpected collection: ${name}`)
  })

  return { db, bookingState, quoteState, auditAdd }
}

async function loadModule(mockDb) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "admin_openid" })
  cloud.__setMockDb(mockDb)
  let mod
  jest.isolateModules(() => { mod = require("../cloudfunctions/bookingQuoteManage/index") })
  return mod
}

const draftInput = {
  action: "saveDraft",
  bookingId: "booking_1",
  baseRentalAmount: "1200.00",
  protectionAmount: "100.50",
  serviceFeeAmount: "20",
  deliveryFeeAmount: "30",
  otherFeeAmount: "0",
  depositText: "车辆押金 5000 元，按规则退还",
  validUntil: "2099-12-31",
  customerNote: "取车时核对车况"
}

describe("cloudfunctions/bookingQuoteManage integration", () => {
  test("不存在的有效日期不能保存，旧草稿也不能直接发送", async () => {
    const mocks = createMockDb({ booking: { status: "contacted", startDate: "2026-08-10", endDate: "2026-08-12" } })
    const mod = await loadModule(mocks.db)
    expect(await mod.main({ ...draftInput, validUntil: "2027-02-30" })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(mocks.quoteState).toEqual({})
    expect(await mod.main(draftInput)).toMatchObject({ ok: true })
    mocks.quoteState.booking_1__draft.validUntil = "2027-02-30"
    expect(await mod.main({ action: "send", bookingId: "booking_1", requestId: "invalid_date_001" })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(mocks.bookingState.status).toBe("contacted")
  })
  test("草稿保存会在事务内读取状态，不能恢复已发送的草稿", async () => {
    const mocks = createMockDb({ booking: { status: "contacted", startDate: "2026-08-10", endDate: "2026-08-12" } })
    const run = mocks.db.runTransaction.getMockImplementation()
    mocks.db.runTransaction.mockImplementation((callback) => {
      mocks.bookingState.status = "quoted"
      return run(callback)
    })
    const mod = await loadModule(mocks.db)
    expect(await mod.main(draftInput)).toMatchObject({ ok: false, code: "STATUS_NOT_ALLOWED" })
    expect(mocks.quoteState).toEqual({})
  })

  test("事务异步失败返回结构化错误，不向调用端抛出未捕获拒绝", async () => {
    const mocks = createMockDb({ booking: {} })
    mocks.db.runTransaction.mockRejectedValue(new Error("transaction unavailable"))
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    const mod = await loadModule(mocks.db)
    await expect(mod.main(draftInput)).resolves.toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    errorSpy.mockRestore()
  })

  test("47个自然日仍可报价，超长预约不能保存或发送旧草稿", async () => {
    const mocks = createMockDb({ booking: { status: "contacted", startDate: "2026-08-01", endDate: "2026-09-16" } })
    const mod = await loadModule(mocks.db)
    expect(await mod.main(draftInput)).toMatchObject({ ok: true })
    mocks.bookingState.endDate = "2026-09-17"
    expect(await mod.main(draftInput)).toMatchObject({ ok: false, code: "DATE_RANGE_TOO_LONG" })
    expect(await mod.main({ action: "send", bookingId: "booking_1", requestId: "request_long_001" })).toMatchObject({ ok: false, code: "DATE_RANGE_TOO_LONG" })
    expect(mocks.bookingState.status).toBe("contacted")
    expect(mocks.quoteState.booking_1__draft.status).toBe("draft")
  })

  test("服务端计算租期与合计并保存草稿", async () => {
    const mocks = createMockDb({ booking: { openid: "user_1", vehicleId: "car_1", vehicleName: "MX-5", startDate: "2026-08-10", endDate: "2026-08-12", status: "contacted" } })
    const mod = await loadModule(mocks.db)
    const res = await mod.main(draftInput)

    expect(res.ok).toBe(true)
    expect(res.quote).toMatchObject({ version: 1, rentalDays: 2, totalCents: 135050, status: "draft" })
    expect(mocks.quoteState.booking_1__draft).toMatchObject({ baseRentalCents: 120000, totalCents: 135050 })
  })

  test("发送后生成不可覆盖版本并更新预约状态，重复请求幂等", async () => {
    const mocks = createMockDb({ booking: { openid: "user_1", vehicleId: "car_1", vehicleName: "MX-5", startDate: "2026-08-10", endDate: "2026-08-12", status: "contacted" } })
    const mod = await loadModule(mocks.db)
    await mod.main(draftInput)
    const first = await mod.main({ action: "send", bookingId: "booking_1", expectedDraftRevision: 1, requestId: "request_quote_001" })
    const second = await mod.main({ action: "send", bookingId: "booking_1", expectedDraftRevision: 1, requestId: "request_quote_001" })

    expect(first).toMatchObject({ ok: true, updated: true, bookingStatus: "quoted" })
    expect(second).toMatchObject({ ok: true, updated: false, bookingStatus: "quoted" })
    expect(mocks.bookingState).toMatchObject({ status: "quoted", latestQuoteId: "booking_1__v1", latestQuoteVersion: 1 })
    expect(mocks.quoteState.booking_1__v1).toMatchObject({ status: "sent", version: 1, sendRequestId: "request_quote_001" })
    expect(mocks.quoteState.booking_1__draft).toBeUndefined()
  })

  test("金额格式不合法时不写报价", async () => {
    const mocks = createMockDb({ booking: { status: "contacted" } })
    const mod = await loadModule(mocks.db)
    const res = await mod.main({ ...draftInput, baseRentalAmount: "1.999" })
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.quoteState).toEqual({})
  })

  test("同一草稿基线的第二次保存拒绝覆盖，旧金额页面不能发送新草稿", async () => {
    const mocks = createMockDb({ booking: { status: "contacted", startDate: "2099-08-10", endDate: "2099-08-12" } })
    const mod = await loadModule(mocks.db)
    await mod.main({ ...draftInput, requestId: "draft_first_001" })
    const edited = await mod.main({ ...draftInput, baseRentalAmount: "2400", expectedDraftRevision: 1, requestId: "draft_second_001" })
    expect(edited.quote.revision).toBe(2)
    expect(await mod.main({ ...draftInput, baseRentalAmount: "1600", expectedDraftRevision: 1, requestId: "draft_stale_001" })).toMatchObject({ ok: false, code: "VERSION_CONFLICT" })
    expect(await mod.main({ action: "send", bookingId: "booking_1", expectedDraftRevision: 1, requestId: "send_stale_001" })).toMatchObject({ ok: false, code: "VERSION_CONFLICT" })
    expect(mocks.quoteState.booking_1__draft.baseRentalCents).toBe(240000)
    expect(mocks.bookingState.status).toBe("contacted")
    expect(mocks.quoteState.booking_1__v1).toBeUndefined()
  })

  test("保存或发送成功后丢失响应可重试，客户已确认时也不创建新报价", async () => {
    const mocks = createMockDb({ booking: { status: "contacted", startDate: "2099-08-10", endDate: "2099-08-12" } })
    const mod = await loadModule(mocks.db)
    const save = { ...draftInput, requestId: "draft_retry_001" }
    await mod.main(save)
    expect(await mod.main(save)).toMatchObject({ ok: true, updated: false, quote: { revision: 1 } })
    const send = { action: "send", bookingId: "booking_1", expectedDraftRevision: 1, requestId: "send_retry_001" }
    await mod.main(send)
    mocks.bookingState.status = "confirmed"
    mocks.quoteState.booking_1__v1.status = "confirmed"
    expect(await mod.main(send)).toMatchObject({ ok: true, updated: false, bookingStatus: "confirmed" })
    expect(Object.keys(mocks.quoteState)).toEqual(["booking_1__v1"])
    expect(mocks.auditAdd).toHaveBeenCalledTimes(2)
  })
})
