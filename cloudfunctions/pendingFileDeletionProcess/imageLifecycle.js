const crypto = require("crypto")

const VEHICLE_REFERENCE_FIELDS = { imageList: true, coverImage: true }
const GUARD_FIELDS = { deletionState: true, attemptCount: true }

function guardId(vehicleId, fileId) {
  return `pending_image_cleanup_${crypto.createHash("sha256").update(`${vehicleId}|${fileId}`).digest("hex").slice(0, 32)}`
}

function isMissing(error) {
  return /DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST|OBJECT_NOT_EXIST|document.*(?:not\s+found|not\s+exist)|文档不存在/i.test(String(error && (error.code || error.errCode) || "") + " " + String(error && (error.message || error.errMsg) || error || ""))
}

async function readDocument(collection, id, fields) {
  try {
    const result = await collection.doc(id).field(fields).get()
    return result && result.data || null
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }
}

function uniqueFiles(files) {
  return [...new Set((Array.isArray(files) ? files : []).map((item) => String(item || "").trim()).filter(Boolean))]
}

function isMissingFile(item) {
  return /STORAGE_FILE_NOT_EXIST|FILE_(?:NOT_FOUND|NOT_EXIST)|OBJECT_NOT_EXIST|file[^\n]*(?:not\s+found|not\s+exist)|文件[^\n]*不存在/i.test(String(item && (item.code || item.errCode || item.status) || "") + " " + String(item && (item.errMsg || item.message) || ""))
}

function createImageLifecycle(db, cloud) {
  async function writeClaim(transaction, vehicleId, fileId, source, action) {
    const id = guardId(vehicleId, fileId)
    const current = await readDocument(transaction.collection("pending_file_deletions"), id, GUARD_FIELDS)
    if (current && current.deletionState === "deleted") return false
    await transaction.collection("pending_file_deletions").doc(id).set({ data: {
      fileList: [fileId], context: { vehicleId, action }, source,
      deletionState: "deleting", attemptCount: Number(current && current.attemptCount || 0),
      createdAt: db.serverDate()
    } })
    return true
  }

  async function canAttach(transaction, vehicleId, fileIds) {
    for (const fileId of uniqueFiles(fileIds)) {
      const guard = await readDocument(transaction.collection("pending_file_deletions"), guardId(vehicleId, fileId), GUARD_FIELDS)
      if (guard && ["deleting", "deleted"].includes(guard.deletionState)) return false
    }
    return true
  }

  async function queueUpload(vehicleId, fileId, notBeforeAt) {
    return db.runTransaction(async (transaction) => {
      const id = guardId(vehicleId, fileId)
      const current = await readDocument(transaction.collection("pending_file_deletions"), id, GUARD_FIELDS)
      if (current && ["deleting", "deleted"].includes(current.deletionState)) return
      await transaction.collection("pending_file_deletions").doc(id).set({ data: {
        fileList: [fileId], context: { vehicleId, action: "cleanupUpload" },
        source: "vehicleImageUploadCleanup", deletionState: "pending", notBeforeAt,
        createdAt: db.serverDate()
      } })
    })
  }

  async function deleteClaimed(vehicleId, files) {
    const fileList = uniqueFiles(files)
    if (!fileList.length) return { failed: 0 }
    let result
    let error
    try { result = await cloud.deleteFile({ fileList }) } catch (failure) { error = failure }
    const items = result && Array.isArray(result.fileList) ? result.fileList : []
    let failed = 0
    for (const fileId of fileList) {
      const item = items.find((entry) => String(entry && (entry.fileID || entry.fileId) || "") === fileId)
      const success = error ? isMissingFile(error) : Boolean(item && (item.status === 0 || item.status === "0" || isMissingFile(item)))
      if (!success) failed += 1
      await db.runTransaction(async (transaction) => {
        const id = guardId(vehicleId, fileId)
        const guard = await readDocument(transaction.collection("pending_file_deletions"), id, GUARD_FIELDS)
        if (guard && guard.deletionState === "deleted") return
        await transaction.collection("pending_file_deletions").doc(id).update({ data: success
          ? { deletionState: "deleted", deletedAt: db.serverDate() }
          : { deletionState: "deleting", attemptCount: Number(guard && guard.attemptCount || 0) + 1, lastError: "云存储删除失败", lastAttemptAt: db.serverDate() }
        })
      })
    }
    return { failed }
  }

  async function processQueueRecord(record) {
    const vehicleId = String(record && record.context && record.context.vehicleId || "").trim()
    const files = uniqueFiles(record && record.fileList)
    if (!vehicleId) return { deleted: 0, failed: 0, invalid: 1, deferred: 0, preserved: 0 }
    const outcome = await db.runTransaction(async (transaction) => {
      const vehicle = await readDocument(transaction.collection("vehicles"), vehicleId, VEHICLE_REFERENCE_FIELDS)
      const references = new Set(uniqueFiles(vehicle && vehicle.imageList).concat(String(vehicle && vehicle.coverImage || "").trim()).filter(Boolean))
      const orphanFiles = []
      let preserved = 0
      for (const fileId of files) {
        const id = guardId(vehicleId, fileId)
        if (references.has(fileId)) {
          preserved += 1
          // Remove a queued check only while it is still pending. A deletion claim
          // and its permanent tombstone are never erased by a stale cleanup call.
          const guard = await readDocument(transaction.collection("pending_file_deletions"), id, GUARD_FIELDS)
          if (guard && !["deleting", "deleted"].includes(guard.deletionState)) await transaction.collection("pending_file_deletions").doc(id).remove()
        } else if (await writeClaim(transaction, vehicleId, fileId, "vehicleImageUpdate", "verifiedCleanup")) {
          orphanFiles.push(fileId)
        }
      }
      if (vehicle && orphanFiles.length) {
        // Image attachment also writes this vehicle. This write closes the gap
        // between reference verification and the permanent file deletion claim.
        await transaction.collection("vehicles").doc(vehicleId).update({ data: { imageCleanupAt: db.serverDate() } })
      }
      return { orphanFiles, preserved }
    })
    const deletion = await deleteClaimed(vehicleId, outcome.orphanFiles)
    const canonicalIds = files.map((fileId) => guardId(vehicleId, fileId))
    if (!canonicalIds.includes(record._id)) await db.collection("pending_file_deletions").doc(record._id).remove()
    return { deleted: deletion.failed ? 0 : (outcome.preserved === files.length ? 0 : 1), failed: deletion.failed ? 1 : 0, invalid: 0, deferred: 0, preserved: outcome.preserved }
  }

  return { writeClaim, canAttach, queueUpload, deleteClaimed, processQueueRecord }
}

module.exports = { createImageLifecycle, guardId, readDocument, VEHICLE_REFERENCE_FIELDS }
