jest.mock("wx-server-sdk")

const BASE = { _id: "car_1", plateNumber: "京A12345", brandModel: "BMW", registerDate: "2026-01-01", vehicleType: "sedan", status: "idle" }

function setup(name, initial = BASE, beforeTransaction) {
  let record = initial && { ...initial }
  const writes = []
  const audit = jest.fn(async () => ({}))
  const query = (rows) => {
    const ref = { get: async () => ({ data: rows }) }
    for (const method of ["field", "limit"]) ref[method] = () => ref
    return ref
  }
  const vehicleDoc = () => {
    const ref = { get: async () => ({ data: record && { ...record } }) }
    ref.field = () => ref
    return ref
  }
  let queue = Promise.resolve()
  const db = {
    serverDate: () => new Date("2026-09-30T00:00:00Z"),
    collection: (collection) => {
      if (collection === "roles") return { where: () => query([{ role: "admin" }]) }
      if (collection === "vehicles") return { doc: vehicleDoc, where: () => query([]) }
      if (["audit_logs", "error_logs"].includes(collection)) return { add: audit }
      throw new Error(`unexpected collection: ${collection}`)
    },
    runTransaction: jest.fn((callback) => {
      const result = queue.then(async () => {
        if (beforeTransaction) record = beforeTransaction(record)
        const pending = []
        const result = await callback({ collection: (collection) => {
          expect(collection).toBe("vehicles")
          return { doc: (id) => {
            expect(id).toBe("car_1")
            return { get: async () => ({ data: record && { ...record } }), update: async ({ data }) => pending.push(data) }
          } }
        } })
        for (const patch of pending) { record = { ...record, ...patch }; writes.push(patch) }
        return result
      })
      queue = result.catch(() => {})
      return result
    })
  }
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "admin_openid" })
  cloud.__setMockDb(db)
  return { mod: require(`../cloudfunctions/${name}/index`), writes, audit, current: () => record }
}

describe("车辆编辑和状态并发版本", () => {
  test.each(["vehicleUpdate", "vehicleUpdateStatus", "vehicleRetire", "vehicleRestore"])("%s 的幂等字段比较不受对象键顺序影响", async (name) => {
    const { updateVehicle } = require(`../cloudfunctions/${name}/vehicleRevision`)
    const update = jest.fn()
    const db = { runTransaction: (callback) => callback({ collection: () => ({ doc: () => ({ get: async () => ({ data: { vehicleVersion: 1, status: "idle", settings: { second: 2, first: 1 } } }), update }) }) }) }
    expect(await updateVehicle(db, "car_1", { settings: { first: 1, second: 2 } }, 0, "idle")).toMatchObject({ updated: false })
    expect(update).not.toHaveBeenCalled()
  })

  test("保存已成功但响应丢失时相同表单可重试，不重复写或审计", async () => {
    const mock = setup("vehicleUpdate")
    const input = { ...BASE, id: "car_1", note: "已核对档案", expectedVersion: 0 }
    expect(await mock.mod.main(input)).toMatchObject({ ok: true, vehicleVersion: 1 })
    expect(await mock.mod.main(input)).toMatchObject({ ok: true, vehicleVersion: 1 })
    expect(mock.writes).toHaveLength(1)
    expect(mock.audit).toHaveBeenCalledTimes(1)
    expect(mock.current().vehicleVersion).toBe(1)
  })

  test("保存后又被另一管理员修改时不能把旧重试误当成成功", async () => {
    let transactions = 0
    const mock = setup("vehicleUpdate", BASE, (current) => ++transactions === 2 ? { ...current, note: "另一位的新修改", vehicleVersion: 2 } : current)
    const input = { ...BASE, id: "car_1", note: "原保存内容", expectedVersion: 0 }
    expect(await mock.mod.main(input)).toMatchObject({ ok: true })
    expect(await mock.mod.main(input)).toMatchObject({ ok: false, code: "VERSION_CONFLICT" })
    expect(mock.current().note).toBe("另一位的新修改")
    expect(mock.writes).toHaveLength(1)
    expect(mock.audit).toHaveBeenCalledTimes(1)
  })

  test.each([
    ["vehicleUpdateStatus", "idle", "active", "alreadyUpdated"],
    ["vehicleRetire", "idle", "retired", "alreadyRetired"],
    ["vehicleRestore", "retired", "idle", "alreadyRestored"]
  ])("%s 预读后相同状态操作已完成时不重复审计", async (name, before, after, flag) => {
    const mock = setup(name, { ...BASE, status: before }, (current) => ({ ...current, status: after, vehicleVersion: 1 }))
    expect(await mock.mod.main({ id: "car_1", status: after, expectedVersion: 0 })).toMatchObject({ ok: true, [flag]: true })
    expect(mock.writes).toEqual([])
    expect(mock.audit).not.toHaveBeenCalled()
  })

  test("旧编辑页不能恢复另一管理员已停用的车辆", async () => {
    const mock = setup("vehicleUpdate", { ...BASE, status: "retired", vehicleVersion: 1 })
    const res = await mock.mod.main({ ...BASE, id: "car_1", expectedVersion: 0 })
    expect(res.code).toBe("VERSION_CONFLICT")
    expect(mock.current().status).toBe("retired")
    expect(mock.writes).toEqual([])
  })

  test("同时提交相同版本的两份表单只允许一份保存", async () => {
    const mock = setup("vehicleUpdate")
    const result = await Promise.all(["甲的修改", "乙的修改"].map((note) => mock.mod.main({ ...BASE, id: "car_1", note, expectedVersion: 0 })))
    expect(result.filter((item) => item.ok)).toHaveLength(1)
    expect(result.filter((item) => item.code === "VERSION_CONFLICT")).toHaveLength(1)
    expect(mock.writes).toHaveLength(1)
    expect(mock.current().vehicleVersion).toBe(1)
  })

  test.each([
    ["vehicleUpdateStatus", "idle", { status: "active" }],
    ["vehicleRetire", "idle", {}],
    ["vehicleRestore", "retired", {}]
  ])("%s 在预读后状态变化时拒绝覆盖", async (name, status, input) => {
    const mock = setup(name, { ...BASE, status }, (current) => ({ ...current, status: "maintenance", vehicleVersion: 1 }))
    const res = await mock.mod.main({ id: "car_1", ...input, expectedVersion: 0 })
    expect(res.code).toBe("VERSION_CONFLICT")
    expect(mock.current().status).toBe("maintenance")
    expect(mock.writes).toEqual([])
  })

  test("确认最新版本可恢复车辆并递增版本", async () => {
    const mock = setup("vehicleRestore", { ...BASE, status: "retired", vehicleVersion: 6 })
    expect((await mock.mod.main({ id: "car_1", expectedVersion: 6 })).ok).toBe(true)
    expect(mock.current()).toMatchObject({ status: "idle", vehicleVersion: 7 })
  })

  test("不带版本的旧客户端不能覆盖已经更新的车辆", async () => {
    const mock = setup("vehicleUpdate", { ...BASE, vehicleVersion: 2 })
    expect((await mock.mod.main({ ...BASE, id: "car_1" })).code).toBe("VERSION_CONFLICT")
    expect(mock.writes).toEqual([])
  })

  test("预读后被删除的车辆不会被更新操作重建", async () => {
    const mock = setup("vehicleRetire", BASE, () => null)
    expect((await mock.mod.main({ id: "car_1", expectedVersion: 0 })).code).toBe("NOT_FOUND")
    expect(mock.writes).toEqual([])
  })
})
