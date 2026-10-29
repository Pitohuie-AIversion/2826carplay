jest.mock("wx-server-sdk")

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

const clone = (value) => JSON.parse(JSON.stringify(value))

function createTransactionalDb(failureMethod) {
  let committed = {
    bookings: { booking_1: {
      _id: "booking_1", openid: "user_1", status: "quoted", latestQuoteId: "quote_1",
      vehicleId: "vehicle_1", startDate: "2099-08-01", endDate: "2099-08-03",
      attribution: { contentId: "guide_1", channel: "wechat_share", scene: "weekend_trip" }
    } },
    booking_quotes: { quote_1: {
      _id: "quote_1", bookingId: "booking_1", status: "sent", version: 1, validUntil: "2099-12-31"
    } },
    vehicles: { vehicle_1: { _id: "vehicle_1", status: "idle", brandModel: "BMW M4" } },
    vehicle_availability_blocks: {},
    vehicle_calendar_days: {}
  }
  let injectFailure = true
  const reachedFailure = deferred()
  const failOperation = deferred()
  const releaseOtherOperation = deferred()
  const transactions = []
  const completionsAfterClose = []
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const analyticsAdd = jest.fn().mockResolvedValue({ _id: "analytics_1" })
  const errorAdd = jest.fn().mockResolvedValue({ _id: "error_1" })

  const db = {
    serverDate: () => ({ __type: "serverDate" }),
    collection: (name) => {
      const add = { audit_logs: auditAdd, analytics_events: analyticsAdd, error_logs: errorAdd }[name]
      if (!add) throw new Error(`Business writes must use a transaction: ${name}`)
      return { add }
    },
    runTransaction: async (callback) => {
      const staged = clone(committed)
      const transaction = { closed: false, pending: new Set(), settlements: [], writes: [], fail: injectFailure }
      transactions.push(transaction)
      const perform = async (name, id, method, data, fields) => {
        const operation = { name, id, method }
        const settled = deferred()
        transaction.pending.add(operation)
        transaction.settlements.push(settled.promise)
        try {
          if (transaction.fail && name === "vehicle_calendar_days" && method === failureMethod) {
            if (id.endsWith("20990802")) {
              reachedFailure.resolve()
              await failOperation.promise
              throw new Error(`injected ${method} failure`)
            }
            if (id.endsWith("20990803")) await releaseOtherOperation.promise
          }
          if (transaction.closed) completionsAfterClose.push(operation)
          if (method === "get") {
            const record = staged[name][id]
            if (!record) throw new Error("document not found")
            return { data: clone(Object.fromEntries(Object.entries(record).filter(([key]) => !fields || fields[key]))) }
          }
          transaction.writes.push({ name, id, data: clone(data) })
          staged[name][id] = method === "update" ? { ...staged[name][id], ...clone(data) } : clone(data)
          return { _id: id, stats: { updated: 1 } }
        } finally {
          transaction.pending.delete(operation)
          settled.resolve()
        }
      }
      try {
        const result = await callback({ collection: (name) => ({ doc: (id) => ({
          field: (fields) => ({ get: () => perform(name, id, "get", undefined, fields) }),
          update: ({ data }) => perform(name, id, "update", data),
          set: ({ data }) => perform(name, id, "set", data)
        }) }) })
        committed = staged
        return result
      } finally {
        transaction.pendingAtClose = transaction.pending.size
        transaction.closed = true
      }
    }
  }
  return {
    db, transactions, completionsAfterClose, auditAdd, analyticsAdd, errorAdd,
    snapshot: () => clone(committed), reachedFailure, failOperation, releaseOtherOperation,
    disableFailure: () => { injectFailure = false }
  }
}

async function loadModule(db) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "user_1" })
  cloud.__setMockDb(db)
  let mod
  jest.isolateModules(() => { mod = require("../cloudfunctions/bookingQuoteRespond/index") })
  return mod
}

describe("bookingQuoteRespond transaction rollback", () => {
  test.each(["get", "set"])("a delayed mid-range %s failure rolls back completely and can be retried", async (method) => {
    jest.spyOn(console, "error").mockImplementation(() => {})
    const mocks = createTransactionalDb(method)
    const before = mocks.snapshot()
    const mod = await loadModule(mocks.db)
    const input = { bookingId: "booking_1", quoteId: "quote_1", action: "confirm" }
    const response = mod.main(input)
    await mocks.reachedFailure.promise

    // Transaction changes remain invisible while a database operation is delayed.
    expect(mocks.snapshot()).toEqual(before)
    if (method === "set") {
      expect(mocks.transactions[0].writes.map(({ name }) => name)).toEqual(expect.arrayContaining([
        "bookings", "booking_quotes", "vehicle_availability_blocks", "vehicle_calendar_days"
      ]))
    }
    mocks.failOperation.resolve()
    expect(await response).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    const afterFailure = mocks.snapshot()
    const auditCountAfterFailure = mocks.auditAdd.mock.calls.length
    const analyticsCountAfterFailure = mocks.analyticsAdd.mock.calls.length

    // Retry before releasing any older request, so late work cannot corrupt a new confirmation.
    mocks.disableFailure()
    const retry = await mod.main(input)
    const afterRetry = mocks.snapshot()
    mocks.releaseOtherOperation.resolve()
    await Promise.all(mocks.transactions.flatMap(({ settlements }) => settlements))

    expect(afterFailure).toEqual(before)
    expect(auditCountAfterFailure).toBe(0)
    expect(analyticsCountAfterFailure).toBe(0)
    expect(mocks.errorAdd).toHaveBeenCalledTimes(1)
    expect(mocks.transactions[0].pendingAtClose).toBe(0)
    expect(mocks.completionsAfterClose).toEqual([])
    expect(mocks.transactions.every(({ pending }) => pending.size === 0)).toBe(true)
    expect(retry).toMatchObject({ ok: true, updated: true, bookingStatus: "confirmed" })
    expect(mocks.snapshot()).toEqual(afterRetry)
    expect(afterRetry.bookings.booking_1.status).toBe("confirmed")
    expect(afterRetry.booking_quotes.quote_1.status).toBe("confirmed")
    const blocks = Object.entries(afterRetry.vehicle_availability_blocks)
    expect(blocks).toHaveLength(1)
    expect(blocks[0][1]).toMatchObject({ bookingId: "booking_1", status: "active", startDate: "2099-08-01", endDate: "2099-08-03" })
    const days = Object.values(afterRetry.vehicle_calendar_days)
    expect(days.map(({ date }) => date).sort()).toEqual(["2099-08-01", "2099-08-02", "2099-08-03"])
    expect(days.every((day) => day.bookingId === "booking_1" && day.blockId === blocks[0][0])).toBe(true)
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
    expect(mocks.analyticsAdd).toHaveBeenCalledTimes(1)
  })
})
