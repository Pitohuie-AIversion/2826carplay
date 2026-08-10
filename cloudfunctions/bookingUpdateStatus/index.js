const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const BOOKING_STATUS_UPDATE_FIELDS = {
  _id: true,
  openid: true,
  vehicleName: true,
  status: true,
  latestPickupHandoverId: true,
  latestReturnHandoverId: true,
  pickupHandoverConfirmedAt: true,
  returnHandoverConfirmedAt: true
}
const STATUS_TEMPLATE_CONFIG_FIELDS = {
  value: true
}

const CONFIG_KEY = "operation_settings"
const BOOKING_STATUSES = [
  "pending",
  "contacted",
  "quoted",
  "adjustment_requested",
  "confirmed",
  "completed",
  "cancelled"
]
const STATUS_LABELS = {
  pending: "待联系",
  contacted: "已联系",
  quoted: "已报价",
  adjustment_requested: "待调整",
  confirmed: "已确认",
  completed: "已完成",
  cancelled: "已取消"
}
const STATUS_TRANSITIONS = {
  pending: ["contacted", "cancelled"],
  contacted: ["cancelled"],
  quoted: ["cancelled"],
  adjustment_requested: ["cancelled"],
  confirmed: ["completed", "cancelled"],
  completed: [],
  cancelled: []
}

function bookingBlockId(bookingId) {
  const digest = crypto.createHash("sha256").update(String(bookingId || "")).digest("hex").slice(0, 24)
  return `booking_${digest}`
}

async function releaseBookingOccupancy(bookingId, openid, targetStatus) {
  return db.runTransaction(async (transaction) => {
    const dayRes = await transaction.collection("vehicle_calendar_days").where({ bookingId }).limit(91).get()
    const days = dayRes && Array.isArray(dayRes.data) ? dayRes.data : []
    for (const day of days) {
      if (day && day._id) await transaction.collection("vehicle_calendar_days").doc(day._id).remove()
    }
    try {
      await transaction.collection("vehicle_availability_blocks").doc(bookingBlockId(bookingId)).update({ data: {
        status: targetStatus === "completed" ? "completed" : "released",
        releaseReason: targetStatus === "completed" ? "预约已完成" : "运营取消已确认预约",
        releasedBy: openid,
        releasedAt: db.serverDate(),
        updatedAt: db.serverDate()
      } })
    } catch (error) {
      const message = String(error && (error.message || error.errMsg) || error).toLowerCase()
      if (!message.includes("not exist") && !message.includes("not found") && !message.includes("-502005")) throw error
    }
    return days.length
  })
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

  if (record.role === "admin") {
    return true
  }

  if (Array.isArray(record.roles) && record.roles.includes("admin")) {
    return true
  }

  if (record.isAdmin === true || record.admin === true) {
    return true
  }

  return false
}

function hasCapability(record, capability) {
  if (hasAdminRole(record)) {
    return true
  }

  const merged = normalizeStringArray([record && record.role].concat((record && record.roles) || [], (record && record.permissions) || []))
  if (capability === "booking_manage") {
    return merged.includes("booking_manage") || merged.includes("booking_manager")
  }

  return false
}

async function hasOpenidCapability(openid, capability) {
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
  return list.some((item) => hasCapability(item, capability))
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
      function: "bookingUpdateStatus",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
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
  } catch (error) {
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "bookingUpdateStatus",
      stage: "errorLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

function normalizeNotificationText(value, maxLength, fallback) {
  const text = String(value || "").trim() || String(fallback || "")
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function normalizeNotificationError(error) {
  const errorCode = String(
    (error && (error.errCode || error.code)) || ""
  )
    .trim()
    .slice(0, 80)
  const errorMessage = String(
    (error && (error.errMsg || error.message)) || error || "订阅消息发送失败"
  )
    .trim()
    .slice(0, 300)

  return {
    errorCode,
    errorMessage
  }
}

function isNotSubscribedError(error) {
  const normalized = normalizeNotificationError(error)
  const message = normalized.errorMessage.toLowerCase()
  return (
    normalized.errorCode === "43101" ||
    message.includes("user refuse") ||
    message.includes("not subscribe") ||
    message.includes("未订阅") ||
    message.includes("拒绝")
  )
}

function formatNotificationTime(input) {
  const date = input instanceof Date ? input : new Date(input || Date.now())
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date
  const chinaDate = new Date(safeDate.getTime() + 8 * 60 * 60 * 1000)
  const hour = `${chinaDate.getUTCHours()}`.padStart(2, "0")
  const minute = `${chinaDate.getUTCMinutes()}`.padStart(2, "0")
  return `${hour}:${minute}`
}

async function readBookingStatusTemplateId() {
  const envTemplateId = String(process.env.BOOKING_STATUS_TEMPLATE_ID || "").trim()
  if (envTemplateId) {
    return {
      templateId: envTemplateId,
      error: null
    }
  }

  try {
    const res = await db
      .collection("app_configs")
      .where({ key: CONFIG_KEY })
      .field(STATUS_TEMPLATE_CONFIG_FIELDS)
      .limit(1)
      .get()
    const list = res && Array.isArray(res.data) ? res.data : []
    const value = list.length && list[0] && list[0].value ? list[0].value : {}
    return {
      templateId: String(value.bookingStatusTemplateId || "").trim(),
      error: null
    }
  } catch (error) {
    return {
      templateId: "",
      error
    }
  }
}

async function recordNotificationFailure(booking, status, reason, error) {
  const normalized = normalizeNotificationError(error)
  const bookingId = String((booking && (booking._id || booking.id)) || "").trim()

  await writeErrorLogBestEffort({
    function: "bookingUpdateStatus",
    stage: "subscribeMessage",
    bookingId,
    targetStatus: String(status || "").trim(),
    errorCode: normalized.errorCode,
    errorMessage: normalized.errorMessage
  })

  console.warn({
    function: "bookingUpdateStatus",
    stage: "subscribeMessage",
    bookingId,
    targetStatus: status,
    errorCode: normalized.errorCode,
    errorMessage: normalized.errorMessage,
    createdAt: new Date().toISOString()
  })

  return {
    status: "failed",
    reason
  }
}

async function sendStatusNotificationBestEffort(booking, status) {
  const targetOpenid = String((booking && booking.openid) || "").trim()
  if (!targetOpenid) {
    return {
      status: "skipped",
      reason: "missing_target"
    }
  }

  const configResult = await readBookingStatusTemplateId()
  if (configResult.error) {
    return recordNotificationFailure(
      booking,
      status,
      "config_read_failed",
      configResult.error
    )
  }

  const templateId = configResult.templateId
  if (!templateId) {
    return {
      status: "skipped",
      reason: "not_configured"
    }
  }

  const subscribeMessage = cloud.openapi && cloud.openapi.subscribeMessage
  if (!subscribeMessage || typeof subscribeMessage.send !== "function") {
    return recordNotificationFailure(
      booking,
      status,
      "api_unavailable",
      {
        code: "API_UNAVAILABLE",
        message: "订阅消息接口不可用"
      }
    )
  }

  const envState = String(process.env.BOOKING_NOTIFY_STATE || "").trim()
  const miniprogramState = ["developer", "trial", "formal"].includes(envState)
    ? envState
    : "formal"

  try {
    await subscribeMessage.send({
      touser: targetOpenid,
      templateId,
      page: `pages/booking-detail/booking-detail?id=${encodeURIComponent(String(booking._id || booking.id || ""))}`,
      miniprogramState,
      lang: "zh_CN",
      data: {
        thing1: {
          value: normalizeNotificationText(booking.vehicleName, 20, "车辆预约")
        },
        phrase2: {
          value: normalizeNotificationText(STATUS_LABELS[status], 5, "已更新")
        },
        thing3: {
          value: "状态已更新，请进入小程序查看"
        },
        time4: {
          value: formatNotificationTime(new Date())
        }
      }
    })

    return {
      status: "sent",
      reason: ""
    }
  } catch (error) {
    if (isNotSubscribedError(error)) {
      return {
        status: "not_subscribed",
        reason: "user_not_subscribed"
      }
    }

    return recordNotificationFailure(booking, status, "send_failed", error)
  }
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim(),
    status: String(payload.status || "").trim()
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    const allowed = await hasOpenidCapability(openid, "booking_manage")
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!input.id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      })
    }

    if (!BOOKING_STATUSES.includes(input.status)) {
      return createError("VALIDATION_ERROR", "预约状态不合法", {
        errors: [
          { field: "status", message: "预约状态不合法", value: input.status, allowed: BOOKING_STATUSES }
        ]
      })
    }

    const currentRes = await db
      .collection("bookings")
      .doc(input.id)
      .field(BOOKING_STATUS_UPDATE_FIELDS)
      .get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "预约不存在")
    }

    const currentStatus = String(current.status || "pending").trim() || "pending"
    if (input.status === currentStatus) {
      return {
        ok: true,
        id: input.id,
        status: input.status,
        updated: false,
        message: "预约状态未变化"
      }
    }

    const allowedStatuses = STATUS_TRANSITIONS[currentStatus] || []
    if (!allowedStatuses.includes(input.status)) {
      return createError("STATUS_TRANSITION_NOT_ALLOWED", "当前预约状态不允许执行此操作", {
        currentStatus,
        allowedStatuses
      })
    }

    if (
      input.status === "completed" &&
      (!String(current.latestPickupHandoverId || "").trim() ||
        !String(current.latestReturnHandoverId || "").trim() ||
        !current.pickupHandoverConfirmedAt ||
        !current.returnHandoverConfirmedAt)
    ) {
      return createError("HANDOVER_NOT_CONFIRMED", "请先完成取车和还车交接记录，并由用户核对后再结束预约")
    }

    const updateRes = await db.collection("bookings").where({
      _id: input.id,
      status: currentStatus
    }).update({
      data: {
        status: input.status,
        updatedAt: db.serverDate()
      }
    })
    const updatedCount = Number(updateRes && updateRes.stats && updateRes.stats.updated) || 0
    if (updatedCount < 1) {
      return createError("STATUS_CONFLICT", "预约状态已发生变化，请刷新后重试")
    }

    if (currentStatus === "confirmed" && ["completed", "cancelled"].includes(input.status) && typeof db.runTransaction === "function") {
      await releaseBookingOccupancy(input.id, openid, input.status)
    }

    await writeAuditLogBestEffort({
      openid,
      action: "bookingUpdateStatus",
      bookingId: input.id,
      fromStatus: currentStatus,
      toStatus: input.status
    })

    const notificationResult = await sendStatusNotificationBestEffort(current, input.status)

    return {
      ok: true,
      id: input.id,
      status: input.status,
      updated: true,
      notificationStatus: notificationResult.status,
      notificationReason: notificationResult.reason,
      message: "预约状态已更新"
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    await writeErrorLogBestEffort({
      function: "bookingUpdateStatus",
      id: input.id,
      status: input.status,
      authenticated: Boolean(openid),
      errorMessage
    })

    console.error({
      function: "bookingUpdateStatus",
      authenticated: Boolean(openid),
      id: input.id,
      status: input.status,
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "更新预约状态失败，请稍后重试")
  }
}
