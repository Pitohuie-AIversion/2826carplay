const crypto = require("crypto")

const REVISION_FIELDS = { handoverImageRevision: true }
const GUARD_FIELDS = { deletionState: true, attemptCount: true }
const MAX_HISTORY = 2000

function guardId(bookingId, fileId) {
  return `handover_image_cleanup_${crypto.createHash("sha256").update(`${bookingId}|${fileId}`).digest("hex").slice(0, 32)}`
}

function validImage(fileId, bookingId, stage) {
  const match = /^cloud:\/\/[^/]+\/handover-images\/([^/]+)\/(pickup|return)\/[^/]+\.(?:jpe?g|png|webp)$/i.exec(String(fileId || ""))
  return Boolean(match && match[1] === bookingId && (!stage || match[2] === stage))
}

async function readDocument(collection, id, fields) {
  try {
    const result = await collection.doc(id).field(fields).get()
    return result && result.data || null
  } catch (error) {
    const message = `${error && (error.code || error.errCode) || ""} ${error && (error.message || error.errMsg) || ""}`
    if (/DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST|document.*(?:not\s+found|not\s+exist)|文档不存在/i.test(message)) return null
    throw error
  }
}

function revision(record) {
  return Number(record && record.handoverImageRevision || 0)
}

function missingFile(value) {
  return /STORAGE_FILE_NOT_EXIST|FILE_(?:NOT_FOUND|NOT_EXIST)|OBJECT_NOT_EXIST|file[^\n]*(?:not\s+found|not\s+exist)|文件[^\n]*不存在/i.test(`${value && (value.code || value.errCode || value.status) || ""} ${value && (value.errMsg || value.message) || ""}`)
}

function createHandoverImageLifecycle(db, cloud) {
  async function canAttach(transaction, bookingId, files) {
    for (const fileId of files) {
      const guard = await readDocument(transaction.collection("pending_file_deletions"), guardId(bookingId, fileId), GUARD_FIELDS)
      if (guard && ["deleting", "deleted"].includes(guard.deletionState)) return false
    }
    return true
  }

  async function queueUpload(bookingId, stage, files) {
    return db.runTransaction(async (transaction) => {
      for (const fileId of files) {
        const id = guardId(bookingId, fileId)
        const guard = await readDocument(transaction.collection("pending_file_deletions"), id, GUARD_FIELDS)
        if (guard && ["deleting", "deleted"].includes(guard.deletionState)) continue
        await transaction.collection("pending_file_deletions").doc(id).set({ data: {
          fileList: [fileId], context: { bookingId, stage }, source: "bookingHandoverUploadCleanup",
          deletionState: "pending", attemptCount: 0,
          notBeforeAt: new Date(Date.now() + 30000), createdAt: db.serverDate()
        } })
      }
    })
  }

  async function readReferences(bookingId) {
    const references = new Set()
    for (let offset = 0; offset <= MAX_HISTORY; offset += 100) {
      const result = await db.collection("booking_handovers").where({ bookingId }).field({ photos: true }).orderBy("_id", "asc").skip(offset).limit(offset === MAX_HISTORY ? 1 : 100).get()
      const records = result && result.data
      if (!Array.isArray(records)) throw new Error("交接图片引用查询不完整")
      if (offset === MAX_HISTORY && records.length) throw new Error("交接历史超过核验上限")
      for (const record of records) {
        for (const photo of Array.isArray(record.photos) ? record.photos : []) {
          if (photo && photo.fileId) references.add(photo.fileId)
        }
      }
      if (records.length < 100) break
    }
    return references
  }

  async function deleteClaimed(bookingId, files) {
    if (!files.length) return { failed: 0 }
    let result
    let failure
    try { result = await cloud.deleteFile({ fileList: files }) } catch (error) { failure = error }
    const results = result && Array.isArray(result.fileList) ? result.fileList : []
    let failed = 0
    for (const fileId of files) {
      const item = results.find((entry) => String(entry && (entry.fileID || entry.fileId) || "") === fileId)
      const success = failure ? missingFile(failure) : Boolean(item && (item.status === 0 || item.status === "0" || missingFile(item)))
      if (!success) failed += 1
      await db.runTransaction(async (transaction) => {
        const id = guardId(bookingId, fileId)
        const guard = await readDocument(transaction.collection("pending_file_deletions"), id, GUARD_FIELDS)
        if (guard && guard.deletionState === "deleted") return
        if (!guard || guard.deletionState !== "deleting") throw new Error("交接图片删除标记缺失")
        await transaction.collection("pending_file_deletions").doc(id).update({ data: success
          ? { deletionState: "deleted", deletedAt: db.serverDate() }
          : { attemptCount: Number(guard.attemptCount || 0) + 1, lastError: "云存储删除未确认", lastAttemptAt: db.serverDate() }
        })
      })
    }
    return { failed }
  }

  async function processQueueRecord(record) {
    const bookingId = String(record && record.context && record.context.bookingId || "").trim()
    const files = [...new Set(record && Array.isArray(record.fileList) ? record.fileList : [])]
    if (!bookingId || !files.length || files.length > 9 || files.some((fileId) => !validImage(fileId, bookingId))) throw new Error("交接清理路径或数量不合法")
    // Querying inside CloudBase transactions is unsupported. Fence this complete
    // external scan with the revision all reference mutations increment.
    const baseline = await readDocument(db.collection("bookings"), bookingId, REVISION_FIELDS)
    if (!baseline) throw new Error("预约不存在，交接图片需人工核验")
    const references = await readReferences(bookingId)
    const outcome = await db.runTransaction(async (transaction) => {
      const current = await readDocument(transaction.collection("bookings"), bookingId, REVISION_FIELDS)
      if (!current || revision(current) !== revision(baseline)) throw new Error("交接图片引用已变化，请重试")
      const orphanFiles = []
      let preserved = 0
      for (const fileId of files) {
        const id = guardId(bookingId, fileId)
        const guard = await readDocument(transaction.collection("pending_file_deletions"), id, GUARD_FIELDS)
        if (references.has(fileId)) {
          preserved += 1
          if (guard && !["deleting", "deleted"].includes(guard.deletionState)) await transaction.collection("pending_file_deletions").doc(id).remove()
        } else if (!guard || guard.deletionState !== "deleted") {
          await transaction.collection("pending_file_deletions").doc(id).set({ data: {
            fileList: [fileId], context: { bookingId }, source: "bookingHandoverUploadCleanup",
            deletionState: "deleting", attemptCount: Number(guard && guard.attemptCount || 0), createdAt: db.serverDate()
          } })
          orphanFiles.push(fileId)
        }
      }
      if (orphanFiles.length) {
        // Submit also writes this booking, so overlapping transactions conflict
        // even when no image guard existed when submit began.
        await transaction.collection("bookings").doc(bookingId).update({ data: { handoverImageRevision: revision(current) + 1 } })
      }
      return { orphanFiles, preserved }
    })
    const deletion = await deleteClaimed(bookingId, outcome.orphanFiles)
    if (!files.some((fileId) => guardId(bookingId, fileId) === record._id)) await db.collection("pending_file_deletions").doc(record._id).remove()
    return { deleted: deletion.failed || outcome.preserved === files.length ? 0 : 1, failed: deletion.failed ? 1 : 0, invalid: 0, deferred: 0, preserved: outcome.preserved }
  }

  return { canAttach, queueUpload, processQueueRecord, deleteClaimed }
}

module.exports = { createHandoverImageLifecycle, guardId, validImage, revision }
