const cloud = require("wx-server-sdk")
const tcb = require("@cloudbase/node-sdk")
const crypto = require("crypto")
const { imageType } = require("./imageFormat")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const storage = tcb.init()
const COLLECTION = "admin_upload_sessions"
const CHUNK_SIZE = 192 * 1024
const MAX_BYTES = 10 * 1024 * 1024
const TTL = 15 * 60 * 1000
const LEASE = 2 * 60 * 1000
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const TARGET_FIELDS = { status: true, imageList: true, coverImage: true, latestPickupHandoverId: true }
const IMAGE_REFERENCE_FIELDS = { imageList: true, coverImage: true }
const IMAGE_GUARD_FIELDS = { deletionState: true, uploadAbandoned: true }
const hash = (value) => crypto.createHash("sha256").update(value).digest("hex")
const time = (value) => value instanceof Date ? value.getTime() : new Date(value).getTime()
const failure = (code, message) => Object.assign(new Error(message), { businessCode: code })
const assert = (condition, code, message) => { if (!condition) throw failure(code, message) }
const safeId = (value) => typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value)
const legacySessionId = (openid, requestId) => hash(`${openid}|${requestId}`).slice(0, 40)
const ownerId = (openid) => `owner_${hash(openid).slice(0, 40)}`
const targetKey = (session) => `target_${hash(`${session.kind}|${session.targetId}|${session.stage}`).slice(0, 40)}`
const chunkId = (id, index) => `${id}_${index}`

async function read(database, id, collection = COLLECTION, fields) {
  try {
    const document = database.collection(collection).doc(id)
    return (await (fields ? document.field(fields) : document).get()).data || null
  } catch (error) {
    if (/DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST|document.*(?:not found|not exist)|文档不存在/i.test(`${error.code || ""} ${error.message || error.errMsg || ""}`)) return null
    throw error
  }
}

function isAdmin(record) {
  return record && (record.role === "admin" || (Array.isArray(record.roles) && record.roles.includes("admin")) || record.admin === true || record.isAdmin === true)
}

async function authorize(openid, kind, adminOnly = false) {
  assert(openid, "FORBIDDEN", "权限不足")
  const result = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const allowed = (result.data || []).some((record) => {
    if (isAdmin(record)) return true
    if (adminOnly) return false
    const roles = [record.role].concat(record.roles || [], record.permissions || [])
    return (kind === "vehicle" ? ["vehicle_manage", "vehicle_manager"] : ["booking_manage", "booking_manager"]).some((role) => roles.includes(role))
  })
  assert(allowed, "FORBIDDEN", "权限不足")
}

async function target(database, session) {
  let current
  try { current = (await database.collection(session.kind === "vehicle" ? "vehicles" : "bookings").doc(session.targetId).field(TARGET_FIELDS).get()).data } catch (error) {
    if (!/DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST|document.*(?:not found|not exist)|文档不存在/i.test(`${error.code || ""} ${error.message || error.errMsg || ""}`)) throw error
  }
  assert(current, "NOT_FOUND", "上传目标不存在")
  if (session.kind === "vehicle") {
    assert(current.status !== "retired", "STATUS_NOT_ALLOWED", "停用车辆不能上传图片")
    assert(new Set(current.imageList || []).size < 9, "UPLOAD_LIMIT", "车辆图片数量已达上限")
  }
  else {
    assert(current.status === "confirmed", "STATUS_NOT_ALLOWED", "仅已确认预约可以上传交接照片")
    if (session.stage === "return") {
      const id = current.latestPickupHandoverId
      const pickup = id ? (await database.collection("booking_handovers").doc(id).field({ status: true }).get()).data : null
      assert(pickup && pickup.status === "confirmed", "PICKUP_NOT_CONFIRMED", "请先由用户核对取车记录")
    }
  }
  return current
}

function description(session) {
  return { ok: true, uploadId: session.uploadId, chunkSize: CHUNK_SIZE, chunkCount: session.chunkCount, expiresAt: time(session.expiresAt), ...(session.state === "complete" ? { fileID: session.fileID } : {}) }
}

async function removeChunks(session) {
  for (let start = 0; start < session.chunkCount; start += 6) {
    await Promise.all(Array.from({ length: Math.min(6, session.chunkCount - start) }, (_, i) => db.collection(COLLECTION).doc(chunkId(session.uploadId, start + i)).remove()))
  }
}

async function begin(input, openid) {
  assert(["vehicle", "handover"].includes(input.kind) && safeId(input.targetId), "VALIDATION_ERROR", "上传目标不合法")
  assert(input.kind === "handover" ? ["pickup", "return"].includes(input.stage) : input.stage === undefined || input.stage === "", "VALIDATION_ERROR", "交接阶段不合法")
  assert(typeof input.requestId === "string" && /^[A-Za-z0-9_-]{12,80}$/.test(input.requestId), "VALIDATION_ERROR", "上传请求编号不合法")
  assert(Number.isSafeInteger(input.size) && input.size > 0 && input.size <= MAX_BYTES, "VALIDATION_ERROR", "图片大小须为 1 字节至 10 MiB")
  assert(["jpg", "jpeg", "png", "webp"].includes(input.extension), "VALIDATION_ERROR", "仅支持 JPG、PNG 或 WebP 图片")
  await authorize(openid, input.kind)
  await cleanup(openid, true)
  const legacyId = legacySessionId(openid, input.requestId)
  const requestKey = `request_${legacyId}`
  // A request key may be reused after cleanup, but its session/chunk namespace must never be reused.
  // Generate once outside the callback so transaction retries keep the same new identity.
  const id = crypto.randomBytes(20).toString("hex")
  const fields = { kind: input.kind, targetId: input.targetId, stage: input.stage || "", size: input.size, extension: input.extension }
  const fingerprint = hash(JSON.stringify(fields))
  return db.runTransaction(async (transaction) => {
    const request = await read(transaction, requestKey)
    const previous = await read(transaction, request ? request.uploadId : legacyId)
    assert(previous || !request || time(request.expiresAt) <= Date.now() - LEASE, "UPLOAD_EXPIRED", "上传会话已结束，请重新选择图片")
    if (previous) {
      assert(previous.fingerprint === fingerprint, "IDEMPOTENCY_CONFLICT", "上传编号已绑定其他图片，请重新选择")
      assert(previous.state !== "aborted" && time(previous.expiresAt) > Date.now(), "UPLOAD_EXPIRED", "上传会话已结束，请重新选择图片")
      assert(await uploadUsable(transaction, previous), "UPLOAD_EXPIRED", "图片已放弃或清理，请重新选择图片")
      return description(previous)
    }
    const current = await target(transaction, fields)
    const quotaId = ownerId(openid)
    const quota = await read(transaction, quotaId) || { sessions: [], windowAt: Date.now(), count: 0 }
    const targetId = targetKey(fields)
    const targetQuota = await read(transaction, targetId) || { sessions: [] }
    const reservationCache = new Map()
    const reservedSession = async (entry) => {
      if (!reservationCache.has(entry.id)) reservationCache.set(entry.id, await read(transaction, entry.id))
      const other = reservationCache.get(entry.id)
      if (!other || other.state === "aborted") return null
      return time(other.expiresAt) > Date.now() || (other.state === "completing" && Number(other.leaseUntil) > Date.now()) ? other : null
    }
    const ownerSessions = []
    for (const entry of quota.sessions || []) {
      const other = await reservedSession(entry)
      if (other && other.state !== "complete") ownerSessions.push(entry)
    }
    const targetSessions = []
    for (const entry of targetQuota.sessions || []) {
      const other = await reservedSession(entry)
      if (!other) continue
      if (other.state === "complete" && (fields.kind === "handover" || (current.imageList || []).includes(other.fileID))) continue
      if (other.state === "complete" && !(await uploadUsable(transaction, other, current))) continue
      targetSessions.push(entry)
    }
    assert(ownerSessions.length < 9, "UPLOAD_LIMIT", "待处理上传过多，请完成或取消后重试")
    const windowAt = Date.now() - quota.windowAt >= 3600000 ? Date.now() : quota.windowAt
    const count = windowAt === quota.windowAt ? quota.count : 0
    assert(count < 36, "UPLOAD_LIMIT", "图片上传过于频繁，请稍后重试")
    const available = fields.kind === "vehicle" ? 9 - new Set(current.imageList || []).size : 4
    assert(targetSessions.length < available, "UPLOAD_LIMIT", "当前目标的图片上传数量已达上限")
    const expiresAt = new Date(Date.now() + TTL)
    const entry = { id, expiresAt: expiresAt.getTime() }
    const path = `${fields.kind === "vehicle" ? "vehicle-images" : "handover-images"}/${fields.targetId}/${fields.stage ? `${fields.stage}/` : ""}${Date.now()}_${BigInt(`0x${id}`).toString()}.${fields.extension}`
    const session = { ...fields, uploadId: id, openid, fingerprint, recordType: "session", state: "uploading", chunkCount: Math.ceil(fields.size / CHUNK_SIZE), cloudPath: path, expiresAt, createdAt: db.serverDate() }
    await transaction.collection(COLLECTION).doc(quotaId).set({ data: { recordType: "quota", openid, sessions: ownerSessions.concat(entry), windowAt, count: count + 1, expiresAt: new Date(Date.now() + 3600000) } })
    await transaction.collection(COLLECTION).doc(targetId).set({ data: { recordType: "quota", sessions: targetSessions.concat(entry), expiresAt } })
    await transaction.collection(COLLECTION).doc(id).set({ data: session })
    await transaction.collection(COLLECTION).doc(requestKey).set({ data: { recordType: "request", openid, uploadId: id, expiresAt } })
    return description(session)
  })
}

async function sessionFor(input, openid) {
  assert(typeof input.uploadId === "string" && /^[a-f0-9]{40}$/.test(input.uploadId), "VALIDATION_ERROR", "上传会话编号不合法")
  const session = await read(db, input.uploadId)
  assert(session && session.recordType === "session" && session.openid === openid, "FORBIDDEN", "无权操作该上传会话")
  await authorize(openid, session.kind)
  return session
}

function active(session) {
  assert(session && time(session.expiresAt) > Date.now() && session.state !== "aborted", "UPLOAD_EXPIRED", "上传会话已结束，请重新选择图片")
}

async function chunk(input, session) {
  assert(Number.isSafeInteger(input.index) && input.index >= 0 && input.index < session.chunkCount, "VALIDATION_ERROR", "分块编号不合法")
  assert(typeof input.data === "string" && input.data.length <= CHUNK_SIZE * 4 / 3 && /^[A-Za-z0-9+/]+={0,2}$/.test(input.data), "VALIDATION_ERROR", "分块数据不合法")
  const bytes = Buffer.from(input.data, "base64")
  const expected = Math.min(CHUNK_SIZE, session.size - input.index * CHUNK_SIZE)
  assert(bytes.length === expected && bytes.toString("base64") === input.data, "VALIDATION_ERROR", "分块大小或编码不合法")
  const digest = hash(bytes)
  return db.runTransaction(async (transaction) => {
    const current = await read(transaction, session.uploadId)
    active(current)
    assert(current.state === "uploading", "UPLOAD_BUSY", "图片正在校验，请稍后重试")
    await target(transaction, current)
    const id = chunkId(session.uploadId, input.index)
    const previous = await read(transaction, id)
    if (previous) {
      assert(previous.digest === digest, "IDEMPOTENCY_CONFLICT", "该分块已接收不同内容，请重新选择图片")
      return { ok: true, index: input.index, duplicated: true }
    }
    await transaction.collection(COLLECTION).doc(id).set({ data: { recordType: "chunk", uploadId: session.uploadId, openid: session.openid, index: input.index, data: input.data, digest, expiresAt: current.expiresAt } })
    // Make concurrent completion/abort conflict with the chunk insert.
    await transaction.collection(COLLECTION).doc(session.uploadId).update({ data: { received: Number(current.received || 0) + 1 } })
    return { ok: true, index: input.index }
  })
}

function cleanupId(session, fileID) {
  return `${session.kind === "vehicle" ? "pending_image_cleanup" : "handover_image_cleanup"}_${hash(`${session.targetId}|${fileID}`).slice(0, 32)}`
}

async function uploadUsable(database, session, vehicle) {
  const fileID = session.fileID || session.expectedFileID
  if (!fileID) return true
  const guard = await read(database, cleanupId(session, fileID), "pending_file_deletions", IMAGE_GUARD_FIELDS)
  if (!guard) return true
  if (["deleting", "deleted"].includes(guard.deletionState)) return false
  if (!guard.uploadAbandoned || session.kind !== "vehicle") return true
  const current = vehicle || await read(database, session.targetId, "vehicles", IMAGE_REFERENCE_FIELDS)
  // A delayed attachment is still allowed while cleanup is pending. Its live
  // reference wins over an earlier abandonment request from a timed-out page.
  return Boolean(current && ((current.imageList || []).includes(fileID) || current.coverImage === fileID))
}

function cleanupRecord(session, fileID) {
  const vehicle = session.kind === "vehicle"
  const id = cleanupId(session, fileID)
  return { id, data: { fileList: [fileID], context: vehicle ? { vehicleId: session.targetId, action: "cleanupUpload" } : { bookingId: session.targetId, stage: session.stage }, source: vehicle ? "vehicleImageUploadCleanup" : "bookingHandoverUploadCleanup", deletionState: "pending", attemptCount: 0, notBeforeAt: new Date(time(session.expiresAt) + LEASE), createdAt: db.serverDate() } }
}

async function releaseOwner(transaction, session) {
  const id = ownerId(session.openid)
  const quota = await read(transaction, id)
  if (quota) await transaction.collection(COLLECTION).doc(id).update({ data: { sessions: (quota.sessions || []).filter((entry) => entry.id !== session.uploadId) } })
}

async function complete(session) {
  const token = crypto.randomBytes(12).toString("hex")
  const claimed = await db.runTransaction(async (transaction) => {
    const current = await read(transaction, session.uploadId)
    active(current)
    assert(await uploadUsable(transaction, current), "UPLOAD_EXPIRED", "图片已放弃或清理，请重新选择图片")
    if (current.state === "complete") return current
    assert(current.state !== "completing" || Number(current.leaseUntil) <= Date.now(), "UPLOAD_BUSY", "图片正在校验，请稍后重试")
    assert(current.received === current.chunkCount, "UPLOAD_INCOMPLETE", "图片分块尚未传完")
    await target(transaction, current)
    await transaction.collection(COLLECTION).doc(current.uploadId).update({ data: { state: "completing", token, leaseUntil: Date.now() + LEASE } })
    return current
  })
  if (claimed.state === "complete") return { ok: true, fileID: claimed.fileID, duplicated: true }
  try {
    const chunks = []
    for (let start = 0; start < claimed.chunkCount; start += 6) {
      const records = await Promise.all(Array.from({ length: Math.min(6, claimed.chunkCount - start) }, (_, index) => read(db, chunkId(claimed.uploadId, start + index))))
      for (const record of records) {
        assert(record && typeof record.data === "string", "UPLOAD_INCOMPLETE", "图片分块缺失")
        const bytes = Buffer.from(record.data, "base64")
        assert(hash(bytes) === record.digest, "VALIDATION_ERROR", "图片分块校验失败")
        chunks.push(bytes)
      }
    }
    const bytes = Buffer.concat(chunks)
    const type = imageType(bytes)
    assert(bytes.length === claimed.size && bytes.length <= MAX_BYTES, "VALIDATION_ERROR", "图片实际大小不合法")
    assert(type && type === (claimed.extension === "jpeg" ? "jpg" : claimed.extension), "VALIDATION_ERROR", "图片内容与格式不符或文件已损坏")
    const digest = hash(bytes)
    let fileID = claimed.expectedFileID
    if (!fileID) {
      const metadata = await storage.getUploadMetadata({ cloudPath: claimed.cloudPath })
      fileID = metadata && metadata.data && (metadata.data.fileId || metadata.data.fileID)
      assert(typeof fileID === "string" && fileID.startsWith("cloud://") && fileID.slice(fileID.indexOf("/", 8) + 1) === claimed.cloudPath, "INTERNAL_ERROR", "上传地址生成失败")
      await db.runTransaction(async (transaction) => {
        const current = await read(transaction, claimed.uploadId)
        assert(current.token === token && current.state === "completing", "UPLOAD_BUSY", "上传状态已变化")
        const queue = cleanupRecord(claimed, fileID)
        const guard = await read(transaction, queue.id, "pending_file_deletions", IMAGE_GUARD_FIELDS)
        assert(!guard || (!guard.uploadAbandoned && !["deleting", "deleted"].includes(guard.deletionState)), "UPLOAD_EXPIRED", "图片已放弃或清理，请重新选择图片")
        await transaction.collection("pending_file_deletions").doc(queue.id).set({ data: queue.data })
        await transaction.collection(COLLECTION).doc(claimed.uploadId).update({ data: { expectedFileID: fileID, digest } })
      })
    }
    let exists = false
    if (claimed.expectedFileID) try {
      const existing = await cloud.downloadFile({ fileID })
      assert(existing && Buffer.isBuffer(existing.fileContent) && hash(existing.fileContent) === digest, "IDEMPOTENCY_CONFLICT", "已存在图片与本次内容不同")
      exists = true
    } catch (error) {
      const code = String(error.code || error.errCode || "")
      const message = String(error.message || error.errMsg || "")
      const missing = /STORAGE_FILE_NOT_EXIST|STORAGE_FILE_NONEXIST|FILE_NOT_FOUND|FILE_NOT_EXIST|OBJECT_NOT_EXIST|-503003/i.test(code) || /file.*(?:not found|not exist)|文件.*不存在/i.test(message) || (code === "STORAGE_REQUEST_FAIL" && /Status:404\b/.test(message))
      if (!missing) throw error
    }
    if (!exists) {
      await authorize(claimed.openid, claimed.kind)
      await target(db, claimed)
      const uploaded = await cloud.uploadFile({ cloudPath: claimed.cloudPath, fileContent: bytes })
      assert(uploaded && uploaded.fileID === fileID, "INTERNAL_ERROR", "上传结果未确认，请重试")
    }
    await db.runTransaction(async (transaction) => {
      const current = await read(transaction, claimed.uploadId)
      assert(current.token === token && current.state === "completing", "UPLOAD_BUSY", "上传状态已变化")
      assert(await uploadUsable(transaction, { ...current, fileID }), "UPLOAD_EXPIRED", "图片已放弃或清理，请重新选择图片")
      await target(transaction, current)
      await transaction.collection(COLLECTION).doc(claimed.uploadId).update({ data: { state: "complete", fileID, leaseUntil: 0 } })
      await releaseOwner(transaction, current)
    })
    await removeChunks(claimed).catch(() => {})
    return { ok: true, fileID }
  } catch (error) {
    await db.runTransaction(async (transaction) => {
      const current = await read(transaction, session.uploadId)
      if (current && current.token === token && current.state === "completing") await transaction.collection(COLLECTION).doc(session.uploadId).update({ data: { state: "uploading", leaseUntil: 0 } })
    }).catch(() => {})
    throw error
  }
}

async function abort(session) {
  await db.runTransaction(async (transaction) => {
    const current = await read(transaction, session.uploadId)
    if (!current || current.state === "aborted") return
    assert(current.state !== "completing" || current.leaseUntil <= Date.now(), "UPLOAD_BUSY", "图片正在校验，请稍后重试")
    await transaction.collection(COLLECTION).doc(session.uploadId).update({ data: { state: "aborted" } })
    await releaseOwner(transaction, current)
  })
  await removeChunks(session)
  return { ok: true }
}

async function cleanup(openid, ownOnly = false) {
  if (!ownOnly) await authorize(openid, "", true)
  const result = await db.collection(COLLECTION).where({ ...(ownOnly ? { openid } : {}), expiresAt: db.command.lte(new Date(Date.now() - LEASE)) }).field({ recordType: true, uploadId: true, chunkCount: true }).limit(50).get()
  let removed = 0
  for (const record of result.data || []) {
    const expired = await db.runTransaction(async (transaction) => {
      const current = await read(transaction, record._id)
      if (!current || (ownOnly && current.openid !== openid) || time(current.expiresAt) > Date.now() - LEASE || Number(current.leaseUntil) > Date.now()) return null
      if (current.recordType === "session") {
        await transaction.collection(COLLECTION).doc(record._id).update({ data: { state: "aborted" } })
        await releaseOwner(transaction, current)
      } else await transaction.collection(COLLECTION).doc(record._id).remove()
      return current
    })
    if (!expired) continue
    if (expired.recordType === "session") {
      await removeChunks(expired)
      await db.collection(COLLECTION).doc(record._id).remove()
    }
    removed += 1
  }
  return { ok: true, removed, hasMore: (result.data || []).length === 50 }
}

exports.main = async (event) => {
  const context = cloud.getWXContext()
  const openid = context && context.OPENID
  try {
    assert(openid, "FORBIDDEN", "权限不足")
    const input = event && typeof event === "object" && !Array.isArray(event) ? event : {}
    assert(["begin", "chunk", "complete", "abort", "cleanup"].includes(input.action), "VALIDATION_ERROR", "上传操作不合法")
    if (input.action === "begin") return await begin(input, openid)
    if (input.action === "cleanup") return await cleanup(openid, input.ownOnly === true)
    const session = await sessionFor(input, openid)
    if (input.action === "chunk") return await chunk(input, session)
    if (input.action === "complete") return await complete(session)
    return await abort(session)
  } catch (error) {
    return { ok: false, code: error.businessCode || "INTERNAL_ERROR", message: error.businessCode ? error.message : "图片上传服务暂不可用，请稍后重试" }
  }
}
