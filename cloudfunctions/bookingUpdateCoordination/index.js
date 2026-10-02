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
const BOOKING_COORDINATION_FIELDS = {
  status: true,
  schedulePriority: true,
  coordinationStatus: true,
  tags: true
}
const CUSTOMER_TAGS = ["老客户", "高意向", "需要送车", "长租意向", "车损敏感", "跨城用车", "待二次回访"]
const PRIORITY_VALUES = ["priority", "normal", "standby"]
const COORDINATION_VALUES = ["pending", "coordinating", "resolved"]
const EDITABLE_BOOKING_STATUSES = [
  "pending",
  "contacted",
  "quoted",
  "adjustment_requested",
  "confirmed"
]

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
function normalizeStringArray(value) {
  if (!Array.isArray(value)) {
    return []
  }
  return value.map((item) => String(item || "").trim()).filter(Boolean)
}

function hasAccess(record) {
  if (!record || typeof record !== "object") {
    return false
  }
  if (
    record.role === "admin" ||
    record.isAdmin === true ||
    record.admin === true ||
    (Array.isArray(record.roles) && record.roles.includes("admin"))
  ) {
    return true
  }
  const values = normalizeStringArray(
    [record.role].concat(record.roles || [], record.permissions || [])
  )
  return values.includes("booking_manage") || values.includes("booking_manager")
}

async function canManage(openid) {
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
  return list.some(hasAccess)
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim(),
    priorityProvided: Object.prototype.hasOwnProperty.call(payload, "schedulePriority"),
    coordinationProvided: Object.prototype.hasOwnProperty.call(payload, "coordinationStatus"),
    tagsProvided: Object.prototype.hasOwnProperty.call(payload, "tags"),
    tags: payload.tags,
    expectedValues: payload.expectedValues && typeof payload.expectedValues === "object" ? payload.expectedValues : {},
    schedulePriority: String(payload.schedulePriority || "").trim(),
    coordinationStatus: String(payload.coordinationStatus || "").trim()
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
    if (!String(message).includes("Unexpected collection:")) {
      console.error({
        function: "bookingUpdateCoordination",
        stage: "auditLog",
        errorMessage: message,
        createdAt: new Date().toISOString()
      })
    }
  }
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
  const input = normalizeEvent(event)

  try {
    if (!(await canManage(openid))) {
      return createError("FORBIDDEN", "权限不足")
    }
    if (!input.id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      })
    }
    if (!input.priorityProvided && !input.coordinationProvided && !input.tagsProvided) {
      return createError("VALIDATION_ERROR", "请提供要修改的安排")
    }
    if (input.tagsProvided && (!Array.isArray(input.tags) || input.tags.length > 5 || input.tags.some((tag) => !CUSTOMER_TAGS.includes(tag)))) {
      return createError("VALIDATION_ERROR", "客户标签不合法")
    }
    if (input.tagsProvided) input.tags = [...new Set(input.tags)]
    if (input.priorityProvided && !PRIORITY_VALUES.includes(input.schedulePriority)) {
      return createError("VALIDATION_ERROR", "优先级不正确", {
        errors: [{ field: "schedulePriority", message: "请选择有效的预约优先级" }]
      })
    }
    if (input.coordinationProvided && !COORDINATION_VALUES.includes(input.coordinationStatus)) {
      return createError("VALIDATION_ERROR", "协调状态不正确", {
        errors: [{ field: "coordinationStatus", message: "请选择有效的协调状态" }]
      })
    }

    const outcome = await db.runTransaction(async (transaction) => {
    const bookingRef = transaction.collection("bookings").doc(input.id)
    const currentRes = await bookingRef.field(BOOKING_COORDINATION_FIELDS).get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "预约不存在")
    }

    const bookingStatus = String(current.status || "pending").trim() || "pending"
    if (!EDITABLE_BOOKING_STATUSES.includes(bookingStatus)) {
      return createError("BOOKING_NOT_EDITABLE", "已结束的预约不能修改协调安排")
    }

    const fromPriority = PRIORITY_VALUES.includes(current.schedulePriority)
      ? current.schedulePriority
      : "normal"
    const fromCoordinationStatus = COORDINATION_VALUES.includes(current.coordinationStatus)
      ? current.coordinationStatus
      : "pending"
    const previous = { schedulePriority: fromPriority, coordinationStatus: fromCoordinationStatus }
    for (const field of ["schedulePriority", "coordinationStatus"]) {
      const provided = field === "schedulePriority" ? input.priorityProvided : input.coordinationProvided
      if (provided && Object.prototype.hasOwnProperty.call(input.expectedValues, field) &&
          previous[field] !== input.expectedValues[field] && previous[field] !== input[field]) {
        return createError("VERSION_CONFLICT", "协调安排已更新，请刷新")
      }
    }
    if (!input.priorityProvided) input.schedulePriority = fromPriority
    if (!input.coordinationProvided) input.coordinationStatus = fromCoordinationStatus
    const tagsChanged = input.tagsProvided && (!Array.isArray(current.tags) || JSON.stringify(current.tags) !== JSON.stringify(input.tags))

    if (
      fromPriority === input.schedulePriority &&
      fromCoordinationStatus === input.coordinationStatus &&
      !tagsChanged
    ) {
      return {
        ok: true,
        id: input.id,
        schedulePriority: fromPriority,
        coordinationStatus: fromCoordinationStatus,
        changed: false,
        ...(input.tagsProvided ? { tags: input.tags } : {}),
        message: "协调安排未发生变化"
      }
    }

    await bookingRef.update({
      data: {
        ...(input.priorityProvided ? { schedulePriority: input.schedulePriority } : {}),
        ...(input.coordinationProvided ? { coordinationStatus: input.coordinationStatus } : {}),
        ...(input.tagsProvided ? { tags: input.tags } : {}),
        coordinationUpdatedAt: db.serverDate(),
        coordinationUpdatedBy: openid,
        updatedAt: db.serverDate()
      }
    })

    const audit = {
      openid,
      action: "bookingUpdateCoordination",
      bookingId: input.id,
      fromPriority,
      toPriority: input.schedulePriority,
      fromCoordinationStatus,
      toCoordinationStatus: input.coordinationStatus,
      ...(input.tagsProvided ? { tagsChanged, tagCount: input.tags.length } : {})
    }

    return {
      ok: true,
      id: input.id,
      schedulePriority: input.schedulePriority,
      coordinationStatus: input.coordinationStatus,
      changed: true,
      audit,
      ...(input.tagsProvided ? { tags: input.tags } : {}),
      message: "协调安排已更新"
    }
    })
    if (outcome.audit) {
      await writeAuditLogBestEffort(outcome.audit)
      delete outcome.audit
    }
    return outcome
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    await writeErrorLogBestEffort({
      function: "bookingUpdateCoordination",
      bookingId: input.id,
      stage: "main",
      authenticated: Boolean(openid),
      errorMessage,
      occurredAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "协调安排更新失败，请稍后重试")
  }
}
