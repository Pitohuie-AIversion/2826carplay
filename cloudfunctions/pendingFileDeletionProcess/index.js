const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const PENDING_DELETION_FIELDS = {
  _id: true,
  fileList: true,
  attemptCount: true,
  context: true,
  source: true,
  notBeforeAt: true
}
const VEHICLE_IMAGE_REFERENCE_FIELDS = {
  imageList: true
}
const VERIFIED_IMAGE_CLEANUP_SOURCE = "vehicleImageUploadCleanup"
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 5
const QUEUE_SCAN_LIMIT = 100

function createError(code, message) {
  return {
    ok: false,
    code: String(code || "INTERNAL_ERROR"),
    message: String(message || "处理失败")
  }
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }

  const list = []
  value.forEach((item) => {
    const text = String(item || "").trim()
    if (text && !list.includes(text)) {
      list.push(text)
    }
  })
  return list
}

function hasAdminRole(record) {
  if (!record || typeof record !== "object") {
    return false
  }

  return (
    record.role === "admin" ||
    (Array.isArray(record.roles) && record.roles.includes("admin")) ||
    record.isAdmin === true ||
    record.admin === true
  )
}

async function isAdminOpenid(openid) {
  if (!openid) {
    return false
  }

  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasAdminRole(item))
}

function normalizeLimit(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return DEFAULT_LIMIT
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(number)))
}

function normalizeErrorMessage(error) {
  const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error || "")
  return String(message).slice(0, 300)
}

function normalizeDeletionError(error) {
  const code = String((error && (error.code || error.errCode)) || "").trim().slice(0, 64)
  return code ? `云存储删除失败（错误码 ${code}）` : "云存储删除失败"
}

function isAlreadyMissingFileError(error) {
  const code = String(
    (error && (error.code || error.errCode || error.status)) || ""
  )
  const message = String(
    error && (error.errMsg || error.message) ? error.errMsg || error.message : ""
  )
  return (
    /STORAGE_FILE_NOT_EXIST|FILE_(?:NOT_FOUND|NOT_EXIST)|OBJECT_NOT_EXIST/i.test(code) ||
    /file[^\n]*(?:not\s+found|not\s+exist)|文件[^\n]*不存在/i.test(message)
  )
}

function toTimestamp(value) {
  if (!value) {
    return 0
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().getTime()
  }
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function isDeferredImageCleanup(record, now) {
  if (String(record && record.source) !== VERIFIED_IMAGE_CLEANUP_SOURCE) {
    return false
  }
  const notBeforeAt = toTimestamp(record && record.notBeforeAt)
  return Boolean(notBeforeAt && now < notBeforeAt)
}

function selectQueueRecords(records, limit, now) {
  const list = Array.isArray(records) ? records : []
  const ready = list.filter((record) => !isDeferredImageCleanup(record, now))
  const candidates = ready.length ? ready : list
  return candidates.slice(0, limit)
}

function isDocumentNotFoundError(error) {
  const code = String((error && (error.code || error.errCode)) || "")
  const message = String(
    error && (error.message || error.errMsg) ? error.message || error.errMsg : error || ""
  )
  return (
    /DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST|OBJECT_NOT_EXIST/i.test(code) ||
    /document.*(?:not\s+found|not\s+exist)|文档不存在/i.test(message)
  )
}

async function readVehicleImageReferences(vehicleId) {
  try {
    const res = await db
      .collection("vehicles")
      .doc(vehicleId)
      .field(VEHICLE_IMAGE_REFERENCE_FIELDS)
      .get()
    return normalizeStringArray(res && res.data && res.data.imageList)
  } catch (error) {
    if (isDocumentNotFoundError(error)) {
      return []
    }
    throw error
  }
}

function failedFilesFromResult(result, originalFileList) {
  const resultList = result && Array.isArray(result.fileList) ? result.fileList : []
  if (!resultList.length) {
    return []
  }

  const failedItems = resultList.filter((item) => {
    if (!item || typeof item !== "object") {
      return false
    }
    if (isAlreadyMissingFileError(item)) {
      return false
    }
    const status = Number(item.status)
    return (Number.isFinite(status) && status !== 0) || (!Number.isFinite(status) && Boolean(item.errMsg))
  })
  const failedFiles = failedItems
    .map((item) => String(item.fileID || item.fileId || "").trim())
    .filter(Boolean)
  return failedItems.length && !failedFiles.length
    ? normalizeStringArray(originalFileList)
    : failedFiles
}

async function writeAuditLogBestEffort(payload) {
  try {
    await db.collection("audit_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {}
}

async function writeErrorLogBestEffort(payload) {
  try {
    await db.collection("error_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {}
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const limit = normalizeLimit(event && event.limit)

  try {
    if (!(await isAdminOpenid(openid))) {
      return createError("FORBIDDEN", "权限不足")
    }

    const queueRes = await db
      .collection("pending_file_deletions")
      .field(PENDING_DELETION_FIELDS)
      .limit(QUEUE_SCAN_LIMIT)
      .get()
    const scannedQueue = queueRes && Array.isArray(queueRes.data) ? queueRes.data : []
    const queue = selectQueueRecords(scannedQueue, limit, Date.now())
    const results = await Promise.all(queue.map(async (record) => {
      const recordId = String((record && record._id) || "").trim()
      let fileList = normalizeStringArray(record && record.fileList)
      let preserved = 0
      if (!recordId) {
        return { deleted: 0, failed: 0, invalid: 1, deferred: 0, preserved: 0 }
      }

      if (!fileList.length) {
        await db.collection("pending_file_deletions").doc(recordId).remove()
        return { deleted: 0, failed: 0, invalid: 1, deferred: 0, preserved: 0 }
      }

      if (String(record && record.source) === VERIFIED_IMAGE_CLEANUP_SOURCE) {
        const notBeforeAt = toTimestamp(record && record.notBeforeAt)
        if (notBeforeAt && Date.now() < notBeforeAt) {
          return { deleted: 0, failed: 0, invalid: 0, deferred: 1, preserved: 0 }
        }

        const vehicleId = String(
          record && record.context && record.context.vehicleId
            ? record.context.vehicleId
            : ""
        ).trim()
        if (!vehicleId) {
          await db.collection("pending_file_deletions").doc(recordId).remove()
          return { deleted: 0, failed: 0, invalid: 1, deferred: 0, preserved: 0 }
        }

        try {
          const referencedFileIds = new Set(await readVehicleImageReferences(vehicleId))
          const orphanFileIds = fileList.filter((fileId) => !referencedFileIds.has(fileId))
          preserved = fileList.length - orphanFileIds.length
          fileList = orphanFileIds
          if (!fileList.length) {
            await db.collection("pending_file_deletions").doc(recordId).remove()
            return { deleted: 0, failed: 0, invalid: 0, deferred: 0, preserved }
          }
        } catch (error) {
          await db.collection("pending_file_deletions").doc(recordId).update({
            data: {
              attemptCount: (Number(record.attemptCount) || 0) + 1,
              lastError: "图片引用核验失败",
              lastAttemptAt: db.serverDate()
            }
          })
          return { deleted: 0, failed: 1, invalid: 0, deferred: 0, preserved: 0 }
        }
      }

      try {
        const deleteResult = await cloud.deleteFile({ fileList })
        const failedFiles = failedFilesFromResult(deleteResult, fileList)
        if (!failedFiles.length) {
          await db.collection("pending_file_deletions").doc(recordId).remove()
          return { deleted: 1, failed: 0, invalid: 0, deferred: 0, preserved }
        }

        await db.collection("pending_file_deletions").doc(recordId).update({
          data: {
            fileList: failedFiles,
            attemptCount: (Number(record.attemptCount) || 0) + 1,
            lastError: "部分文件删除失败",
            lastAttemptAt: db.serverDate()
          }
        })
        return { deleted: 0, failed: 1, invalid: 0, deferred: 0, preserved }
      } catch (error) {
        if (isAlreadyMissingFileError(error)) {
          await db.collection("pending_file_deletions").doc(recordId).remove()
          return { deleted: 1, failed: 0, invalid: 0, deferred: 0, preserved }
        }
        await db.collection("pending_file_deletions").doc(recordId).update({
          data: {
            attemptCount: (Number(record.attemptCount) || 0) + 1,
            lastError: normalizeDeletionError(error),
            lastAttemptAt: db.serverDate()
          }
        })
        return { deleted: 0, failed: 1, invalid: 0, deferred: 0, preserved }
      }
    }))
    const deleted = results.reduce((total, item) => total + item.deleted, 0)
    const failed = results.reduce((total, item) => total + item.failed, 0)
    const invalid = results.reduce((total, item) => total + item.invalid, 0)
    const deferred = results.reduce((total, item) => total + item.deferred, 0)
    const preserved = results.reduce((total, item) => total + item.preserved, 0)

    await writeAuditLogBestEffort({
      openid,
      action: "pendingFileDeletionProcess",
      processed: queue.length,
      deleted,
      failed,
      invalid,
      deferred,
      preserved
    })

    return {
      ok: true,
      processed: queue.length,
      deleted,
      failed,
      invalid,
      deferred,
      preserved,
      hasMore:
        scannedQueue.length > queue.length || scannedQueue.length === QUEUE_SCAN_LIMIT,
      message: !queue.length
        ? "暂无待清理文件"
        : deferred === queue.length
          ? "图片仍在安全核验期，请稍后重试"
          : "存储清理队列已处理"
    }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "pendingFileDeletionProcess",
      stage: "main",
      authenticated: Boolean(openid),
      limit,
      errorMessage: normalizeErrorMessage(error),
      occurredAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "清理失败，请稍后重试")
  }
}
