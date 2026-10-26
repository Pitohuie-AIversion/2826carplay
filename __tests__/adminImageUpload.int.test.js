jest.mock("wx-server-sdk")
jest.mock("@cloudbase/node-sdk", () => ({ init: jest.fn() }))

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64")
const NOW = Date.parse("2026-10-25T10:00:00Z")

async function setup({ roles = [{ role: "admin" }], vehicles = { car_1: { status: "idle", imageList: [] } }, bookings = {} } = {}) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "admin_1" })
  const records = new Map()
  const files = new Map()
  const hooks = {}
  for (const [id, record] of Object.entries(vehicles)) records.set(`vehicles/${id}`, structuredClone(record))
  for (const [id, record] of Object.entries(bookings)) records.set(`bookings/${id}`, structuredClone(record))
  let currentRoles = roles
  let tail = Promise.resolve()
  const collection = (name) => ({
    doc: (id) => {
      const key = `${name}/${id}`
      const ref = {
        get: jest.fn(async () => {
          const result = { data: records.has(key) ? { _id: id, ...structuredClone(records.get(key)) } : null }
          if (hooks.afterRead) await hooks.afterRead(key)
          return result
        }),
        set: jest.fn(async ({ data }) => { records.set(key, structuredClone(data)); return {} }),
        update: jest.fn(async ({ data }) => { records.set(key, { ...records.get(key), ...structuredClone(data) }); return {} }),
        remove: jest.fn(async () => { if (hooks.beforeRemove) await hooks.beforeRemove(key); records.delete(key); return {} })
      }
      ref.field = () => ref
      return ref
    },
    where: (condition) => {
      const query = {
        field: () => query,
        limit: () => query,
        get: async () => ({ data: name === "roles" ? currentRoles : [...records.entries()].filter(([key, row]) => key.startsWith(`${name}/`) && (!condition.openid || row.openid === condition.openid) && (!condition.expiresAt || new Date(row.expiresAt).getTime() <= condition.expiresAt.lte)).slice(0, 50).map(([key, row]) => ({ _id: key.slice(name.length + 1), ...structuredClone(row) })) })
      }
      return query
    }
  })
  const db = { collection, serverDate: () => new Date(), command: { lte: (value) => ({ lte: value.getTime() }) }, runTransaction: jest.fn((callback) => {
    const result = tail.then(async () => {
      const snapshot = new Map(records)
      try { return await callback({ collection }) } catch (error) { records.clear(); for (const [key, value] of snapshot) records.set(key, value); throw error }
    })
    tail = result.catch(() => {})
    return result
  }) }
  cloud.__setMockDb(db)
  cloud.database.mockImplementation(() => db)
  const metadata = jest.fn(async ({ cloudPath }) => ({ data: { fileId: `cloud://test-env/${cloudPath}`, token: "secret-token", authorization: "secret-signature" } }))
  require("@cloudbase/node-sdk").init.mockReturnValue({ getUploadMetadata: metadata })
  cloud.uploadFile = jest.fn(async ({ cloudPath, fileContent }) => {
    const fileID = `cloud://test-env/${cloudPath}`
    files.set(fileID, Buffer.from(fileContent))
    return { fileID }
  })
  cloud.downloadFile = jest.fn(async ({ fileID }) => {
    if (!files.has(fileID)) throw Object.assign(new Error("file not found"), { code: "STORAGE_FILE_NOT_EXIST" })
    return { fileContent: files.get(fileID) }
  })
  const mod = require("../cloudfunctions/adminImageUpload")
  return { ...mod, cloud, records, files, metadata, db, hooks, setRoles: (value) => { currentRoles = value }, setUser: (openid) => cloud.__setMockContext({ OPENID: openid }) }
}

function latch() {
  let release
  const promise = new Promise((resolve) => { release = resolve })
  return { promise, release }
}

const input = (overrides = {}) => ({ action: "begin", kind: "vehicle", targetId: "car_1", requestId: "image_request_12345", size: PNG.length, extension: "png", ...overrides })
async function prepare(ctx, bytes = PNG, overrides = {}) {
  const begun = await ctx.main(input({ size: bytes.length, ...overrides }))
  expect(begun.ok).toBe(true)
  for (let index = 0; index < begun.chunkCount; index += 1) {
    expect(await ctx.main({ action: "chunk", uploadId: begun.uploadId, index, data: bytes.subarray(index * begun.chunkSize, (index + 1) * begun.chunkSize).toString("base64") })).toMatchObject({ ok: true })
  }
  return begun.uploadId
}

describe("adminImageUpload server authorization and lifecycle", () => {
  beforeEach(() => { jest.useFakeTimers(); jest.setSystemTime(NOW) })
  afterEach(() => jest.useRealTimers())

  test.each(["session", "chunk"])("并发清理的迟到 %s 删除不能影响同 requestId 新建的上传", async (delayedRecord) => {
    const ctx = await setup()
    const oldId = await prepare(ctx)
    jest.setSystemTime(NOW + 18 * 60 * 1000)
    const entered = latch()
    const resume = latch()
    const blockedKey = `admin_upload_sessions/${oldId}${delayedRecord === "chunk" ? "_0" : ""}`
    let blocked = false
    ctx.hooks.beforeRemove = async (key) => {
      if (key !== blockedKey || blocked) return
      blocked = true
      entered.release()
      await resume.promise
    }
    const firstCleanup = ctx.main({ action: "cleanup" })
    await entered.promise
    expect(await ctx.main({ action: "cleanup" })).toMatchObject({ ok: true })
    const newId = await prepare(ctx)
    expect(newId).not.toBe(oldId)
    resume.release()
    expect(await firstCleanup).toMatchObject({ ok: true })
    expect(ctx.records.has(`admin_upload_sessions/${newId}`)).toBe(true)
    expect(ctx.records.has(`admin_upload_sessions/${newId}_0`)).toBe(true)
    expect((await ctx.main(input())).uploadId).toBe(newId)
    const owner = [...ctx.records.values()].find((row) => row.recordType === "quota" && row.openid === "admin_1")
    expect(owner.sessions.map((entry) => entry.id)).toEqual([newId])
    expect(await ctx.main({ action: "complete", uploadId: newId })).toMatchObject({ ok: true })
  })

  test("abort 读到的旧会话不能取消同 requestId 重建后的上传", async () => {
    const ctx = await setup()
    const oldId = await prepare(ctx)
    const entered = latch()
    const resume = latch()
    let blocked = false
    ctx.hooks.afterRead = async (key) => {
      if (key !== `admin_upload_sessions/${oldId}` || blocked) return
      blocked = true
      entered.release()
      await resume.promise
    }
    const oldAbort = ctx.main({ action: "abort", uploadId: oldId })
    await entered.promise
    jest.setSystemTime(NOW + 18 * 60 * 1000)
    expect(await ctx.main({ action: "cleanup" })).toMatchObject({ ok: true })
    const newId = await prepare(ctx)
    resume.release()
    expect(await oldAbort).toMatchObject({ ok: true })
    expect(ctx.records.get(`admin_upload_sessions/${newId}`).state).toBe("uploading")
    const owner = [...ctx.records.values()].find((row) => row.recordType === "quota" && row.openid === "admin_1")
    expect(owner.sessions.map((entry) => entry.id)).toEqual([newId])
    expect(await ctx.main({ action: "complete", uploadId: newId })).toMatchObject({ ok: true })
  })

  test("同 requestId 并发 begin 只分配一个会话及一个名额", async () => {
    const ctx = await setup()
    const [first, second] = await Promise.all([ctx.main(input()), ctx.main(input())])
    expect(first.ok).toBe(true)
    expect(second).toEqual(first)
    expect([...ctx.records.values()].filter((row) => row.recordType === "session")).toHaveLength(1)
    expect([...ctx.records.values()].filter((row) => row.recordType === "request")).toHaveLength(1)
    const owner = [...ctx.records.values()].find((row) => row.recordType === "quota" && row.openid === "admin_1")
    expect(owner).toMatchObject({ count: 1, sessions: [{ id: first.uploadId }] })
  })

  test("旧确定性编号会话可续传和幂等返回，清理后只生成不同的新代编号", async () => {
    const ctx = await setup()
    const originalId = await prepare(ctx)
    const legacyId = require("crypto").createHash("sha256").update(`admin_1|${input().requestId}`).digest("hex").slice(0, 40)
    const session = ctx.records.get(`admin_upload_sessions/${originalId}`)
    const chunk = ctx.records.get(`admin_upload_sessions/${originalId}_0`)
    ctx.records.delete(`admin_upload_sessions/${originalId}`)
    ctx.records.delete(`admin_upload_sessions/${originalId}_0`)
    ctx.records.delete(`admin_upload_sessions/request_${legacyId}`)
    ctx.records.set(`admin_upload_sessions/${legacyId}`, { ...session, uploadId: legacyId })
    ctx.records.set(`admin_upload_sessions/${legacyId}_0`, { ...chunk, uploadId: legacyId })
    for (const row of ctx.records.values()) {
      if (row.recordType === "quota") row.sessions = row.sessions.map((entry) => ({ ...entry, id: entry.id === originalId ? legacyId : entry.id }))
    }
    expect(await ctx.main(input())).toMatchObject({ ok: true, uploadId: legacyId })
    const completed = await ctx.main({ action: "complete", uploadId: legacyId })
    expect(completed.ok).toBe(true)
    expect(await ctx.main(input())).toMatchObject({ uploadId: legacyId, fileID: completed.fileID })
    jest.setSystemTime(NOW + 18 * 60 * 1000)
    const nextId = await prepare(ctx)
    expect(nextId).not.toBe(legacyId)
    expect(await ctx.main({ action: "complete", uploadId: nextId })).toMatchObject({ ok: true })
  })

  test.each(["request", "session"])("读取 %s 失败不得误当不存在并重新分配上传会话", async (recordType) => {
    const ctx = await setup()
    await prepare(ctx)
    const failedKey = [...ctx.records.entries()].find(([, row]) => row.recordType === recordType)[0]
    ctx.hooks.afterRead = async (key) => { if (key === failedKey) throw Object.assign(new Error("permission denied"), { code: "DATABASE_PERMISSION_DENIED" }) }
    expect(await ctx.main(input())).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect([...ctx.records.values()].filter((row) => row.recordType === "session")).toHaveLength(1)
  })

  test("begin 自动清理遵守到期后两分钟界限，缺失的未到期指针目标不被复活", async () => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    const stored = ctx.records.get(`admin_upload_sessions/${uploadId}`)
    ctx.records.delete(`admin_upload_sessions/${uploadId}`)
    expect(await ctx.main(input())).toMatchObject({ code: "UPLOAD_EXPIRED" })
    expect([...ctx.records.values()].filter((row) => row.recordType === "session")).toHaveLength(0)
    ctx.records.set(`admin_upload_sessions/${uploadId}`, stored)
    jest.setSystemTime(NOW + 17 * 60 * 1000 - 1)
    expect(await ctx.main(input())).toMatchObject({ code: "UPLOAD_EXPIRED" })
    expect(ctx.records.has(`admin_upload_sessions/${uploadId}`)).toBe(true)
    jest.setSystemTime(NOW + 17 * 60 * 1000)
    const nextId = await prepare(ctx)
    expect(nextId).not.toBe(uploadId)
    expect(ctx.records.has(`admin_upload_sessions/${uploadId}`)).toBe(false)
    expect(ctx.records.has(`admin_upload_sessions/${uploadId}_0`)).toBe(false)
  })

  test("到期前已开始的 complete 在有效租约内仍占用目标图片名额", async () => {
    const ctx = await setup({ vehicles: { car_1: { status: "idle", imageList: Array.from({ length: 8 }, (_, i) => `cloud://image-${i}`) } } })
    const uploadId = await prepare(ctx)
    jest.setSystemTime(NOW + 15 * 60 * 1000 - 1000)
    const entered = latch()
    const resume = latch()
    const originalUpload = ctx.cloud.uploadFile.getMockImplementation()
    ctx.cloud.uploadFile.mockImplementation(async (args) => { entered.release(); await resume.promise; return originalUpload(args) })
    const completing = ctx.main({ action: "complete", uploadId })
    await entered.promise
    jest.setSystemTime(NOW + 15 * 60 * 1000 + 1000)
    const nextBegin = await ctx.main(input({ requestId: "image_request_other" }))
    resume.release()
    expect(await completing).toMatchObject({ ok: true })
    expect(nextBegin).toMatchObject({ ok: false, code: "UPLOAD_LIMIT" })
  })

  test("九个跨到期时间的有效完成租约仍占用调用者名额，完成后释放", async () => {
    const ctx = await setup({ vehicles: { car_1: { status: "idle", imageList: [] }, car_2: { status: "idle", imageList: [] } } })
    const uploadIds = []
    for (let index = 0; index < 9; index += 1) uploadIds.push(await prepare(ctx, PNG, { requestId: `owner_lease_request_${index}` }))
    jest.setSystemTime(NOW + 15 * 60 * 1000 - 1000)
    const entered = latch()
    const resume = latch()
    let uploading = 0
    const originalUpload = ctx.cloud.uploadFile.getMockImplementation()
    ctx.cloud.uploadFile.mockImplementation(async (args) => {
      uploading += 1
      if (uploading === 9) entered.release()
      await resume.promise
      return originalUpload(args)
    })
    const completing = Promise.all(uploadIds.map((uploadId) => ctx.main({ action: "complete", uploadId })))
    await entered.promise
    jest.setSystemTime(NOW + 15 * 60 * 1000 + 1000)
    const nextInput = input({ targetId: "car_2", requestId: "owner_lease_request_next" })
    const nextBegin = await ctx.main(nextInput)
    resume.release()
    expect((await completing).every((result) => result.ok)).toBe(true)
    expect(nextBegin).toMatchObject({ ok: false, code: "UPLOAD_LIMIT" })
    expect(await ctx.main(nextInput)).toMatchObject({ ok: true })
  })

  test.each([{ roles: [] }, { roles: [{ role: "user" }] }, { roles: [{ permissions: ["booking_manage"] }] }])("非车辆管理角色无法创建上传会话：%j", async ({ roles }) => {
    const ctx = await setup({ roles })
    expect(await ctx.main(input())).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(ctx.metadata).not.toHaveBeenCalled()
    expect(ctx.cloud.uploadFile).not.toHaveBeenCalled()
    expect([...ctx.records.keys()].filter((key) => key.startsWith("admin_upload_sessions/"))).toEqual([])
  })

  test.each(["chunk", "complete", "abort"])("撤权后拒绝已有会话的 %s", async (action) => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    ctx.setRoles([])
    expect(await ctx.main({ action, uploadId, index: 0, data: PNG.toString("base64") })).toMatchObject({ code: "FORBIDDEN" })
    expect(ctx.cloud.uploadFile).not.toHaveBeenCalled()
  })

  test("会话不能被其他管理员接管，也不能通过 event 伪造身份", async () => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    ctx.setUser("admin_2")
    expect(await ctx.main({ action: "complete", uploadId, openid: "admin_1" })).toMatchObject({ code: "FORBIDDEN" })
  })

  test.each([{ targetId: "../car_1" }, { targetId: ["car_1"] }, { stage: "pickup" }, { size: 10485761 }, { size: "60" }, { size: 0 }, { extension: "svg" }, { kind: "handover", stage: "../pickup" }])("严格拒绝路径、尺寸与类型参数：%j", async (change) => {
    const ctx = await setup()
    expect(await ctx.main(input(change))).toMatchObject({ code: "VALIDATION_ERROR" })
    expect(ctx.cloud.uploadFile).not.toHaveBeenCalled()
  })

  test("begin 相同编号返回同会话，不同内容冲突且不挤占第二个名额", async () => {
    const ctx = await setup()
    const first = await ctx.main(input())
    expect(await ctx.main(input())).toEqual(first)
    expect(await ctx.main(input({ size: PNG.length + 1 }))).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
    expect([...ctx.records.values()].filter((record) => record.recordType === "session")).toHaveLength(1)
  })

  test("并发 begin 不能突破车辆剩余一个图片名额", async () => {
    const ctx = await setup({ vehicles: { car_1: { imageList: Array.from({ length: 8 }, (_, i) => `old_${i}`) } } })
    const results = await Promise.all([ctx.main(input()), ctx.main(input({ requestId: "image_request_67890" }))])
    expect(results.filter((result) => result.ok)).toHaveLength(1)
    expect(results.find((result) => !result.ok)).toMatchObject({ code: "UPLOAD_LIMIT" })
  })

  test("目标不存在、停用或预约未确认时不能开始上传", async () => {
    const ctx = await setup({ vehicles: { car_1: { status: "retired" } }, bookings: { booking_1: { status: "pending" } } })
    expect(await ctx.main(input())).toMatchObject({ code: "STATUS_NOT_ALLOWED" })
    expect(await ctx.main(input({ targetId: "missing" }))).toMatchObject({ code: "NOT_FOUND" })
    expect(await ctx.main(input({ kind: "handover", targetId: "booking_1", stage: "pickup" }))).toMatchObject({ code: "STATUS_NOT_ALLOWED" })
  })

  test("分块重试必须内容相同，超长、非标准base64与错误序号均拒绝", async () => {
    const ctx = await setup()
    const begun = await ctx.main(input())
    const request = { action: "chunk", uploadId: begun.uploadId, index: 0, data: PNG.toString("base64") }
    expect(await ctx.main(request)).toMatchObject({ ok: true })
    expect(await ctx.main(request)).toMatchObject({ ok: true, duplicated: true })
    expect(await ctx.main({ ...request, data: Buffer.alloc(PNG.length).toString("base64") })).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" })
    for (const change of [{ index: 1 }, { index: "0" }, { data: `${request.data}\n` }, { data: "A".repeat(262148) }]) expect(await ctx.main({ ...request, ...change })).toMatchObject({ code: "VALIDATION_ERROR" })
  })

  test("不完整文件或伪装成png的文本不进入云存储", async () => {
    const ctx = await setup()
    const empty = await ctx.main(input())
    expect(await ctx.main({ action: "complete", uploadId: empty.uploadId })).toMatchObject({ code: "UPLOAD_INCOMPLETE" })
    const fake = await prepare(ctx, Buffer.from("<script>alert(1)</script>"), { requestId: "fake_image_request" })
    expect(await ctx.main({ action: "complete", uploadId: fake })).toMatchObject({ code: "VALIDATION_ERROR" })
    expect(ctx.metadata).not.toHaveBeenCalled()
    expect(ctx.cloud.uploadFile).not.toHaveBeenCalled()
  })

  test("真实图片只上传一次，预写清理队列且返回值不泄漏签名", async () => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    const result = await ctx.main({ action: "complete", uploadId })
    expect(result).toMatchObject({ ok: true, fileID: expect.stringMatching(/^cloud:\/\/test-env\/vehicle-images\/car_1\/\d{13}_\d+\.png$/) })
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ ...result, duplicated: true })
    expect(ctx.cloud.uploadFile).toHaveBeenCalledTimes(1)
    expect(ctx.files.get(result.fileID)).toEqual(PNG)
    const queue = [...ctx.records.values()].find((row) => row.source === "vehicleImageUploadCleanup")
    expect(queue).toMatchObject({ fileList: [result.fileID], context: { vehicleId: "car_1" }, deletionState: "pending" })
    expect(queue.notBeforeAt.getTime()).toBe(NOW + 17 * 60 * 1000)
    expect(JSON.stringify(result)).not.toMatch(/secret-|token|authorization/)
    expect([...ctx.records.values()].filter((row) => row.recordType === "chunk")).toHaveLength(0)
  })

  test("上传成功但回执丢失，重试校验已有文件而非重复上传", async () => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    ctx.cloud.uploadFile.mockImplementationOnce(async ({ cloudPath, fileContent }) => {
      ctx.files.set(`cloud://test-env/${cloudPath}`, Buffer.from(fileContent))
      throw new Error("response lost")
    })
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ code: "INTERNAL_ERROR" })
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ ok: true })
    expect(ctx.cloud.uploadFile).toHaveBeenCalledTimes(1)
    expect(ctx.metadata).toHaveBeenCalledTimes(1)
  })

  test("并发 complete 只有一个持有上传锁，不能重复写云存储", async () => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    const results = await Promise.all([ctx.main({ action: "complete", uploadId }), ctx.main({ action: "complete", uploadId })])
    expect(results.some((row) => row.ok)).toBe(true)
    expect(results.every((row) => row.ok || row.code === "UPLOAD_BUSY")).toBe(true)
    expect(ctx.cloud.uploadFile).toHaveBeenCalledTimes(1)
  })

  test("分块后目标删除，完成时拒绝并且不写云存储", async () => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    ctx.records.delete("vehicles/car_1")
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ code: "NOT_FOUND" })
    expect(ctx.cloud.uploadFile).not.toHaveBeenCalled()
  })

  test("交接照片依预约权限生成私有路径并登记原有引用核验清理队列", async () => {
    const ctx = await setup({ roles: [{ permissions: ["booking_manage"] }], bookings: { booking_1: { status: "confirmed" } } })
    const uploadId = await prepare(ctx, PNG, { kind: "handover", targetId: "booking_1", stage: "pickup" })
    const result = await ctx.main({ action: "complete", uploadId })
    expect(result).toMatchObject({ ok: true, fileID: expect.stringContaining("/handover-images/booking_1/pickup/") })
    expect([...ctx.records.values()].find((row) => row.source === "bookingHandoverUploadCleanup")).toMatchObject({ context: { bookingId: "booking_1", stage: "pickup" } })
  })

  test("abort 删除分块并释放名额，同编号不会复活；过期清理不直接删除成品", async () => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    expect(await ctx.main({ action: "abort", uploadId })).toEqual({ ok: true })
    expect(await ctx.main(input())).toMatchObject({ code: "UPLOAD_EXPIRED" })
    expect([...ctx.records.values()].filter((row) => row.recordType === "chunk")).toHaveLength(0)
    const completedId = await prepare(ctx, PNG, { requestId: "completed_image_123" })
    const result = await ctx.main({ action: "complete", uploadId: completedId })
    ctx.records.get("vehicles/car_1").imageList = [result.fileID]
    jest.setSystemTime(NOW + 18 * 60 * 1000)
    expect(await ctx.main({ action: "cleanup" })).toMatchObject({ ok: true })
    expect(ctx.files.has(result.fileID)).toBe(true)
    expect(ctx.cloud.deleteFile).not.toHaveBeenCalled()
    expect([...ctx.records.values()].find((row) => row.source === "vehicleImageUploadCleanup")).toBeDefined()
  })

  test("10 MiB JPEG 经54个分块实际合并上传，逐块请求保持小于300KiB", async () => {
    const original = require("fs").readFileSync(require("path").join(__dirname, "../assets/cars/car_001_cover.jpg"))
    const padding = []
    let remaining = 10 * 1024 * 1024 - original.length
    while (remaining > 0) {
      let length = Math.min(65537, remaining)
      if (remaining > length && remaining - length < 4) length -= 4
      const segment = Buffer.alloc(length)
      segment.writeUInt16BE(0xffef, 0)
      segment.writeUInt16BE(length - 2, 2)
      padding.push(segment)
      remaining -= length
    }
    const bytes = Buffer.concat([original.subarray(0, 2), ...padding, original.subarray(2)])
    const ctx = await setup()
    const uploadId = await prepare(ctx, bytes, { extension: "jpg" })
    const chunks = [...ctx.records.values()].filter((row) => row.recordType === "chunk")
    expect(chunks).toHaveLength(54)
    expect(chunks.every((row) => Buffer.byteLength(JSON.stringify(row)) < 300 * 1024)).toBe(true)
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ ok: true })
    const uploaded = ctx.cloud.uploadFile.mock.calls[0][0].fileContent
    expect(uploaded.length).toBe(bytes.length)
    const sha256 = (value) => require("crypto").createHash("sha256").update(value).digest("hex")
    expect(sha256(uploaded)).toBe(sha256(bytes))
  })

  test("真实内容后缀不符、PNG校验和损坏及超额实际分块都拒绝", async () => {
    const ctx = await setup()
    const wrongType = await prepare(ctx, PNG, { extension: "jpg" })
    expect(await ctx.main({ action: "complete", uploadId: wrongType })).toMatchObject({ code: "VALIDATION_ERROR" })
    const corrupted = Buffer.from(PNG)
    corrupted[45] ^= 1
    const broken = await prepare(ctx, corrupted, { requestId: "broken_image_request" })
    expect(await ctx.main({ action: "complete", uploadId: broken })).toMatchObject({ code: "VALIDATION_ERROR" })
    const begun = await ctx.main(input({ requestId: "oversized_chunk_request" }))
    expect(await ctx.main({ action: "chunk", uploadId: begun.uploadId, index: 0, data: Buffer.alloc(PNG.length + 1).toString("base64") })).toMatchObject({ code: "VALIDATION_ERROR" })
    expect(ctx.cloud.uploadFile).not.toHaveBeenCalled()
  })

  test("普通角色不能清理会话，过期会话不能继续上传", async () => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    ctx.setRoles([{ role: "vehicle_manage" }])
    expect(await ctx.main({ action: "cleanup" })).toMatchObject({ code: "FORBIDDEN" })
    jest.setSystemTime(NOW + 16 * 60 * 1000)
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ code: "UPLOAD_EXPIRED" })
    expect(ctx.cloud.uploadFile).not.toHaveBeenCalled()
  })

  test("上传前预约取消、车辆图片已填满均拒绝完成", async () => {
    const ctx = await setup({ bookings: { booking_1: { status: "confirmed" } } })
    const vehicleUpload = await prepare(ctx)
    ctx.records.get("vehicles/car_1").imageList = Array.from({ length: 9 }, (_, i) => `image_${i}`)
    expect(await ctx.main({ action: "complete", uploadId: vehicleUpload })).toMatchObject({ code: "UPLOAD_LIMIT" })
    const handoverUpload = await prepare(ctx, PNG, { kind: "handover", targetId: "booking_1", stage: "pickup", requestId: "cancel_booking_upload" })
    ctx.records.get("bookings/booking_1").status = "cancelled"
    expect(await ctx.main({ action: "complete", uploadId: handoverUpload })).toMatchObject({ code: "STATUS_NOT_ALLOWED" })
    expect(ctx.cloud.uploadFile).not.toHaveBeenCalled()
  })

  test("begin 自动清理自己的过期分块，撤权用户也只可显式清自己的记录", async () => {
    const ctx = await setup()
    const oldId = await prepare(ctx)
    jest.setSystemTime(NOW + 18 * 60 * 1000)
    expect(await ctx.main(input({ requestId: "new_image_after_expiry" }))).toMatchObject({ ok: true })
    expect(ctx.records.has(`admin_upload_sessions/${oldId}`)).toBe(false)
    expect(ctx.records.has(`admin_upload_sessions/${oldId}_0`)).toBe(false)
    ctx.records.set("admin_upload_sessions/other_expired", { recordType: "chunk", openid: "admin_2", expiresAt: new Date(NOW), data: "private" })
    ctx.setRoles([])
    expect(await ctx.main({ action: "cleanup", ownOnly: true })).toMatchObject({ ok: true })
    expect(ctx.records.has("admin_upload_sessions/other_expired")).toBe(true)
  })

  test("恢复上传识别SDK的COS 404，网络或权限失败不能当无文件覆盖", async () => {
    const ctx = await setup()
    const uploadId = await prepare(ctx)
    ctx.cloud.uploadFile.mockRejectedValueOnce(new Error("upload unavailable"))
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ code: "INTERNAL_ERROR" })
    ctx.cloud.downloadFile.mockRejectedValueOnce(Object.assign(new Error("download unavailable"), { code: "STORAGE_REQUEST_FAIL" }))
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ code: "INTERNAL_ERROR" })
    expect(ctx.cloud.uploadFile).toHaveBeenCalledTimes(1)
    ctx.cloud.downloadFile.mockRejectedValueOnce(Object.assign(new Error("下载文件失败: Status:404 Url:https://example.invalid/image"), { code: "STORAGE_REQUEST_FAIL" }))
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ ok: true })
    expect(ctx.cloud.uploadFile).toHaveBeenCalledTimes(2)
  })

  test("WebP真实容器可上传，截断容器或尾部拼接脚本不能通过", async () => {
    const webp = Buffer.from("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA", "base64")
    const ctx = await setup()
    const uploadId = await prepare(ctx, webp, { extension: "webp" })
    expect(await ctx.main({ action: "complete", uploadId })).toMatchObject({ ok: true })
    const { imageType } = require("../cloudfunctions/adminImageUpload/imageFormat")
    expect(imageType(webp.subarray(0, -1))).toBe("")
    expect(imageType(Buffer.concat([PNG, Buffer.from("<script>")]))).toBe("")
    expect(imageType(Buffer.from("ffd8ffffffffffffffffffffffd9", "hex"))).toBe("")
  })

  test("清理查询失败时begin报告失败，不创建新会话或隐藏堆积", async () => {
    const ctx = await setup()
    const original = ctx.db.collection
    ctx.db.collection = (name) => name === "admin_upload_sessions" ? { where: () => { throw new Error("cleanup query unavailable") } } : original(name)
    expect(await ctx.main(input())).toMatchObject({ code: "INTERNAL_ERROR" })
    expect([...ctx.records.values()].filter((record) => record.recordType === "session")).toHaveLength(0)
  })

  test("清理批次已扫描50条时，即使会话连带删除分块也提示可能仍有待处理记录", async () => {
    const ctx = await setup()
    const begun = await ctx.main(input({ size: 10 * 1024 * 1024 }))
    for (let index = 0; index < begun.chunkCount; index += 1) ctx.records.set(`admin_upload_sessions/${begun.uploadId}_${index}`, {
      recordType: "chunk", uploadId: begun.uploadId, openid: "admin_1", expiresAt: new Date(NOW + 15 * 60 * 1000)
    })
    ctx.records.set("admin_upload_sessions/next_expired_batch", { recordType: "quota", expiresAt: new Date(NOW) })
    jest.setSystemTime(NOW + 18 * 60 * 1000)
    expect(await ctx.main({ action: "cleanup" })).toMatchObject({ ok: true, hasMore: true })
    expect(ctx.records.has("admin_upload_sessions/next_expired_batch")).toBe(true)
  })
})
