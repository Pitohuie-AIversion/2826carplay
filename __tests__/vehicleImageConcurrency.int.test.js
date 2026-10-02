jest.mock("wx-server-sdk")

function createState() {
  const stores = {
    vehicles: new Map([["car_1", { imageList: [], coverImage: "" }], ["car_2", { imageList: [], coverImage: "" }]]),
    pending_file_deletions: new Map(), bookings: new Map()
  }
  const counts = []
  const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
  function doc(map, id, touch = () => {}) {
    const api = {
      field: () => api,
      get: async () => { touch(id, false); return { data: map.has(id) ? { _id: id, ...clone(map.get(id)) } : null } },
      set: async ({ data }) => { touch(id, true); map.set(id, clone(data)); return { stats: { created: 1 } } },
      update: async ({ data }) => { touch(id, true); if (!map.has(id)) throw new Error("document not found"); map.set(id, { ...map.get(id), ...clone(data) }); return { stats: { updated: 1 } } },
      remove: async () => { touch(id, true); const removed = map.delete(id); return { stats: { removed: removed ? 1 : 0 } } }
    }
    return api
  }
  function query(map, filter = {}) {
    let limit = 100
    const api = {
      field: () => api, where: (next) => query(map, next), limit: (value) => { limit = value; return api },
      get: async () => ({ data: [...map.entries()].filter(([, value]) => Object.entries(filter).every(([key, expected]) => expected && expected.$ne !== undefined ? value[key] !== expected.$ne : value[key] === expected)).slice(0, limit).map(([id, value]) => ({ _id: id, ...clone(value) })) })
    }
    return api
  }
  const db = {
    command: { neq: (value) => ({ $ne: value }) }, serverDate: () => new Date().toISOString(),
    collection: (name) => {
      if (name === "roles") return query(new Map([["admin", { role: "admin", openid: "admin" }]]))
      if (["audit_logs", "error_logs"].includes(name)) return { add: async () => ({ _id: "log" }) }
      if (!stores[name]) throw new Error(`Unexpected collection: ${name}`)
      return { ...query(stores[name]), doc: (id) => doc(stores[name], id) }
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
        }) }) })
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
  const deleted = new Set()
  cloud.deleteFile.mockImplementation(async ({ fileList }) => {
    fileList.forEach((file) => deleted.add(file))
    return { fileList: fileList.map((fileID) => ({ fileID, status: 0 })) }
  })
  return { db, stores, counts, cloud, deleted,
    images: require("../cloudfunctions/vehicleImageUpdate/index"),
    removeVehicle: require("../cloudfunctions/vehicleDelete/index"),
    cleanup: require("../cloudfunctions/pendingFileDeletionProcess/index"),
    guardId: require("../cloudfunctions/vehicleImageUpdate/imageLifecycle").guardId
  }
}

const file = (name) => `cloud://env.bucket/vehicle-images/car_1/${name}.jpg`

describe("vehicle images share a transactional deletion guard", () => {
  test("并发新增两张图合并最新图片列表，不丢失任何一张", async () => {
    const state = createState()
    const results = await Promise.all([state.images.main({ id: "car_1", action: "add", fileIds: [file("a")] }), state.images.main({ id: "car_1", action: "add", fileIds: [file("b")] })])
    expect(results.every((result) => result.ok)).toBe(true)
    expect(new Set(state.stores.vehicles.get("car_1").imageList)).toEqual(new Set([file("a"), file("b")]))
    expect(Math.max(...state.counts)).toBeLessThanOrEqual(100)
  })

  test("删除与设置封面并发不会复活已删除图片", async () => {
    const state = createState()
    state.stores.vehicles.set("car_1", { imageList: [file("a"), file("b")], coverImage: file("b") })
    await Promise.all([state.images.main({ id: "car_1", action: "remove", fileId: file("a") }), state.images.main({ id: "car_1", action: "setCover", fileId: file("a") })])
    expect(state.stores.vehicles.get("car_1")).toMatchObject({ imageList: [file("b")], coverImage: file("b") })
    expect(state.deleted.has(file("a"))).toBe(true)
  })

  test("清理核验期间附加图片会使清理事务重试并保留引用", async () => {
    const state = createState()
    const id = state.guardId("car_1", file("a"))
    state.stores.pending_file_deletions.set(id, { fileList: [file("a")], context: { vehicleId: "car_1" }, source: "vehicleImageUploadCleanup", deletionState: "pending" })
    state.db.beforeCommit = async () => {
      state.db.beforeCommit = null
      expect(await state.images.main({ id: "car_1", action: "add", fileIds: [file("a")] })).toMatchObject({ ok: true })
    }
    expect(await state.cleanup.main()).toMatchObject({ ok: true, preserved: 1 })
    expect(state.cloud.deleteFile).not.toHaveBeenCalled()
    expect(state.stores.vehicles.get("car_1").imageList).toEqual([file("a")])
  })

  test("删除已claim后迟到关联被拒绝，重复cleanup不能重置永久标记", async () => {
    const state = createState()
    const id = state.guardId("car_1", file("a"))
    state.stores.pending_file_deletions.set(id, { fileList: [file("a")], context: { vehicleId: "car_1" }, source: "vehicleImageUploadCleanup", deletionState: "pending" })
    state.cloud.deleteFile.mockImplementation(async ({ fileList }) => {
      expect(await state.images.main({ id: "car_1", action: "add", fileIds: fileList })).toMatchObject({ ok: false, code: "IMAGE_DELETION_CONFLICT" })
      return { fileList: fileList.map((fileID) => ({ fileID, status: 0 })) }
    })
    expect(await state.cleanup.main()).toMatchObject({ ok: true, deleted: 1 })
    expect(state.stores.pending_file_deletions.get(id).deletionState).toBe("deleted")
    await state.images.main({ id: "car_1", action: "cleanupUpload", fileIds: [file("a")] })
    expect(state.stores.pending_file_deletions.get(id).deletionState).toBe("deleted")
    expect(await state.cleanup.main()).toMatchObject({ ok: true, processed: 0 })
  })

  test("并发清理迟到的失败回执不能回退已删除标记", async () => {
    const state = createState()
    const id = state.guardId("car_1", file("a"))
    state.stores.pending_file_deletions.set(id, { fileList: [file("a")], context: { vehicleId: "car_1" }, source: "vehicleImageUpdate", deletionState: "deleting" })
    let resolveLate
    state.cloud.deleteFile.mockImplementationOnce(() => new Promise((resolve) => { resolveLate = resolve }))
    const lifecycle = require("../cloudfunctions/vehicleImageUpdate/imageLifecycle").createImageLifecycle(state.db, state.cloud)
    const first = lifecycle.deleteClaimed("car_1", [file("a")])
    await lifecycle.deleteClaimed("car_1", [file("a")])
    resolveLate({ fileList: [{ fileID: file("a"), status: -1 }] })
    await first
    expect(state.stores.pending_file_deletions.get(id).deletionState).toBe("deleted")
  })

  test("三个独立部署函数携带相同的文件生命周期实现", () => {
    const fs = require("fs")
    const path = require("path")
    const source = fs.readFileSync(path.resolve(__dirname, "../cloudfunctions/vehicleImageUpdate/imageLifecycle.js"), "utf8")
    for (const name of ["vehicleDelete", "pendingFileDeletionProcess"]) {
      expect(fs.readFileSync(path.resolve(__dirname, `../cloudfunctions/${name}/imageLifecycle.js`), "utf8")).toBe(source)
    }
  })

  test.each([null, ""])("删除回执状态为 %p 时保留文件重试资格", async (status) => {
    const state = createState()
    const id = state.guardId("car_1", file("a"))
    state.stores.vehicles.set("car_1", { imageList: [file("a")], coverImage: file("a") })
    state.cloud.deleteFile.mockResolvedValueOnce({ fileList: [{ fileID: file("a"), status }] })

    expect(await state.images.main({ id: "car_1", action: "remove", fileId: file("a") })).toMatchObject({ ok: true })
    expect(state.stores.pending_file_deletions.get(id)).toMatchObject({ deletionState: "deleting", attemptCount: 1 })
    expect(await state.cleanup.main()).toMatchObject({ ok: true, processed: 1, deleted: 1 })
    expect(state.cloud.deleteFile).toHaveBeenCalledTimes(2)
    expect(state.stores.pending_file_deletions.get(id).deletionState).toBe("deleted")
  })

  test.each(["vehicleImageUploadCleanup", "vehicleImageUpdate", "vehicleDelete"])("旧%s队列也保留仅被coverImage引用的图片", async (source) => {
    const state = createState()
    state.stores.vehicles.set("car_1", { imageList: [], coverImage: file("a") })
    state.stores.pending_file_deletions.set("legacy_queue", { fileList: [file("a")], context: { vehicleId: "car_1" }, source })
    expect(await state.cleanup.main()).toMatchObject({ ok: true, preserved: 1 })
    expect(state.cloud.deleteFile).not.toHaveBeenCalled()
  })

  test("删除车辆使用最新图片快照，并保留未确认删除的文件供重试", async () => {
    const state = createState()
    state.stores.vehicles.set("car_1", { imageList: [file("a")], coverImage: file("a") })
    state.db.beforeCommit = async () => {
      state.db.beforeCommit = null
      await state.images.main({ id: "car_1", action: "add", fileIds: [file("b")] })
    }
    state.cloud.deleteFile.mockResolvedValueOnce({ fileList: [{ fileID: file("a"), status: 0 }] })
    expect(await state.removeVehicle.main({ id: "car_1" })).toMatchObject({ ok: true })
    expect(state.cloud.deleteFile).toHaveBeenCalledWith({ fileList: [file("a"), file("b")] })
    expect(state.stores.pending_file_deletions.get(state.guardId("car_1", file("a"))).deletionState).toBe("deleted")
    expect(state.stores.pending_file_deletions.get(state.guardId("car_1", file("b"))).deletionState).toBe("deleting")
    expect(await state.cleanup.main()).toMatchObject({ ok: true, processed: 1, deleted: 1 })
    expect(state.cloud.deleteFile.mock.calls[1][0].fileList).toEqual([file("b")])
  })

  test("bookings预查后有新预约共同revision写入，删除重试不移除车辆", async () => {
    const state = createState()
    state.db.beforeCommit = async () => {
      state.db.beforeCommit = null
      state.stores.vehicles.set("car_1", { ...state.stores.vehicles.get("car_1"), bookingReferenceVersion: 1 })
      state.stores.bookings.set("new_booking", { vehicleId: "car_1" })
    }
    expect(await state.removeVehicle.main({ id: "car_1" })).toMatchObject({ ok: false, code: "DELETE_CONFLICT" })
    expect(state.stores.vehicles.has("car_1")).toBe(true)
    expect(state.cloud.deleteFile).not.toHaveBeenCalled()
  })

  test("其他车辆及嵌套伪装目录不能绕过每文件guard", async () => {
    const state = createState()
    expect(await state.images.main({ id: "car_2", action: "add", fileIds: [file("a")] })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(await state.images.main({ id: "car_1", action: "add", fileIds: ["cloud://env.bucket/vehicle-images/car_2/vehicle-images/car_1/a.jpg"] })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(state.stores.vehicles.get("car_2").imageList).toEqual([])
  })
})
