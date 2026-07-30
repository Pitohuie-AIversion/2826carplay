const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const REQUEST_TYPES = ["access", "correction", "deletion"]
const ACTIVE_STATUSES = ["pending", "processing"]
const MIN_DESCRIPTION_LENGTH = 2
const MAX_DESCRIPTION_LENGTH = 500
const DUPLICATE_SCAN_LIMIT = 100

function createError(code, message, details) {
  const result = {
    ok: false,
    code: String(code || "VALIDATION_ERROR"),
    message: String(message || "参数校验失败")
  }

  if (details !== undefined) {
    result.details = details
  }

  return result
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    type: String(payload.type || "").trim(),
    description: String(payload.description || "").trim()
  }
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

async function findConflictingRequest(openid, type) {
  const res = await db
    .collection("privacy_requests")
    .where({ openid })
    .limit(DUPLICATE_SCAN_LIMIT)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []

  const active = list.find(
    (item) => String(item.type || "") === type && ACTIVE_STATUSES.includes(String(item.status || "pending"))
  )
  if (active) {
    return {
      code: "ACTIVE_REQUEST_EXISTS",
      message: "同类型申请正在处理中，请勿重复提交",
      requestId: active._id || ""
    }
  }

  const latestTimestamp = list.reduce((latest, item) => Math.max(latest, toTimestamp(item.createdAt)), 0)
  if (latestTimestamp && Date.now() - latestTimestamp < 60 * 1000) {
    return {
      code: "RATE_LIMITED",
      message: "提交过于频繁，请稍后再试"
    }
  }

  return null
}

async function writeAuditLogBestEffort(payload) {
  try {
    await db.collection("audit_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "privacyRequestCreate",
      stage: "auditLog",
      errorMessage: message,
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }

    if (!REQUEST_TYPES.includes(input.type)) {
      return createError("VALIDATION_ERROR", "请选择有效的申请类型", {
        errors: [{ field: "type", message: "仅支持 access/correction/deletion" }]
      })
    }

    if (
      input.description.length < MIN_DESCRIPTION_LENGTH ||
      input.description.length > MAX_DESCRIPTION_LENGTH
    ) {
      return createError("VALIDATION_ERROR", "请填写 2 至 500 字的申请说明", {
        errors: [{ field: "description", message: "申请说明长度应为 2 至 500 字" }]
      })
    }

    const conflict = await findConflictingRequest(openid, input.type)
    if (conflict) {
      return createError(conflict.code, conflict.message, conflict.requestId ? { requestId: conflict.requestId } : undefined)
    }

    const addRes = await db.collection("privacy_requests").add({
      data: {
        openid,
        type: input.type,
        description: input.description,
        status: "pending",
        resolutionNote: "",
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
    })
    const requestId = addRes && addRes._id ? addRes._id : ""

    await writeAuditLogBestEffort({
      openid,
      action: "privacyRequestCreate",
      requestId,
      requestType: input.type
    })

    return {
      ok: true,
      id: requestId,
      status: "pending",
      message: "隐私申请已提交"
    }
  } catch (error) {
    console.error({
      function: "privacyRequestCreate",
      openid,
      requestType: input.type,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "隐私申请提交失败，请稍后重试")
  }
}
