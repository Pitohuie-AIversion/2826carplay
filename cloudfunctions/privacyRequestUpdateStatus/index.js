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
const PRIVACY_REQUEST_STATUS_FIELDS = {
  type: true,
  status: true,
  dataExportedAt: true
}
const STATUS_TRANSITIONS = {
  pending: ["processing", "completed", "rejected"],
  processing: ["completed", "rejected"],
  completed: [],
  rejected: []
}

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
  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some(hasAdminRole)
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim(),
    status: String(payload.status || "").trim(),
    resolutionNote: String(payload.resolutionNote || "").trim()
  }
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
      function: "privacyRequestUpdateStatus",
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
    if (!(await isAdminOpenid(openid))) {
      return createError("FORBIDDEN", "权限不足")
    }
    if (!input.id) {
      return createError("VALIDATION_ERROR", "申请 ID 不能为空")
    }
    if (!["processing", "completed", "rejected"].includes(input.status)) {
      return createError("VALIDATION_ERROR", "目标状态不合法")
    }
    if (input.resolutionNote.length > 500) {
      return createError("VALIDATION_ERROR", "处理说明不能超过 500 字")
    }
    if (["completed", "rejected"].includes(input.status) && input.resolutionNote.length < 2) {
      return createError("VALIDATION_ERROR", "完成或驳回申请时，请填写至少 2 字的处理说明")
    }

    const currentRes = await db
      .collection("privacy_requests")
      .doc(input.id)
      .field(PRIVACY_REQUEST_STATUS_FIELDS)
      .get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "隐私申请不存在")
    }

    const currentStatus = String(current.status || "pending")
    if (currentStatus === input.status) {
      return {
        ok: true,
        id: input.id,
        status: currentStatus,
        updated: false,
        message: "申请状态未变化"
      }
    }
    const allowedStatuses = STATUS_TRANSITIONS[currentStatus] || []
    if (!allowedStatuses.includes(input.status)) {
      return createError("STATUS_TRANSITION_NOT_ALLOWED", "当前申请状态不允许执行此操作", {
        currentStatus,
        allowedStatuses
      })
    }
    if (
      String(current.type || "") === "access" &&
      input.status === "completed" &&
      !current.dataExportedAt
    ) {
      return createError(
        "DATA_EXPORT_REQUIRED",
        "请先核验并导出完整个人数据，再完成查询申请"
      )
    }

    const updateRes = await db.collection("privacy_requests").where({
      _id: input.id,
      status: currentStatus
    }).update({
      data: {
        status: input.status,
        resolutionNote: input.resolutionNote,
        updatedAt: db.serverDate(),
        handledBy: openid
      }
    })
    const updatedCount = Number(updateRes && updateRes.stats && updateRes.stats.updated) || 0
    if (updatedCount < 1) {
      return createError("STATUS_CONFLICT", "申请状态已发生变化，请刷新后重试")
    }

    await writeAuditLogBestEffort({
      openid,
      action: "privacyRequestUpdateStatus",
      requestId: input.id,
      requestType: String(current.type || ""),
      fromStatus: currentStatus,
      toStatus: input.status
    })

    return {
      ok: true,
      id: input.id,
      status: input.status,
      updated: true,
      message: "申请状态已更新"
    }
  } catch (error) {
    console.error({
      function: "privacyRequestUpdateStatus",
      authenticated: Boolean(openid),
      requestId: input.id,
      targetStatus: input.status,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "隐私申请更新失败，请稍后重试")
  }
}
