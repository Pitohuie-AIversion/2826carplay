jest.mock("wx-server-sdk")

function missing() {
  return Promise.reject(new Error("document not found"))
}

function createMockDb() {
  const days = new Map()
  const blocks = new Map()
  const rules = new Map()
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const serverDateValue = { __type: "serverDate" }

  function stateDoc(map, id) {
    const api = {
      get: () => map.has(id) ? Promise.resolve({ data: { _id: id, ...map.get(id) } }) : missing(),
      field: () => ({ get: api.get }),
      set: async ({ data }) => { map.set(id, { ...data }); return { _id: id } },
      update: async ({ data }) => {
        if (!map.has(id)) return missing()
        map.set(id, { ...map.get(id), ...data })
        return { stats: { updated: 1 } }
      },
      remove: async () => { map.delete(id); return { stats: { removed: 1 } } }
    }
    return api
  }

  const db = {
    serverDate: jest.fn(() => serverDateValue),
    runTransaction: jest.fn((callback) => callback(db)),
    collection: jest.fn((name) => {
      if (name === "roles") {
        const chain = {
          where: jest.fn(() => chain),
          field: jest.fn(() => chain),
          limit: jest.fn(() => ({ get: jest.fn().mockResolvedValue({ data: [{ role: "admin" }] }) }))
        }
        return chain
      }
      if (name === "vehicles") {
        return { doc: () => ({ field: () => ({ get: async () => ({ data: { status: "idle", brandModel: "BMW M4", priceDay: 800 } }) }) }) }
      }
      if (name === "bookings") {
        return { doc: () => ({ field: () => ({ get: async () => ({ data: { _id: "booking_1", vehicleId: "vehicle_1", vehicleName: "BMW M4", startDate: "2026-09-01", endDate: "2026-09-02", status: "confirmed" } }) }) }) }
      }
      if (name === "vehicle_calendar_days") {
        return {
          doc: (id) => stateDoc(days, id),
          where: (filter) => ({ limit: () => ({ get: async () => ({ data: [...days.entries()].filter(([, value]) => value.blockId === filter.blockId).map(([id, value]) => ({ _id: id, ...value })) }) }) })
        }
      }
      if (name === "vehicle_availability_blocks") return { doc: (id) => stateDoc(blocks, id) }
      if (name === "vehicle_price_rules") return {
        doc: (id) => stateDoc(rules, id),
        where: (filter) => ({ limit: () => ({ get: async () => ({ data: [...rules.entries()].filter(([, value]) => value.vehicleId === filter.vehicleId && value.status === filter.status).map(([id, value]) => ({ _id: id, ...value })) }) }) })
      }
      if (name === "audit_logs") return { add: auditAdd }
      if (name === "error_logs") return { add: jest.fn().mockResolvedValue({ _id: "error_1" }) }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }
  return { db, days, blocks, rules, auditAdd }
}

async function loadModule(db) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "admin_1" })
  cloud.__setMockDb(db)
  let mod
  jest.isolateModules(() => { mod = require("../cloudfunctions/vehicleCalendarManage/index") })
  return mod
}

describe("cloudfunctions/vehicleCalendarManage integration", () => {
  test("人工区间按日加锁，同车重叠操作在事务内被拒绝", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const first = await mod.main({
      action: "createBlock",
      vehicleId: "vehicle_1",
      kind: "maintenance",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      reason: "定期保养"
    })
    const conflict = await mod.main({
      action: "createBlock",
      vehicleId: "vehicle_1",
      kind: "hold",
      startDate: "2026-08-12",
      endDate: "2026-08-13",
      reason: "线下保留"
    })
    expect(first).toMatchObject({ ok: true, action: "createBlock" })
    expect(mocks.days.size).toBe(3)
    expect(conflict).toMatchObject({ ok: false, code: "AVAILABILITY_CONFLICT" })
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
  })

  test("特殊日期价格必须带原因并保留版本", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const invalid = await mod.main({ action: "createPriceRule", vehicleId: "vehicle_1", label: "国庆", startDate: "2026-10-01", endDate: "2026-10-03", dailyPrice: 1200 })
    const created = await mod.main({ action: "createPriceRule", vehicleId: "vehicle_1", label: "国庆", startDate: "2026-10-01", endDate: "2026-10-03", dailyPrice: 1200, reason: "节假日明确价" })
    expect(invalid.code).toBe("VALIDATION_ERROR")
    expect(created).toMatchObject({ ok: true, dailyPrice: 1200 })
    expect([...mocks.rules.values()][0]).toMatchObject({ label: "国庆", dailyPrice: 1200, status: "active", version: 1 })
  })

  test("历史已确认预约可通过管理入口事务同步按日占用", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const res = await mod.main({ action: "syncBookingOccupancy", id: "booking_1" })
    expect(res).toMatchObject({ ok: true, syncedBookingId: "booking_1", kind: "booking" })
    expect(mocks.days.size).toBe(2)
    expect([...mocks.days.values()].every((item) => item.bookingId === "booking_1")).toBe(true)
  })
})
