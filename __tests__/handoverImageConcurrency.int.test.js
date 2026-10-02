jest.mock("wx-server-sdk")

function createState() {
  const stores = {
    bookings: new Map([["booking_1", { openid: "customer", status: "confirmed" }]]),
    booking_handovers: new Map(), pending_file_deletions: new Map()
  }
  const counts = []
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  function doc(map, id, touch = () => {}, name = "") {
    const api = {
      field: () => api,
      get: async () => { touch(id, false); return { data: map.has(id) ? { _id: id, ...clone(map.get(id)) } : null } },
      set: async ({ data }) => {
        touch(id, true)
        if (name === "pending_file_deletions" && db.failGuardWrite) throw new Error("guard write failed")
        map.set(id, clone(data)); return { stats: { created: 1 } }
      },
      update: async ({ data }) => { touch(id, true); if (!map.has(id)) throw new Error("document not found"); map.set(id, { ...map.get(id), ...clone(data) }); return { stats: { updated: 1 } } },
      remove: async () => { touch(id, true); return { stats: { removed: map.delete(id) ? 1 : 0 } } }
    }
    return api
  }
  function query(map, filter = {}, name = "") {
    let limit = 100
    let offset = 0
    const api = {
      field: () => api, where: (next) => query(map, next, name), orderBy: () => api,
      skip: (value) => { offset = value; return api }, limit: (value) => { limit = Math.min(100, value); return api },
      get: async () => {
        if (name === "booking_handovers" && offset && db.failHistoryPage) throw new Error("history read failed")
        const data = [...map.entries()].filter(([, value]) => Object.entries(filter).every(([key, expected]) => expected && expected.$ne !== undefined ? value[key] !== expected.$ne : value[key] === expected))
          .sort(([a], [b]) => a.localeCompare(b)).slice(offset, offset + limit).map(([id, value]) => ({ _id: id, ...clone(value) }))
        if (name === "booking_handovers" && db.afterHistoryRead) await db.afterHistoryRead()
        return { data }
      }
    }
    return api
  }
  const db = {
    command: { neq: (value) => ({ $ne: value }) }, serverDate: () => new Date().toISOString(),
    collection: (name) => {
      if (name === "roles") return query(new Map([["admin", { role: "admin", openid: "admin" }]]))
      if (name === "app_configs") return query(new Map())
      if (["audit_logs", "error_logs"].includes(name)) return { add: async () => ({ _id: "log" }) }
      if (!stores[name]) throw new Error(`Unexpected collection: ${name}`)
      return { ...query(stores[name], {}, name), doc: (id) => doc(stores[name], id, undefined, name) }
    },
    runTransaction: async (callback) => {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        const before = Object.fromEntries(Object.entries(stores).map(([name, map]) => [name, new Map([...map].map(([id, value]) => [id, clone(value)]))]))
        const working = Object.fromEntries(Object.entries(before).map(([name, map]) => [name, new Map(map)]))
        const writes = new Map()
        let operations = 0
        const result = await callback({ collection: (name) => ({ doc: (id) => doc(working[name], id, (key, write) => {
          operations += 1
          if (operations > 100) throw new Error("transaction operation limit")
          if (write) writes.set(`${name}/${key}`, { name, id: key })
        }, name) }) })
        counts.push(operations)
        if (db.beforeCommit) await db.beforeCommit()
        if ([...writes.values()].some(({ name, id }) => JSON.stringify(before[name].get(id)) !== JSON.stringify(stores[name].get(id)))) continue
        for (const { name, id } of writes.values()) {
          if (working[name].has(id)) stores[name].set(id, clone(working[name].get(id)))
          else stores[name].delete(id)
        }
        return result
      }
      throw new Error("transaction conflict")
    }
  }
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "admin" })
  cloud.__setMockDb(db)
  cloud.deleteFile.mockImplementation(async ({ fileList }) => ({ fileList: fileList.map((fileID) => ({ fileID, status: 0 })) }))
  const helper = require("../cloudfunctions/bookingHandover/handoverImageLifecycle")
  return { db, stores, counts, cloud, guardId: helper.guardId, lifecycle: helper.createHandoverImageLifecycle(db, cloud),
    handover: require("../cloudfunctions/bookingHandover/index"), cleanup: require("../cloudfunctions/pendingFileDeletionProcess/index") }
}

const file = (name) => `cloud://env.bucket/handover-images/booking_1/pickup/${name}.jpg`
const payload = (extra = {}) => ({
  action: "submit", bookingId: "booking_1", stage: "pickup", requestId: "handover_request_1", expectedVersion: 0,
  mileageKm: 1000, energyType: "fuel", energyLevelPercent: 90, damageNote: "未发现损伤",
  photos: ["front", "rear", "left", "right"].map((angle) => ({ angle, fileId: file(angle) })), ...extra
})
function queue(state, source = "bookingHandoverUploadCleanup", files = [file("front")]) {
  state.stores.pending_file_deletions.set("legacy_queue", { source, context: { bookingId: "booking_1", stage: "pickup" }, fileList: files })
}

describe("交接图片关联与清理使用同一事务协议", () => {
  test.each(["afterHistoryRead", "beforeCommit"])("%s 时关联照片使旧清理失效，重试保留已引用图片", async (hook) => {
    const state = createState()
    queue(state)
    state.db[hook] = async () => {
      state.db[hook] = null
      expect(await state.handover.main(payload())).toMatchObject({ ok: true })
    }
    expect(await state.cleanup.main()).toMatchObject({ ok: true, failed: 1 })
    expect(state.cloud.deleteFile).not.toHaveBeenCalled()
    expect(state.stores.pending_file_deletions.has("legacy_queue")).toBe(true)
    expect(await state.cleanup.main()).toMatchObject({ ok: true, preserved: 1 })
    expect(state.stores.booking_handovers.get("booking_1__pickup__v1").photos).toHaveLength(4)
  })

  test("提交读过不存在的guard后清理抢先提交，提交事务重试拒绝引用", async () => {
    const state = createState()
    queue(state)
    state.db.beforeCommit = async () => {
      state.db.beforeCommit = null
      expect(await state.cleanup.main()).toMatchObject({ ok: true, deleted: 1 })
    }
    expect(await state.handover.main(payload())).toMatchObject({ ok: false, code: "IMAGE_DELETION_CONFLICT" })
    expect(state.stores.booking_handovers.size).toBe(0)
  })

  test("删除claim之后不能关联，重排cleanup不复活永久标记", async () => {
    const state = createState()
    queue(state)
    state.cloud.deleteFile.mockImplementation(async ({ fileList }) => {
      expect(await state.handover.main(payload())).toMatchObject({ ok: false, code: "IMAGE_DELETION_CONFLICT" })
      return { fileList: fileList.map((fileID) => ({ fileID, status: 0 })) }
    })
    expect(await state.cleanup.main()).toMatchObject({ ok: true, deleted: 1 })
    const id = state.guardId("booking_1", file("front"))
    expect(state.stores.pending_file_deletions.get(id).deletionState).toBe("deleted")
    expect(await state.handover.main({ action: "cleanupUpload", bookingId: "booking_1", stage: "pickup", fileList: [file("front")] })).toMatchObject({ ok: true })
    expect(state.stores.pending_file_deletions.get(id).deletionState).toBe("deleted")
    expect(await state.cleanup.main()).toMatchObject({ processed: 0 })
  })

  test("归档版本复用旧版本图片时保留旧引用，新增上传清理也检查所有版本", async () => {
    const state = createState()
    await state.handover.main(payload())
    await state.handover.main(payload({ expectedVersion: 1, requestId: "handover_request_2" }))
    expect(await state.handover.main({ action: "archive", bookingId: "booking_1", stage: "pickup", handoverId: "booking_1__pickup__v2" })).toMatchObject({ ok: true })
    expect(state.stores.bookings.get("booking_1").handoverImageRevision).toBe(3)
    expect(await state.cleanup.main()).toMatchObject({ preserved: 4 })
    expect(state.cloud.deleteFile).not.toHaveBeenCalled()
    expect(state.stores.booking_handovers.get("booking_1__pickup__v1").photos).toHaveLength(4)
  })

  test.each(["bookingHandoverArchive", "bookingHandoverUploadCleanup"])("旧%s队列会分页找到第101条引用", async (source) => {
    const state = createState()
    for (let index = 0; index < 101; index += 1) state.stores.booking_handovers.set(`record_${String(index).padStart(4, "0")}`, { bookingId: "booking_1", photos: index === 100 ? [{ fileId: file("front") }] : [] })
    queue(state, source)
    expect(await state.cleanup.main()).toMatchObject({ preserved: 1 })
    expect(state.cloud.deleteFile).not.toHaveBeenCalled()
  })

  test.each(["limit", "pageFailure"])("历史扫描%s不完整时保留队列并禁止删除", async (scenario) => {
    const state = createState()
    for (let index = 0; index < (scenario === "limit" ? 2001 : 101); index += 1) state.stores.booking_handovers.set(`record_${index}`, { bookingId: "booking_1", photos: [] })
    state.db.failHistoryPage = scenario === "pageFailure"
    queue(state)
    expect(await state.cleanup.main()).toMatchObject({ failed: 1 })
    expect(state.cloud.deleteFile).not.toHaveBeenCalled()
    expect(state.stores.pending_file_deletions.has("legacy_queue")).toBe(true)
  })

  test("旧队列迁移guard写失败时事务回滚，原队列保留可重试", async () => {
    const state = createState()
    queue(state)
    state.db.failGuardWrite = true
    expect(await state.cleanup.main()).toMatchObject({ failed: 1 })
    expect(state.stores.bookings.get("booking_1").handoverImageRevision).toBeUndefined()
    expect(state.stores.pending_file_deletions.size).toBe(1)
    expect(state.cloud.deleteFile).not.toHaveBeenCalled()
    state.db.failGuardWrite = false
    expect(await state.cleanup.main()).toMatchObject({ deleted: 1 })
  })

  test("云端逐文件缺失回执保留deleting标记，重试只删除未确认文件", async () => {
    const state = createState()
    queue(state, "bookingHandoverArchive", [file("front"), file("rear")])
    state.cloud.deleteFile.mockResolvedValueOnce({ fileList: [{ fileID: file("front"), status: 0 }] })
    expect(await state.cleanup.main()).toMatchObject({ failed: 1 })
    expect(state.stores.pending_file_deletions.get(state.guardId("booking_1", file("front"))).deletionState).toBe("deleted")
    expect(state.stores.pending_file_deletions.get(state.guardId("booking_1", file("rear"))).deletionState).toBe("deleting")
    expect(await state.cleanup.main()).toMatchObject({ deleted: 1, processed: 1 })
    expect(state.cloud.deleteFile.mock.calls[1][0].fileList).toEqual([file("rear")])
  })

  test("并发清理迟到失败不回退已删除标记", async () => {
    const state = createState()
    const id = state.guardId("booking_1", file("front"))
    state.stores.pending_file_deletions.set(id, { deletionState: "deleting", fileList: [file("front")], source: "bookingHandoverUploadCleanup", context: { bookingId: "booking_1" } })
    let late
    state.cloud.deleteFile.mockImplementationOnce(() => new Promise((resolve) => { late = resolve }))
    const first = state.lifecycle.deleteClaimed("booking_1", [file("front")])
    await state.lifecycle.deleteClaimed("booking_1", [file("front")])
    late({ fileList: [{ fileID: file("front"), status: -1 }] })
    await first
    expect(state.stores.pending_file_deletions.get(id).deletionState).toBe("deleted")
  })

  test.each([{ status: false }, { status: "   " }, { status: [] }])("非明确成功状态%p保留删除标记供重试", async ({ status }) => {
    const state = createState()
    queue(state)
    state.cloud.deleteFile.mockResolvedValueOnce({ fileList: [{ fileID: file("front"), status }] })
    expect(await state.cleanup.main()).toMatchObject({ failed: 1, deleted: 0 })
    const id = state.guardId("booking_1", file("front"))
    expect(state.stores.pending_file_deletions.get(id).deletionState).toBe("deleting")
    expect(await state.cleanup.main()).toMatchObject({ deleted: 1 })
    expect(state.stores.pending_file_deletions.get(id).deletionState).toBe("deleted")
    expect(state.cloud.deleteFile).toHaveBeenCalledTimes(2)
  })

  test("路径按实际booking隔离且9张清理完整事务低于100操作", async () => {
    const state = createState()
    const spoof = "cloud://env.bucket/handover-images/other/pickup/handover-images/booking_1/pickup/front.jpg"
    expect(await state.handover.main({ action: "cleanupUpload", bookingId: "booking_1", stage: "pickup", fileList: [spoof] })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    const photos = payload().photos
    photos[0].fileId = spoof
    expect(await state.handover.main(payload({ photos }))).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(await state.handover.main({ action: "cleanupUpload", bookingId: "booking_1", stage: "pickup", fileList: Array.from({ length: 10 }, (_, index) => file(String(index))) })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    queue(state, "bookingHandoverArchive", Array.from({ length: 9 }, (_, index) => file(String(index))))
    expect(await state.cleanup.main()).toMatchObject({ deleted: 1 })
    expect(Math.max(...state.counts)).toBe(20)
  })

  test("两个独立部署函数使用完全相同的guard协议", () => {
    const fs = require("fs")
    const path = require("path")
    expect(fs.readFileSync(path.resolve(__dirname, "../cloudfunctions/bookingHandover/handoverImageLifecycle.js"), "utf8"))
      .toBe(fs.readFileSync(path.resolve(__dirname, "../cloudfunctions/pendingFileDeletionProcess/handoverImageLifecycle.js"), "utf8"))
  })
})
