const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const DEFAULT_LIMIT = 5
const MAX_LIMIT = 5

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

  const res = await db.collection("roles").where({ openid }).limit(20).get()
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

function failedFilesFromResult(result, originalFileList) {
  const resultList = result && Array.isArray(result.fileList) ? result.fileList : []
  if (!resultList.length) {
    return []
  }

  const failedItems = resultList.filter((item) => {
    if (!item || typeof item !== "object") {
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

    const queueRes = await db.collection("pending_file_deletions").limit(limit).get()
    const queue = queueRes && Array.isArray(queueRes.data) ? queueRes.data : []
    const results = await Promise.all(queue.map(async (record) => {
      const recordId = String((record && record._id) || "").trim()
      const fileList = normalizeStringArray(record && record.fileList)
      if (!recordId) {
        return { deleted: 0, failed: 0, invalid: 1 }
      }

      if (!fileList.length) {
        await db.collection("pending_file_deletions").doc(recordId).remove()
        return { deleted: 0, failed: 0, invalid: 1 }
      }

      try {
        const deleteResult = await cloud.deleteFile({ fileList })
        const failedFiles = failedFilesFromResult(deleteResult, fileList)
        if (!failedFiles.length) {
          await db.collection("pending_file_deletions").doc(recordId).remove()
          return { deleted: 1, failed: 0, invalid: 0 }
        }

        await db.collection("pending_file_deletions").doc(recordId).update({
          data: {
            fileList: failedFiles,
            attemptCount: (Number(record.attemptCount) || 0) + 1,
            lastError: "部分文件删除失败",
            lastAttemptAt: db.serverDate()
          }
        })
        return { deleted: 0, failed: 1, invalid: 0 }
      } catch (error) {
        await db.collection("pending_file_deletions").doc(recordId).update({
          data: {
            attemptCount: (Number(record.attemptCount) || 0) + 1,
            lastError: normalizeErrorMessage(error),
            lastAttemptAt: db.serverDate()
          }
        })
        return { deleted: 0, failed: 1, invalid: 0 }
      }
    }))
    const deleted = results.reduce((total, item) => total + item.deleted, 0)
    const failed = results.reduce((total, item) => total + item.failed, 0)
    const invalid = results.reduce((total, item) => total + item.invalid, 0)

    await writeAuditLogBestEffort({
      openid,
      action: "pendingFileDeletionProcess",
      processed: queue.length,
      deleted,
      failed,
      invalid
    })

    return {
      ok: true,
      processed: queue.length,
      deleted,
      failed,
      invalid,
      hasMore: queue.length === limit,
      message: queue.length ? "存储清理队列已处理" : "暂无待清理文件"
    }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "pendingFileDeletionProcess",
      openid,
      stage: "main",
      limit,
      errorMessage: normalizeErrorMessage(error),
      occurredAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "清理失败，请稍后重试")
  }
}
