jest.mock("wx-server-sdk")

function missing() {
  return Promise.reject(new Error("document not found"))
}

function createMockDb() {
  const days = new Map()
  const blocks = new Map()
  const rules = new Map()
  const vehicles = new Map(["vehicle_1", "vehicle_2"].map((id) => [id, { status: "idle", brandModel: "BMW M4", priceDay: 800 }]))
  const bookings = new Map([["booking_1", { vehicleId: "vehicle_1", vehicleName: "BMW M4", startDate: "2026-09-01", endDate: "2026-09-02", status: "confirmed" }]])
  const maps = { vehicle_calendar_days: days, vehicle_availability_blocks: blocks, vehicle_price_rules: rules, vehicles, bookings }
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const operationCounts = []
  function stateDoc(map, id, operation = () => {}) {
    const api = {
      get: async () => { operation(id, false); return map.has(id) ? { data: { _id: id, ...map.get(id) } } : missing() },
      field: () => ({ get: api.get }),
      set: async ({ data }) => { operation(id, true); map.set(id, { ...data }); return { _id: id } },
      update: async ({ data }) => {
        operation(id, true)
        if (!map.has(id)) return missing()
        map.set(id, { ...map.get(id), ...data })
        return { stats: { updated: 1 } }
      },
      remove: async () => { operation(id, true); map.delete(id); return { stats: { removed: 1 } } }
    }
    return api
  }
  const db = {
    serverDate: jest.fn(() => ({ __type: "serverDate" })),
    runTransaction: jest.fn(async (callback) => {
      // Model CloudBase doc-only transactions, a 100-operation limit, atomic writes,
      // and write conflicts. In particular two new price rules must share a guard write.
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const originals = Object.fromEntries(Object.entries(maps).map(([name, map]) => [name, new Map(map)]))
        const working = Object.fromEntries(Object.entries(maps).map(([name, map]) => [name, new Map(map)]))
        const writes = new Map()
        let operations = 0
        const result = await callback({ collection: (name) => ({
          doc: (id) => stateDoc(working[name], id, (key, write) => {
            operations += 1
            if (operations > 100) throw new Error("transaction operation limit")
            if (write) writes.set(`${name}/${key}`, { name, id: key })
          })
        }) })
        operationCounts.push(operations)
        if (db.beforeTransactionCommit) await db.beforeTransactionCommit()
        const changed = [...writes.values()].some(({ name, id }) => JSON.stringify(originals[name].get(id)) !== JSON.stringify(maps[name].get(id)))
        if (changed) continue
        for (const { name, id } of writes.values()) {
          if (working[name].has(id)) maps[name].set(id, working[name].get(id))
          else maps[name].delete(id)
        }
        return result
      }
      throw new Error("transaction conflict")
    }),
    collection: jest.fn((name) => {
      if (name === "roles") {
        const chain = { where: () => chain, field: () => chain, limit: () => chain, get: async () => ({ data: [{ role: "admin" }] }) }
        return chain
      }
      if (maps[name]) return {
        doc: (id) => stateDoc(maps[name], id),
        where: (filter) => {
          let offset = 0
          let limit = 100
          const chain = {
            field: () => chain, orderBy: () => chain,
            skip: (value) => { offset = value; return chain },
            limit: (value) => { limit = value; return chain },
            get: async () => ({ data: [...maps[name].entries()].filter(([, value]) => Object.entries(filter).every(([key, match]) => value[key] === match)).sort(([a], [b]) => a.localeCompare(b)).slice(offset, offset + limit).map(([id, value]) => ({ _id: id, ...value })) })
          }
          return chain
        }
      }
      if (name === "audit_logs") return { add: auditAdd }
      if (name === "error_logs") return { add: jest.fn().mockResolvedValue({ _id: "error_1" }) }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }
  return { db, days, blocks, rules, vehicles, bookings, auditAdd, operationCounts }
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
  test.each(["Block", "PriceRule"])("新建%s已落库但响应丢失，重试返回原记录且释放后不重建", async (type) => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const input = { action: `create${type}`, requestId: "calendar_retry_123456", vehicleId: "vehicle_1", kind: "hold", label: "国庆价", dailyPrice: 1000, startDate: "2026-10-01", endDate: "2026-10-02", reason: "已核对" }
    const first = await mod.main(input)
    const idKey = type === "Block" ? "blockId" : "ruleId"
    const records = type === "Block" ? mocks.blocks : mocks.rules
    const saved = JSON.parse(JSON.stringify(records.get(first[idKey])))
    expect(await mod.main({ ...input, reason: " 已核对 " })).toMatchObject({ ok: true, duplicate: true, [idKey]: first[idKey] })
    expect(records.size).toBe(1)
    expect(records.get(first[idKey])).toEqual(saved)
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
    expect(await mod.main({ ...input, reason: "另一份内容" })).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" })
    expect(await mod.main({ action: `release${type}`, id: first[idKey], expectedVersion: 1, reason: "释放原记录" })).toMatchObject({ ok: true })
    const replacement = await mod.main({ ...input, requestId: "calendar_replacement_123" })
    expect(replacement.ok).toBe(true)
    expect(replacement[idKey]).not.toBe(first[idKey])
    const auditCount = mocks.auditAdd.mock.calls.length
    mocks.vehicles.delete("vehicle_1")
    expect(await mod.main(input)).toMatchObject({ ok: true, duplicate: true, [idKey]: first[idKey], status: "released" })
    expect(records.size).toBe(2)
    expect(records.get(first[idKey]).status).toBe("released")
    expect(records.get(replacement[idKey]).status).toBe("active")
    expect(mocks.auditAdd).toHaveBeenCalledTimes(auditCount)
  })

  test.each(["Block", "PriceRule"])("同一新建%s请求并发只落一条，事务重试识别已提交请求", async (type) => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const input = { action: `create${type}`, requestId: "calendar_parallel_123", vehicleId: "vehicle_1", kind: "hold", label: "假期价", dailyPrice: 1000, startDate: "2026-10-01", endDate: "2026-10-02", reason: "核对" }
    const results = await Promise.all([mod.main(input), mod.main(input)])
    expect(results.every((result) => result.ok)).toBe(true)
    expect(results.filter((result) => result.duplicate)).toHaveLength(1)
    const idKey = type === "Block" ? "blockId" : "ruleId"
    expect(results[0][idKey]).toBe(results[1][idKey])
    expect(type === "Block" ? mocks.blocks.size : mocks.rules.size).toBe(1)
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
  })

  test.each(["Block", "PriceRule"])("%s 编辑基线阻止旧修改和旧释放，同内容超时重试不重复写入", async (type) => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const base = { vehicleId: "vehicle_1", kind: "hold", label: "原价格", dailyPrice: 800, startDate: "2026-10-01", endDate: "2026-10-02", reason: "初始维护" }
    const created = await mod.main({ action: `create${type}`, ...base })
    const id = type === "Block" ? created.blockId : created.ruleId
    const records = type === "Block" ? mocks.blocks : mocks.rules
    const updated = { action: `update${type}`, ...base, id, expectedVersion: 1, endDate: "2026-10-03", dailyPrice: 900, reason: "最新调整" }
    expect(await mod.main(updated)).toMatchObject({ ok: true })
    const saved = JSON.parse(JSON.stringify(records.get(id)))
    expect(saved.version).toBe(2)
    expect(await mod.main(updated)).toMatchObject({ ok: true, duplicate: true, version: 2 })
    expect(records.get(id)).toEqual(saved)
    expect(await mod.main({ ...updated, endDate: "2026-10-04", reason: "过期草稿" })).toMatchObject({ ok: false, code: "CALENDAR_VERSION_CONFLICT" })
    expect(await mod.main({ action: `release${type}`, id, expectedVersion: 1, reason: "旧页面释放" })).toMatchObject({ ok: false, code: "CALENDAR_VERSION_CONFLICT" })
    expect(records.get(id)).toEqual(saved)
    expect(await mod.main({ action: `release${type}`, id, expectedVersion: 2, reason: "已核对释放" })).toMatchObject({ ok: true })
    expect(await mod.main({ action: `release${type}`, id, expectedVersion: 2, reason: "已核对释放" })).toMatchObject({ ok: true, duplicate: true })
    expect(records.get(id).version).toBe(3)
  })

  test("历史无版本记录按版本1读取，缺基线不能覆盖修改", async () => {
    const mocks = createMockDb()
    mocks.rules.set("legacy", { vehicleId: "vehicle_1", status: "active", label: "原价", startDate: "2026-10-01", endDate: "2026-10-02", dailyPrice: 800, reason: "原说明" })
    const mod = await loadModule(mocks.db)
    const input = { action: "updatePriceRule", id: "legacy", vehicleId: "vehicle_1", label: "新价", startDate: "2026-10-01", endDate: "2026-10-02", dailyPrice: 900, reason: "新说明" }
    expect(await mod.main(input)).toMatchObject({ ok: false, code: "CALENDAR_VERSION_CONFLICT" })
    expect(await mod.main({ ...input, expectedVersion: 1 })).toMatchObject({ ok: true })
    expect(mocks.rules.get("legacy").version).toBe(2)
  })

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

  test("调整和释放按区间读取日文档，不删除其他档期占用", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const payload = { vehicleId: "vehicle_1", kind: "hold", startDate: "2026-08-10", endDate: "2026-08-12", reason: "人工保留" }
    const created = await mod.main({ action: "createBlock", ...payload, requestId: "calendar_create_boundary_123" })
    const moved = await mod.main({ action: "updateBlock", ...payload, id: created.blockId, expectedVersion: 1, startDate: "2026-08-11", endDate: "2026-08-13" })
    expect(moved.ok).toBe(true)
    expect([...mocks.days.values()].map((day) => day.date).sort()).toEqual(["2026-08-11", "2026-08-12", "2026-08-13"])
    const foreignId = mod._test.dayDocumentId("vehicle_1", "2026-08-12")
    mocks.days.set(foreignId, { ...mocks.days.get(foreignId), blockId: "another_block" })
    expect(await mod.main({ action: "releaseBlock", id: created.blockId, expectedVersion: 2, reason: "取消保留" })).toMatchObject({ ok: true })
    expect(mocks.days.size).toBe(1)
    expect(mocks.days.get(foreignId).blockId).toBe("another_block")
    expect(mocks.blocks.get(created.blockId).status).toBe("released")
  })

  test("预约占用不可从人工区间入口修改或释放", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const synced = await mod.main({ action: "syncBookingOccupancy", id: "booking_1" })
    const released = await mod.main({ action: "releaseBlock", id: synced.blockId, reason: "人工释放" })
    const updated = await mod.main({ action: "updateBlock", id: synced.blockId, vehicleId: "vehicle_1", kind: "hold", startDate: "2026-09-02", endDate: "2026-09-03", reason: "人工调整" })
    expect(released.code).toBe("BOOKING_BLOCK_PROTECTED")
    expect(updated.code).toBe("BOOKING_BLOCK_PROTECTED")
    expect(mocks.days.size).toBe(2)
    expect([...mocks.days.values()].every((day) => day.bookingId === "booking_1")).toBe(true)
  })

  test("47天占用可以创建并调整一天，48天拒绝且旧长区间不会部分释放", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const payload = { vehicleId: "vehicle_1", kind: "hold", startDate: "2026-01-01", endDate: "2026-02-16", reason: "保留" }
    const created = await mod.main({ action: "createBlock", ...payload, requestId: "calendar_full_range_123" })
    expect(created.ok).toBe(true)
    expect(mocks.days.size).toBe(47)
    expect(mocks.operationCounts[0]).toBe(97)
    expect(await mod.main({ action: "updateBlock", ...payload, id: created.blockId, expectedVersion: 1, startDate: "2026-01-02", endDate: "2026-02-17" })).toMatchObject({ ok: true })
    expect(await mod.main({ action: "createBlock", ...payload, vehicleId: "vehicle_2", endDate: "2026-02-17" })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(await mod.main({ action: "updateBlock", ...payload, id: created.blockId, expectedVersion: 2, startDate: "2026-04-01", endDate: "2026-05-17" })).toMatchObject({ ok: false, code: "OCCUPANCY_RANGE_TOO_LARGE" })
    mocks.blocks.set("legacy", { ...payload, startDate: "2026-04-01", endDate: "2026-05-20", status: "active" })
    const legacyDay = mod._test.dayDocumentId("vehicle_1", "2026-04-01")
    mocks.days.set(legacyDay, { blockId: "legacy" })
    expect(await mod.main({ action: "releaseBlock", id: "legacy", expectedVersion: 1, reason: "取消" })).toMatchObject({ ok: false, code: "OCCUPANCY_RANGE_TOO_LARGE" })
    expect(mocks.blocks.get("legacy").status).toBe("active")
    expect(mocks.days.has(legacyDay)).toBe(true)
    expect(Math.max(...mocks.operationCounts)).toBeLessThanOrEqual(100)
  })

  test("预约占用同步同样遵循47天边界", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    mocks.bookings.set("booking_1", { ...mocks.bookings.get("booking_1"), startDate: "2026-01-01", endDate: "2026-02-17" })
    expect(await mod.main({ action: "syncBookingOccupancy", id: "booking_1" })).toMatchObject({ ok: false, code: "BOOKING_DATES_INVALID" })
    expect(mocks.days.size).toBe(0)
    mocks.bookings.get("booking_1").endDate = "2026-02-16"
    expect(await mod.main({ action: "syncBookingOccupancy", id: "booking_1" })).toMatchObject({ ok: true })
    expect(mocks.days.size).toBe(47)
    expect(Math.max(...mocks.operationCounts)).toBeLessThanOrEqual(100)
  })

  test("取消与首次同步占用竞争时，旧confirmed快照不能在取消后补建占用", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    mocks.db.beforeTransactionCommit = async () => {
      mocks.db.beforeTransactionCommit = null
      mocks.bookings.set("booking_1", { ...mocks.bookings.get("booking_1"), status: "cancelled" })
    }
    expect(await mod.main({ action: "syncBookingOccupancy", id: "booking_1" })).toMatchObject({ ok: false, code: "STATUS_NOT_ALLOWED" })
    expect(mocks.days.size).toBe(0)
    expect(mocks.blocks.size).toBe(0)
    expect(mocks.bookings.get("booking_1").status).toBe("cancelled")
  })

  test("并发新建重叠价格只有一个成功，车辆版本使后到请求重新检查", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const payload = { action: "createPriceRule", vehicleId: "vehicle_1", label: "假日", startDate: "2026-10-01", endDate: "2026-10-03", dailyPrice: 1000, reason: "假日价" }
    const results = await Promise.all([mod.main(payload), mod.main({ ...payload, dailyPrice: 2000 })])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.filter((result) => result.code === "PRICE_RULE_CONFLICT")).toHaveLength(1)
    expect(mocks.rules.size).toBe(1)
    expect(mocks.vehicles.get("vehicle_1").priceRuleVersion).toBe(1)
  })

  test("调换车辆和停用价格规则也推进共享版本，停用后可创建新规则", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    const payload = { vehicleId: "vehicle_1", label: "假日", startDate: "2026-10-01", endDate: "2026-10-03", dailyPrice: 1000, reason: "假日价" }
    const created = await mod.main({ action: "createPriceRule", ...payload })
    expect(await mod.main({ action: "updatePriceRule", ...payload, id: created.ruleId, expectedVersion: 1, vehicleId: "vehicle_2" })).toMatchObject({ ok: true })
    expect(mocks.vehicles.get("vehicle_1").priceRuleVersion).toBe(2)
    expect(mocks.vehicles.get("vehicle_2").priceRuleVersion).toBe(1)
    expect(await mod.main({ action: "releasePriceRule", id: created.ruleId, expectedVersion: 2, reason: "停用" })).toMatchObject({ ok: true })
    expect(mocks.vehicles.get("vehicle_2").priceRuleVersion).toBe(2)
    expect(await mod.main({ action: "createPriceRule", ...payload, vehicleId: "vehicle_2" })).toMatchObject({ ok: true })
  })

  test("超过200条价格规则仍检查全部候选且90天价格区间可保存", async () => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    for (let i = 0; i < 205; i += 1) mocks.rules.set(`old_${i}`, { vehicleId: "vehicle_1", status: "active", startDate: "2025-01-01", endDate: "2025-01-01" })
    mocks.rules.set("z_conflict", { vehicleId: "vehicle_1", status: "active", startDate: "2026-01-10", endDate: "2026-01-10" })
    const payload = { action: "createPriceRule", vehicleId: "vehicle_1", label: "长租价", startDate: "2026-01-01", endDate: "2026-03-31", dailyPrice: 0, reason: "活动价" }
    expect(await mod.main(payload)).toMatchObject({ ok: false, code: "PRICE_RULE_CONFLICT" })
    expect(await mod.main({ ...payload, vehicleId: "vehicle_2" })).toMatchObject({ ok: true, dailyPrice: 0 })
  })

  test.each(["", " ", null, undefined])("空每日价格 %p 不会保存成免费", async (dailyPrice) => {
    const mocks = createMockDb()
    const mod = await loadModule(mocks.db)
    expect(await mod.main({ action: "createPriceRule", vehicleId: "vehicle_1", label: "假日", startDate: "2026-10-01", endDate: "2026-10-03", dailyPrice, reason: "调整" })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(mocks.rules.size).toBe(0)
  })
})
