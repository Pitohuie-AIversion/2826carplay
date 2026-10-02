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
    note: String(payload.note || "").trim(),
    expectedValues: payload.expectedValues
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

function contactResult(current) {
  return Object.fromEntries(EDITABLE_FIELDS.concat(["pickupLocation", "returnLocation", "location"])
    .map((key) => [key, String(current[key] || "").trim()]))
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
      return createError("STATUS_NOT_ALLOWED", "当前预约状态不能修改联系信息")
    }

    const outcome = await db.runTransaction(async (transaction) => {
      const ref = transaction.collection("bookings").doc(input.id)
      const res = await ref.get()
      const latest = res && res.data
      if (!latest) return { error: createError("NOT_FOUND", "预约不存在") }
      if (String(latest.openid || "").trim() !== openid) return { error: createError("FORBIDDEN", "只能修改自己的预约") }
      const status = String(latest.status || "pending").trim() || "pending"
      if (!EDITABLE_STATUSES.includes(status)) return { error: createError("STATUS_CONFLICT", "预约状态已发生变化，请刷新后重试") }
      const changedKeys = getChangedKeys(latest, input)
      if (!changedKeys.length) return { status, updated: false, changedKeys, contact: contactResult(latest) }
      const baseline = input.expectedValues
      if (!baseline || EDITABLE_FIELDS.some((key) => typeof baseline[key] !== "string")) {
        return { error: createError("CONTACT_VERSION_REQUIRED", "请更新小程序并重新加载预约后修改；当前草稿已保留") }
      }
      if (EDITABLE_FIELDS.some((key) => String(latest[key] || "").trim() !== baseline[key].trim())) {
        return { error: createError("CONTACT_CONFLICT", "联系信息已被修改，当前草稿已保留；请先记录草稿，再取消编辑并下拉刷新核对") }
      }
      const data = {
        userName: input.userName,
        phone: input.phone,
        city: input.city,
        ...(String(latest.city || "").trim().replace(/市$/, "") !== input.city.replace(/市$/, "")
          ? { pickupLocation: "", location: "" }
          : {}),
        note: input.note,
        updatedAt: db.serverDate()
      }
      await ref.update({ data })
      return { status, updated: true, changedKeys, contact: contactResult({ ...latest, ...data }) }
    })
    if (outcome.error) return outcome.error

    if (outcome.updated) await writeAuditLogBestEffort({
      openid,
      action: "bookingUpdateMyContact",
      bookingId: input.id,
      changedKeys: outcome.changedKeys
    })

    return {
      ok: true,
      id: input.id,
      ...outcome,
      message: outcome.updated ? "联系信息已更新" : "联系信息未发生变化"
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
