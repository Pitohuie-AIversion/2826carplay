const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const EDITABLE_STATUSES = ["pending", "contacted"]
const EDITABLE_FIELDS = ["userName", "phone", "city", "note"]
const BOOKING_CONTACT_UPDATE_FIELDS = {
  openid: true,
  status: true,
  userName: true,
  phone: true,
  city: true,
  note: true
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

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim(),
    userName: String(payload.userName || "").trim(),
    phone: String(payload.phone || "").trim(),
    city: String(payload.city || "").trim(),
    note: String(payload.note || "").trim()
  }
}

function validateInput(input) {
  const errors = []
  if (!input.id) {
    errors.push({ field: "id", message: "预约 ID 不能为空" })
  }
  if (!input.userName) {
    errors.push({ field: "userName", message: "姓名不能为空" })
  } else if (input.userName.length > 20) {
    errors.push({ field: "userName", message: "姓名不能超过 20 字" })
  }
  if (!input.phone) {
    errors.push({ field: "phone", message: "手机号不能为空" })
  } else if (!/^1\d{10}$/.test(input.phone)) {
    errors.push({ field: "phone", message: "手机号格式不正确" })
  }
  if (!input.city) {
    errors.push({ field: "city", message: "城市不能为空" })
  } else if (input.city.length > 20) {
    errors.push({ field: "city", message: "城市不能超过 20 字" })
  }
  if (input.note.length > 200) {
    errors.push({ field: "note", message: "备注不能超过 200 字" })
  }
  return errors
}

function getChangedKeys(current, input) {
  return EDITABLE_FIELDS.filter((key) => String((current && current[key]) || "").trim() !== input[key])
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
      function: "bookingUpdateMyContact",
      stage: "auditLog",
      errorMessage: message,
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
      function: "bookingUpdateMyContact",
      stage: "errorLog",
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

    const errors = validateInput(input)
    if (errors.length) {
      return createError("VALIDATION_ERROR", "参数校验失败", { errors })
    }

    const currentRes = await db
      .collection("bookings")
      .doc(input.id)
      .field(BOOKING_CONTACT_UPDATE_FIELDS)
      .get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "预约不存在")
    }
    if (String(current.openid || "").trim() !== openid) {
      return createError("FORBIDDEN", "只能修改自己的预约")
    }

    const currentStatus = String(current.status || "pending").trim() || "pending"
    if (!EDITABLE_STATUSES.includes(currentStatus)) {
      return createError("STATUS_NOT_ALLOWED", "已完成或已取消的预约不能修改联系信息")
    }

    const changedKeys = getChangedKeys(current, input)
    if (!changedKeys.length) {
      return {
        ok: true,
        id: input.id,
        status: currentStatus,
        updated: false,
        changedKeys: [],
        message: "联系信息未发生变化"
      }
    }

    const updateRes = await db.collection("bookings").where({
      _id: input.id,
      openid,
      status: currentStatus
    }).update({
      data: {
        userName: input.userName,
        phone: input.phone,
        city: input.city,
        note: input.note,
        updatedAt: db.serverDate()
      }
    })
    const updatedCount = Number(updateRes && updateRes.stats && updateRes.stats.updated) || 0
    if (updatedCount < 1) {
      return createError("STATUS_CONFLICT", "预约状态已发生变化，请刷新后重试")
    }

    await writeAuditLogBestEffort({
      openid,
      action: "bookingUpdateMyContact",
      bookingId: input.id,
      changedKeys
    })

    return {
      ok: true,
      id: input.id,
      status: currentStatus,
      updated: true,
      changedKeys,
      message: "联系信息已更新"
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    await writeErrorLogBestEffort({
      function: "bookingUpdateMyContact",
      bookingId: input.id,
      authenticated: Boolean(openid),
      errorMessage
    })

    console.error({
      function: "bookingUpdateMyContact",
      authenticated: Boolean(openid),
      bookingId: input.id,
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "联系信息更新失败，请稍后重试")
  }
}
