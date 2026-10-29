jest.mock("wx-server-sdk")

const { guardId } = require("../cloudfunctions/vehicleDelete/imageLifecycle")

function deferred() {
  let resolve
  let reject
  const promise = new Promise((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function copyMap(map) {
  return new Map([...map].map(([id, value]) => [id, JSON.parse(JSON.stringify(value))]))
}

function createTransactionalDb({ failureIndex, failureMethod }) {
  const files = ["cloud://first", "cloud://middle", "cloud://last"]
  const claimIds = files.map((fileId) => guardId("car_1", fileId))
  const records = {
    vehicles: new Map([["car_1", { imageList: files, coverImage: files[0], bookingReferenceVersion: 1 }]]),
    pending_file_deletions: new Map([[claimIds[0], { deletionState: "pending", attemptCount: 2 }]])
  }
  const initial = Object.fromEntries(Object.entries(records).map(([name, map]) => [name, copyMap(map)]))
  const failureStarted = deferred()
  const failure = deferred()
  const laterReads = deferred()
  const transactions = []
  const lateOperations = []
  const pending = new Set()
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const errorAdd = jest.fn().mockResolvedValue({ _id: "error_1" })

  const query = (data) => {
    const chain = { where: () => chain, field: () => chain, limit: () => chain, get: async () => ({ data }) }
    return chain
  }

  function document(name, id, transaction) {
    const map = transaction ? transaction.working[name] : records[name]
    function run(method, effect) {
      if (!transaction) return Promise.resolve(effect())
      const task = (async () => {
        if (transaction.closed) {
          lateOperations.push({ name, id, method })
          throw new Error("transaction already closed")
        }
        transaction.active += 1
        try {
          const index = name === "pending_file_deletions" ? claimIds.indexOf(id) : -1
          if (transaction === transactions[0] && index >= 0) {
            if (index === failureIndex && method === failureMethod) {
              failureStarted.resolve()
              await failure.promise
            } else if (index > failureIndex && method === "get") {
              await laterReads.promise
            }
          }
          // Let an in-flight read return even after rollback so the real claim
          // continuation exposes attempts to write through the closed transaction.
          const result = effect()
          if (method !== "get") transaction.writes.push({ name, id, method })
          return result
        } finally {
          transaction.active -= 1
        }
      })()
      pending.add(task)
      task.then(() => pending.delete(task), () => pending.delete(task))
      return task
    }
    const doc = {
      field: () => doc,
      get: () => run("get", () => ({ data: map.get(id) || null })),
      set: ({ data }) => run("set", () => { map.set(id, { ...data }); return { _id: id } }),
      update: ({ data }) => run("update", () => { map.set(id, { ...map.get(id), ...data }); return { stats: { updated: 1 } } }),
      remove: () => run("remove", () => ({ stats: { removed: map.delete(id) ? 1 : 0 } }))
    }
    return doc
  }

  const db = {
    serverDate: () => ({ __type: "serverDate" }),
    collection: (name) => {
      if (name === "roles") return query([{ role: "admin" }])
      if (name === "bookings") return query([])
      if (name === "audit_logs") return { add: auditAdd }
      if (name === "error_logs") return { add: errorAdd }
      if (records[name]) return { doc: (id) => document(name, id) }
      throw new Error(`Unexpected collection: ${name}`)
    },
    runTransaction: async (callback) => {
      const transaction = {
        working: Object.fromEntries(Object.entries(records).map(([name, map]) => [name, copyMap(map)])),
        active: 0, closed: false, writes: []
      }
      transactions.push(transaction)
      try {
        const result = await callback({ collection: (name) => ({ doc: (id) => document(name, id, transaction) }) })
        Object.assign(records, transaction.working)
        transaction.committed = true
        return result
      } finally {
        // Match runTransaction's lifetime: commit/rollback follows callback
        // settlement, without silently draining work the callback did not await.
        transaction.activeAtExit = transaction.active
        transaction.closed = true
      }
    }
  }
  return {
    db, files, claimIds, records, initial, transactions, lateOperations, auditAdd, errorAdd,
    failureStarted, failure,
    finishPendingReads: async () => {
      laterReads.resolve()
      while (pending.size) await Promise.allSettled([...pending])
      await new Promise((resolve) => setImmediate(resolve))
    }
  }
}

async function loadVehicleDelete(db) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "admin_1" })
  cloud.__setMockDb(db)
  cloud.deleteFile.mockImplementation(async ({ fileList }) => ({ fileList: fileList.map((fileID) => ({ fileID, status: 0 })) }))
  let mod
  jest.isolateModules(() => { mod = require("../cloudfunctions/vehicleDelete/index") })
  return { mod, cloud }
}

describe("vehicleDelete transaction lifecycle", () => {
  test.each([
    { failureIndex: 0, failureMethod: "get" },
    { failureIndex: 1, failureMethod: "get" },
    { failureIndex: 0, failureMethod: "set" },
    { failureIndex: 1, failureMethod: "set" }
  ])("claim $failureIndex $failureMethod failure rolls back before returning and allows retry", async (scenario) => {
    jest.spyOn(console, "error").mockImplementation(() => {})
    const state = createTransactionalDb(scenario)
    const { mod, cloud } = await loadVehicleDelete(state.db)
    const result = mod.main({ id: "car_1" })
    await state.failureStarted.promise
    state.failure.reject(new Error("injected claim failure"))
    const failed = await result
    await state.finishPendingReads()

    expect(failed).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(state.records).toEqual(state.initial)
    expect(cloud.deleteFile).not.toHaveBeenCalled()
    expect(state.auditAdd).not.toHaveBeenCalled()
    expect(state.errorAdd).toHaveBeenCalledTimes(1)
    const transaction = state.transactions[0]
    expect(transaction.committed).not.toBe(true)
    expect(transaction.writes).toContainEqual({ name: "vehicles", id: "car_1", method: "remove" })
    if (scenario.failureIndex === 1) {
      expect(transaction.writes).toContainEqual({ name: "pending_file_deletions", id: state.claimIds[0], method: "set" })
    }
    expect({ activeAtExit: transaction.activeAtExit, lateOperations: state.lateOperations }).toEqual({ activeAtExit: 0, lateOperations: [] })

    await expect(mod.main({ id: "car_1" })).resolves.toMatchObject({ ok: true, id: "car_1" })
    expect(state.records.vehicles.has("car_1")).toBe(false)
    expect(cloud.deleteFile).toHaveBeenCalledTimes(1)
    expect(cloud.deleteFile).toHaveBeenCalledWith({ fileList: state.files })
    expect(state.auditAdd).toHaveBeenCalledTimes(1)
    for (const id of state.claimIds) {
      expect(state.records.pending_file_deletions.get(id).deletionState).toBe("deleted")
    }
    expect(state.transactions.every((item) => item.activeAtExit === 0)).toBe(true)
  })
})
