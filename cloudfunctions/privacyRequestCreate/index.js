const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const REQUEST_TYPES = ["access", "correction", "deletion"]
const ACTIVE_STATUSES = ["pending", "processing"]
const MIN_DESCRIPTION_LENGTH = 2
const MAX_DESCRIPTION_LENGTH = 500
const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/
const PRIVACY_REQUEST_CONFLICT_FIELDS = {
  _id: true,
  type: true,
  status: true,
  createdAt: true
}
const SUBMISSION_REQUEST_FIELDS = { openid: true, type: true, status: true, submissionFingerprint: true }
const SUBMISSION_GUARD_FIELDS = { requestByType: true, lastCreatedAtMs: true }

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
    description: String(payload.description || "").trim(),
    requestId: String(payload.requestId || "").trim()
  }
}

function submissionFingerprint(input) {
  return crypto.createHash("sha256").update(JSON.stringify([input.type, input.description])).digest("hex")
}

async function findConflictingRequest(openid, type) {
  const res = await db.collection("privacy_requests")
    .where({ openid, type, status: db.command.in(ACTIVE_STATUSES) })
    .field(PRIVACY_REQUEST_CONFLICT_FIELDS).limit(1).get()
  const active = res && Array.isArray(res.data) ? res.data[0] : null
  if (active) {
    return {
      code: "ACTIVE_REQUEST_EXISTS",
      message: "同类型申请正在处理中，请勿重复提交",
      requestId: active._id || ""
    }
  }

  const recent = await db.collection("privacy_requests")
    .where({ openid, createdAt: db.command.gte(new Date(Date.now() - 60000)) })
    .field(PRIVACY_REQUEST_CONFLICT_FIELDS).limit(1).get()
  if (recent && Array.isArray(recent.data) && recent.data.length) {
    return {
      code: "RATE_LIMITED",
      message: "提交过于频繁，请稍后再试"
    }
  }

  return null
}

function documentId(openid, requestId) {
  return `privacy_${crypto.createHash("sha256").update(`${openid}:${requestId}`).digest("hex").slice(0, 40)}`
}

async function readDocument(database, id, fields = SUBMISSION_REQUEST_FIELDS) {
  try {
    const result = await database.collection("privacy_requests").doc(id).field(fields).get()
    return result && result.data || null
  } catch (error) {
    const message = String(error && (error.errMsg || error.message || error.code) || error)
    if (/not found|not exist|DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST|-502005/i.test(message)) return null
    throw error
  }
}

function duplicateResult(record, id, openid, input) {
  if (!record) return null
  if (record.openid !== openid || record.type !== input.type || record.submissionFingerprint !== submissionFingerprint(input)) {
    return createError("IDEMPOTENCY_CONFLICT", "提交内容已变化，请重新提交")
  }
  return { ok: true, id, status: record.status || "pending", duplicate: true, message: "隐私申请已提交" }
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
    if (input.requestId && !REQUEST_ID_PATTERN.test(input.requestId)) {
      return createError("VALIDATION_ERROR", "提交请求标识不合法")
    }

    if (
      input.description.length < MIN_DESCRIPTION_LENGTH ||
      input.description.length > MAX_DESCRIPTION_LENGTH
    ) {
      return createError("VALIDATION_ERROR", "请填写 2 至 500 字的申请说明", {
        errors: [{ field: "description", message: "申请说明长度应为 2 至 500 字" }]
      })
    }

    const requestKey = input.requestId || crypto.randomBytes(16).toString("hex")
    const requestId = documentId(openid, requestKey)
    if (input.requestId) {
      const duplicate = duplicateResult(await readDocument(db, requestId), requestId, openid, input)
      if (duplicate) return duplicate
    }
    const conflict = await findConflictingRequest(openid, input.type)
    if (conflict) {
      if (input.requestId) {
        const duplicate = duplicateResult(await readDocument(db, requestId), requestId, openid, input)
        if (duplicate) return duplicate
      }
      return createError(conflict.code, conflict.message, conflict.requestId ? { requestId: conflict.requestId } : undefined)
    }

    const guardId = `submission_${crypto.createHash("sha256").update(openid).digest("hex").slice(0, 40)}`
    const outcome = await db.runTransaction(async (transaction) => {
      const duplicate = duplicateResult(await readDocument(transaction, requestId), requestId, openid, input)
      if (duplicate) return duplicate
      const guard = await readDocument(transaction, guardId, SUBMISSION_GUARD_FIELDS)
      const requestByType = guard && guard.requestByType || {}
      const latestId = requestByType[input.type]
      const latest = latestId ? await readDocument(transaction, latestId) : null
      if (latest && ACTIVE_STATUSES.includes(latest.status)) {
        return createError("ACTIVE_REQUEST_EXISTS", "同类型申请正在处理中，请勿重复提交", { requestId: latestId })
      }
      if (guard && Date.now() - Number(guard.lastCreatedAtMs || 0) < 60000) {
        return createError("RATE_LIMITED", "提交过于频繁，请稍后再试")
      }
      await transaction.collection("privacy_requests").doc(requestId).set({ data: {
        openid,
        type: input.type,
        description: input.description,
        submissionFingerprint: submissionFingerprint(input),
        status: "pending",
        resolutionNote: "",
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      } })
      await transaction.collection("privacy_requests").doc(guardId).set({ data: {
        recordKind: "submission_guard",
        requestByType: { ...requestByType, [input.type]: requestId },
        lastCreatedAtMs: Date.now()
      } })
      return null
    })
    if (outcome) return outcome

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
      authenticated: Boolean(openid),
      requestType: input.type,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "隐私申请提交失败，请稍后重试")
  }
}
