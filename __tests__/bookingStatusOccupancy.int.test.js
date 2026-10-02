jest.mock("wx-server-sdk")

function createDb({ failRelease = false, beforeTransaction, dayCount = 2 } = {}) {
  let state = {
    booking: { _id: "booking_1", status: "confirmed", latestPickupHandoverId: "pickup", latestReturnHandoverId: "return", pickupHandoverConfirmedAt: "yes", returnHandoverConfirmedAt: "yes" },
    days: Object.fromEntries(Array.from({ length: dayCount }, (_, index) => [`day_${index + 1}`, { bookingId: "booking_1" }])),
    block: { status: "active" }
  }
  const api = {
    serverDate: () => "now",
    collection(name) {
      if (name === "roles") return { where: () => ({ field: () => ({ limit: () => ({ get: async () => ({ data: [{ role: "admin" }] }) }) }) }) }
      if (name === "bookings") return { doc: () => ({ field: () => ({ get: async () => ({ data: { ...state.booking } }) }) }) }
      if (name === "vehicle_calendar_days") return { where: () => ({ field: () => ({ limit: () => ({ get: async () => ({ data: Object.keys(state.days).map((_id) => ({ _id })) }) }) }) }) }
      if (["audit_logs", "error_logs"].includes(name)) return { add: async () => ({ _id: "log" }) }
      throw new Error(`Unexpected collection: ${name}`)
    },
    runTransaction: jest.fn(async (callback) => {
      if (beforeTransaction) beforeTransaction(state)
      const snapshot = JSON.parse(JSON.stringify(state))
      let operations = 0
      const recordOperation = () => { if (++operations > 100) throw new Error("transaction operation limit exceeded") }
      const tx = { collection: (name) => ({
        // CloudBase transactions intentionally expose no query API in this mock.
        doc: (id) => {
          const read = () => name === "bookings" ? state.booking : name === "vehicle_calendar_days" ? state.days[id] : state.block
          const get = async () => { recordOperation(); return { data: read() && { ...read() } } }
          return {
            get, field: () => ({ get }),
            update: async ({ data }) => {
              recordOperation()
              if (name === "vehicle_availability_blocks" && failRelease) throw new Error("release failed")
              Object.assign(read(), data)
            },
            remove: async () => { recordOperation(); delete state.days[id] }
          }
        }
      }) }
      try { return await callback(tx) } catch (error) { state = snapshot; throw error }
    })
  }
  return { db: api, state: () => state, allowRelease: () => { failRelease = false } }
}

async function load(db) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "admin" })
  cloud.__setMockDb(db)
  return require("../cloudfunctions/bookingUpdateStatus/index")
}

describe("管理员状态与日占用原子更新", () => {
  afterEach(() => jest.restoreAllMocks())

  test("48个历史占用日可在99次操作内释放，49日拒绝且不改变状态", async () => {
    const allowed = createDb({ dayCount: 48 })
    let mod = await load(allowed.db)
    expect(await mod.main({ id: "booking_1", status: "cancelled" })).toMatchObject({ ok: true })
    expect(allowed.state().days).toEqual({})
    const oversized = createDb({ dayCount: 49 })
    mod = await load(oversized.db)
    expect(await mod.main({ id: "booking_1", status: "cancelled" })).toMatchObject({ ok: false, code: "OCCUPANCY_REQUIRES_REVIEW" })
    expect(oversized.state().booking.status).toBe("confirmed")
    expect(Object.keys(oversized.state().days)).toHaveLength(49)
    expect(oversized.db.runTransaction).not.toHaveBeenCalled()
  })

  test.each(["cancelled", "completed"])("%s 与释放档期一起提交，重复操作不会再次写入", async (status) => {
    const mock = createDb()
    const mod = await load(mock.db)
    expect(await mod.main({ id: "booking_1", status })).toMatchObject({ ok: true, updated: true })
    expect(mock.state().booking.status).toBe(status)
    expect(mock.state().days).toEqual({})
    expect(mock.state().block.status).toBe(status === "completed" ? "completed" : "released")
    expect(await mod.main({ id: "booking_1", status })).toMatchObject({ ok: true, updated: false })
    expect(mock.db.runTransaction).toHaveBeenCalledTimes(1)
  })

  test("档期释放故障回滚预约状态，重试能够完成释放", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {})
    const mock = createDb({ failRelease: true })
    const mod = await load(mock.db)
    expect(await mod.main({ id: "booking_1", status: "cancelled" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(mock.state().booking.status).toBe("confirmed")
    expect(Object.keys(mock.state().days)).toHaveLength(2)
    mock.allowRelease()
    expect(await mod.main({ id: "booking_1", status: "cancelled" })).toMatchObject({ ok: true })
    expect(mock.state().days).toEqual({})
  })

  test("事务开始前交接确认失效时拒绝完成，并保留占用", async () => {
    const mock = createDb({ beforeTransaction: (state) => { state.booking.returnHandoverConfirmedAt = null } })
    const mod = await load(mock.db)
    expect(await mod.main({ id: "booking_1", status: "completed" })).toMatchObject({ ok: false, code: "HANDOVER_NOT_CONFIRMED" })
    expect(mock.state().booking.status).toBe("confirmed")
    expect(Object.keys(mock.state().days)).toHaveLength(2)
  })

  test("候选日已归属其他预约时不会误删", async () => {
    const mock = createDb({ beforeTransaction: (state) => { state.days.day_2.bookingId = "booking_2" } })
    const mod = await load(mock.db)
    expect(await mod.main({ id: "booking_1", status: "cancelled" })).toMatchObject({ ok: true })
    expect(mock.state().days).toEqual({ day_2: { bookingId: "booking_2" } })
  })

  test("查询候选日后重新同步了档期时拒绝结束，刷新重试会释放全部占用", async () => {
    let synchronized = false
    const mock = createDb({ beforeTransaction: (state) => {
      if (synchronized) return
      synchronized = true
      state.days.day_3 = { bookingId: "booking_1" }
      state.booking.calendarSyncVersion = 1
    } })
    const mod = await load(mock.db)
    expect(await mod.main({ id: "booking_1", status: "cancelled" })).toMatchObject({ ok: false, code: "STATUS_CONFLICT" })
    expect(mock.state().booking.status).toBe("confirmed")
    expect(mock.state().block.status).toBe("active")
    expect(Object.keys(mock.state().days)).toHaveLength(3)
    expect(await mod.main({ id: "booking_1", status: "cancelled" })).toMatchObject({ ok: true })
    expect(mock.state().days).toEqual({})
  })
})
