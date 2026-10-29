jest.mock("wx-server-sdk")
const crypto = require("crypto")
const blockId = `booking_${crypto.createHash("sha256").update("booking_1").digest("hex").slice(0, 24)}`

function createMockDb(status = "confirmed") {
  const state = {
    docs: {
      bookings: { booking_1: { _id: "booking_1", openid: "user_openid", vehicleId: "car_1", status } },
      vehicle_calendar_days: { day_1: { _id: "day_1", bookingId: "booking_1" } },
      vehicle_availability_blocks: { [blockId]: { bookingId: "booking_1", status: "active" } }
    },
    failRemoval: false,
    beforeTransaction: null,
    beforeOperation: null,
    lastTransaction: null,
    operationCount: 0
  }
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const countOperation = (writable) => {
    if (writable && ++state.operationCount > 100) throw new Error("Transaction exceeds 100 operations")
  }
  const doc = (name, id, transaction) => {
    const writable = Boolean(transaction)
    const perform = (method, operation) => {
      const task = (async () => {
        countOperation(writable)
        if (!transaction) return operation(state.docs)
        transaction.pending += 1
        try {
          if (state.beforeOperation) await state.beforeOperation({ name, id, method })
          if (!transaction.active) {
            transaction.lateOperations.push({ name, id, method })
            throw new Error("Transaction already finished")
          }
          return operation(transaction.docs)
        } finally {
          transaction.pending -= 1
        }
      })()
      if (transaction) transaction.tasks.push(task)
      return task
    }
    const reference = {
      field: jest.fn((fields) => {
        if (name === "bookings") expect(fields).toEqual({ openid: true, vehicleId: true, status: true, calendarSyncVersion: true })
        return reference
      }),
      get: jest.fn(() => perform("get", (docs) => ({ data: docs[name][id] ? { ...docs[name][id] } : null }))),
      update: jest.fn(({ data }) => perform("update", (docs) => {
        if (!writable) throw new Error("Mutation outside transaction")
        Object.assign(docs[name][id], data)
        return { stats: { updated: 1 } }
      })),
      remove: jest.fn(() => perform("remove", (docs) => {
        if (!writable) throw new Error("Mutation outside transaction")
        if (state.failRemoval) throw new Error("simulated removal failure")
        delete docs[name][id]
        return { stats: { removed: 1 } }
      }))
    }
    return reference
  }
  const db = {
    serverDate: jest.fn(() => "2099-08-01T00:00:00.000Z"),
    collection: jest.fn((name) => {
      if (name === "audit_logs") return { add: auditAdd }
      if (name === "error_logs") return { add: jest.fn().mockResolvedValue({}) }
      return {
        doc: (id) => doc(name, id, false),
        where: (filter) => ({ limit: () => ({ get: async () => ({ data: Object.values(state.docs[name]).filter((item) => item.bookingId === filter.bookingId).map((item) => ({ ...item })) }) }) })
      }
    }),
    runTransaction: jest.fn(async (callback) => {
      state.operationCount = 0
      if (state.beforeTransaction) state.beforeTransaction()
      const staged = {
        docs: JSON.parse(JSON.stringify(state.docs)),
        active: true,
        pending: 0,
        tasks: [],
        lateOperations: []
      }
      state.lastTransaction = staged
      // Production transactions do not support collection.where().
      const transaction = { collection: (name) => ({ doc: (id) => doc(name, id, staged) }) }
      try {
        const result = await callback(transaction)
        state.docs = staged.docs
        return result
      } finally {
        staged.pendingAtFinish = staged.pending
        staged.active = false
      }
    })
  }
  return { db, state, auditAdd }
}

async function loadModule(db, openid = "user_openid") {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb(db)
  return require("../cloudfunctions/bookingCancel/index")
}

describe("cloudfunctions/bookingCancel atomic cancellation", () => {
  afterEach(() => jest.restoreAllMocks())

  test.each(["get", "remove"])("日历 %s 中途失败时没有请求越过回滚，且可以完整重试", async (method) => {
    jest.spyOn(console, "error").mockImplementation(() => {})
    const { db, state, auditAdd } = createMockDb()
    state.docs.vehicle_calendar_days.day_2 = { _id: "day_2", bookingId: "booking_1" }
    state.docs.vehicle_calendar_days.day_3 = { _id: "day_3", bookingId: "booking_1" }
    const before = JSON.parse(JSON.stringify(state.docs))
    let signalFailureStarted, failOperation, releaseLaterOperation
    const failureStarted = new Promise((resolve) => { signalFailureStarted = resolve })
    const failureGate = new Promise((resolve, reject) => { failOperation = reject })
    const laterGate = new Promise((resolve) => { releaseLaterOperation = resolve })
    state.beforeOperation = (operation) => {
      if (operation.name !== "vehicle_calendar_days" || operation.method !== method) return
      if (operation.id === "day_2") {
        signalFailureStarted()
        return failureGate
      }
      if (operation.id === "day_3") return laterGate
    }
    const mod = await loadModule(db)
    const cancellation = mod.main({ id: "booking_1" })
    await failureStarted
    failOperation(new Error("injected calendar operation failure"))
    const result = await cancellation
    const failedTransaction = state.lastTransaction
    releaseLaterOperation()
    await Promise.allSettled(failedTransaction.tasks)

    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(failedTransaction.pendingAtFinish).toBe(0)
    expect(failedTransaction.lateOperations).toEqual([])
    expect(state.docs).toEqual(before)
    expect(auditAdd).not.toHaveBeenCalled()
    if (method === "remove") {
      // A real partial mutation happened before failure; only the staged copy changed.
      expect(failedTransaction.docs.vehicle_calendar_days.day_1).toBeUndefined()
      expect(failedTransaction.docs.bookings.booking_1.status).toBe("cancelled")
    }

    state.beforeOperation = null
    expect(await mod.main({ id: "booking_1" })).toMatchObject({ ok: true, status: "cancelled" })
    expect(state.docs.vehicle_calendar_days).toEqual({})
    expect(state.docs.vehicle_availability_blocks[blockId].status).toBe("released")
    expect(auditAdd).toHaveBeenCalledTimes(1)
    expect(state.lastTransaction.pendingAtFinish).toBe(0)
  })

  test("旧订单按实际预算释放：48个日期100次操作，49个日期拒绝且不改状态", async () => {
    for (const count of [48, 49]) {
      const { db, state } = createMockDb()
      state.docs.vehicle_calendar_days = Object.fromEntries(Array.from({ length: count }, (_, index) => [`day_${index}`, { _id: `day_${index}`, bookingId: "booking_1" }]))
      const mod = await loadModule(db)
      const result = await mod.main({ id: "booking_1" })
      if (count === 48) {
        expect(result.ok).toBe(true)
        expect(state.operationCount).toBe(100)
        expect(state.docs.vehicle_calendar_days).toEqual({})
      } else {
        expect(result.code).toBe("OCCUPANCY_LIMIT")
        expect(state.docs.bookings.booking_1.status).toBe("confirmed")
        expect(Object.keys(state.docs.vehicle_calendar_days)).toHaveLength(49)
        expect(state.docs.vehicle_availability_blocks[blockId].status).toBe("active")
        expect(state.operationCount).toBeLessThanOrEqual(100)
      }
    }
  })

  test("用户取消待联系预约并记录审计，事务内使用文档操作", async () => {
    const { db, state, auditAdd } = createMockDb("pending")
    const mod = await loadModule(db)
    expect(await mod.main({ id: "booking_1" })).toMatchObject({ ok: true, status: "cancelled" })
    expect(state.docs.bookings.booking_1.status).toBe("cancelled")
    expect(db.runTransaction).toHaveBeenCalledTimes(1)
    expect(auditAdd).toHaveBeenCalledWith({ data: expect.objectContaining({ action: "bookingCancel", fromStatus: "pending", toStatus: "cancelled" }) })
  })

  test("已确认订单与档期占用原子取消，重试成功且不重复记审计", async () => {
    const { db, state, auditAdd } = createMockDb()
    const mod = await loadModule(db)
    expect((await mod.main({ id: "booking_1" })).ok).toBe(true)
    expect(state.docs.bookings.booking_1.status).toBe("cancelled")
    expect(state.docs.vehicle_calendar_days).toEqual({})
    expect(state.docs.vehicle_availability_blocks[blockId]).toMatchObject({ status: "released" })
    expect((await mod.main({ id: "booking_1" })).ok).toBe(true)
    expect(auditAdd).toHaveBeenCalledTimes(1)
  })

  test("档期释放失败时回滚订单状态，之后重试能完整完成", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {})
    const { db, state } = createMockDb()
    state.failRemoval = true
    const mod = await loadModule(db)
    expect((await mod.main({ id: "booking_1" })).code).toBe("INTERNAL_ERROR")
    expect(state.docs.bookings.booking_1.status).toBe("confirmed")
    expect(state.docs.vehicle_calendar_days.day_1.bookingId).toBe("booking_1")
    expect(state.docs.vehicle_availability_blocks[blockId].status).toBe("active")
    state.failRemoval = false
    expect((await mod.main({ id: "booking_1" })).ok).toBe(true)
    expect(state.docs.vehicle_calendar_days).toEqual({})
  })

  test("取消成功响应丢失后重试保留首次释放时间且不重复审计", async () => {
    const { db, state, auditAdd } = createMockDb()
    const mod = await loadModule(db)
    db.serverDate.mockReturnValue("2099-08-01T01:00:00.000Z")
    expect(await mod.main({ id: "booking_1" })).toMatchObject({ ok: true })
    db.serverDate.mockReturnValue("2099-08-01T02:00:00.000Z")
    expect(await mod.main({ id: "booking_1" })).toMatchObject({ ok: true })
    expect(state.docs.vehicle_availability_blocks[blockId].releasedAt).toBe("2099-08-01T01:00:00.000Z")
    expect(auditAdd).toHaveBeenCalledTimes(1)
    expect(state.docs.vehicle_calendar_days).toEqual({})
  })

  test("历史已取消但仍有档期的订单允许重试清理", async () => {
    const { db, state, auditAdd } = createMockDb("cancelled")
    const mod = await loadModule(db)
    expect((await mod.main({ id: "booking_1" })).ok).toBe(true)
    expect(state.docs.vehicle_calendar_days).toEqual({})
    expect(auditAdd).not.toHaveBeenCalled()
  })

  test("已结束和他人的订单不能取消，缺失订单返回 NOT_FOUND", async () => {
    const { db, state } = createMockDb("completed")
    const mod = await loadModule(db)
    expect((await mod.main({ id: "booking_1" })).code).toBe("STATUS_NOT_ALLOWED")
    state.docs.bookings.booking_1.status = "pending"
    state.docs.bookings.booking_1.openid = "other_user"
    expect((await mod.main({ id: "booking_1" })).code).toBe("FORBIDDEN")
    expect((await mod.main({ id: "missing" })).code).toBe("NOT_FOUND")
    expect(db.runTransaction).not.toHaveBeenCalled()
  })

  test("预查询后状态已变更时不覆盖状态或释放新增档期", async () => {
    const { db, state } = createMockDb("quoted")
    state.beforeTransaction = () => { state.docs.bookings.booking_1.status = "confirmed" }
    const mod = await loadModule(db)
    expect((await mod.main({ id: "booking_1" })).code).toBe("STATUS_CONFLICT")
    expect(state.docs.bookings.booking_1.status).toBe("confirmed")
    expect(state.docs.vehicle_calendar_days.day_1).toBeDefined()
  })

  test("日占用已被其它预约复用时不误删", async () => {
    const { db, state } = createMockDb()
    state.beforeTransaction = () => { state.docs.vehicle_calendar_days.day_1.bookingId = "other_booking" }
    const mod = await loadModule(db)
    expect((await mod.main({ id: "booking_1" })).ok).toBe(true)
    expect(state.docs.vehicle_calendar_days.day_1.bookingId).toBe("other_booking")
  })

  test("预查询后同步新增档期但状态未变时拒绝取消，重试完整释放", async () => {
    const { db, state, auditAdd } = createMockDb()
    state.beforeTransaction = () => {
      state.docs.bookings.booking_1.calendarSyncVersion = 1
      state.docs.vehicle_calendar_days.day_2 = { _id: "day_2", bookingId: "booking_1" }
    }
    const mod = await loadModule(db)
    expect((await mod.main({ id: "booking_1" })).code).toBe("STATUS_CONFLICT")
    expect(state.docs.bookings.booking_1.status).toBe("confirmed")
    expect(Object.keys(state.docs.vehicle_calendar_days)).toEqual(["day_1", "day_2"])
    expect(state.docs.vehicle_availability_blocks[blockId].status).toBe("active")
    expect(auditAdd).not.toHaveBeenCalled()

    state.beforeTransaction = null
    expect((await mod.main({ id: "booking_1" })).ok).toBe(true)
    expect(state.docs.bookings.booking_1.status).toBe("cancelled")
    expect(state.docs.vehicle_calendar_days).toEqual({})
    expect(state.docs.vehicle_availability_blocks[blockId].status).toBe("released")
    expect(auditAdd).toHaveBeenCalledTimes(1)
  })
})
