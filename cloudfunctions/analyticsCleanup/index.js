const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const RETENTION_DAYS = 90
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 100
const REMOVE_CONCURRENCY = 10

function createError(code, message) {
  return {
    ok: false,
    code: String(code || "INTERNAL_ERROR"),
    message: String(message || "清理失败")
  }
}

function hasAdminRole(record) {
  return Boolean(
    record &&
      (record.role === "admin" ||
        (Array.isArray(record.roles) && record.roles.includes("admin")) ||
        record.isAdmin === true ||
        record.admin === true)
  )
}

async function isAdminOpenid(openid) {
  if (!openid) {
    return false
  }
  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some(hasAdminRole)
}

function normalizeLimit(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) {
    return DEFAULT_LIMIT
  }
  return Math.min(MAX_LIMIT, Math.max(1, Math.floor(number)))
}

function normalizeErrorMessage(error) {
  return String(
    (error && (error.message || error.errMsg)) || error || "匿名事件清理失败"
  ).slice(0, 300)
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

async function removeRecords(records) {
  let deleted = 0
  let failed = 0
  let firstErrorMessage = ""

  for (let offset = 0; offset < records.length; offset += REMOVE_CONCURRENCY) {
    const batch = records.slice(offset, offset + REMOVE_CONCURRENCY)
    const results = await Promise.all(
      batch.map(async (record) => {
        const id = String((record && record._id) || "").trim()
        if (!id) {
          return {
            removed: false,
            errorMessage: "匿名事件记录缺少 ID"
          }
        }
        try {
          const res = await db.collection("analytics_events").doc(id).remove()
          const removed = Number(res && res.stats && res.stats.removed) > 0
          return {
            removed,
            errorMessage: removed ? "" : "匿名事件记录未被删除"
          }
        } catch (error) {
          return {
            removed: false,
            errorMessage: normalizeErrorMessage(error)
          }
        }
      })
    )
    deleted += results.filter((item) => item.removed).length
    failed += results.filter((item) => !item.removed).length
    if (!firstErrorMessage) {
      const failedItem = results.find((item) => !item.removed && item.errorMessage)
      firstErrorMessage = failedItem ? failedItem.errorMessage : ""
    }
  }

  return {
    deleted,
    failed,
    firstErrorMessage
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const limit = normalizeLimit(event && event.limit)
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)

  try {
    if (!(await isAdminOpenid(openid))) {
      return createError("FORBIDDEN", "权限不足")
    }

    const oldEventsRes = await db
      .collection("analytics_events")
      .where({
        createdAt: db.command.lt(cutoff)
      })
      .limit(limit)
      .get()
    const records =
      oldEventsRes && Array.isArray(oldEventsRes.data) ? oldEventsRes.data : []
    const result = await removeRecords(records)

    await writeAuditLogBestEffort({
      openid,
      action: "analyticsCleanup",
      retentionDays: RETENTION_DAYS,
      cutoffDate: cutoff.toISOString(),
      processed: records.length,
      deleted: result.deleted,
      failed: result.failed
    })
    if (result.failed > 0) {
      await writeErrorLogBestEffort({
        function: "analyticsCleanup",
        openid,
        stage: "removeRecords",
        retentionDays: RETENTION_DAYS,
        failed: result.failed,
        errorMessage: result.firstErrorMessage || "部分匿名事件删除失败",
        occurredAt: new Date().toISOString()
      })
    }

    return {
      ok: true,
      retentionDays: RETENTION_DAYS,
      cutoffDate: cutoff.toISOString(),
      processed: records.length,
      deleted: result.deleted,
      failed: result.failed,
      hasMore: records.length === limit,
      message: records.length ? "匿名事件清理完成" : "暂无过期匿名事件"
    }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "analyticsCleanup",
      openid,
      stage: "main",
      retentionDays: RETENTION_DAYS,
      limit,
      errorMessage: normalizeErrorMessage(error),
      occurredAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "匿名事件清理失败，请稍后重试")
  }
}
