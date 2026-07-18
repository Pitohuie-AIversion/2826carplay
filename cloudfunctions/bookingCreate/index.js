const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

function normalizeText(value, maxLen) {
  const text = String(value || "").trim()
  if (!text) {
    return ""
  }

  if (maxLen && text.length > maxLen) {
    return text.slice(0, maxLen)
  }

  return text
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    vehicleId: normalizeText(payload.vehicleId, 64),
    userName: normalizeText(payload.userName, 20),
    phone: normalizeText(payload.phone, 20),
    startDate: normalizeText(payload.startDate, 20),
    endDate: normalizeText(payload.endDate, 20),
    city: normalizeText(payload.city, 20),
    note: normalizeText(payload.note, 200)
  }
}

function validateInput(input) {
  const errors = []

  if (!input.vehicleId) {
    errors.push({ field: "vehicleId", message: "车辆 ID 不能为空" })
  }

  if (!input.userName) {
    errors.push({ field: "userName", message: "姓名不能为空" })
  }

  if (!input.phone) {
    errors.push({ field: "phone", message: "手机号不能为空" })
  } else if (!/^1\d{10}$/.test(input.phone)) {
    errors.push({ field: "phone", message: "手机号格式不正确" })
  }

  if (!input.startDate) {
    errors.push({ field: "startDate", message: "取车日期不能为空" })
  }

  if (!input.endDate) {
    errors.push({ field: "endDate", message: "还车日期不能为空" })
  }

  if (input.startDate && input.endDate && input.endDate < input.startDate) {
    errors.push({ field: "endDate", message: "还车日期不能早于取车日期" })
  }

  if (!input.city) {
    errors.push({ field: "city", message: "城市不能为空" })
  }

  return errors
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
      function: "bookingCreate",
      stage: "errorLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
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
      function: "bookingCreate",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
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

    const vehicleRes = await db.collection("vehicles").doc(input.vehicleId).get()
    const vehicle = vehicleRes && vehicleRes.data ? vehicleRes.data : null
    if (!vehicle) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    if (String(vehicle.status || "").trim() === "retired") {
      return createError("NOT_AVAILABLE", "车辆已停用，暂不可预约")
    }

    const bookingData = {
      openid,
      vehicleId: input.vehicleId,
      vehicleName: normalizeText(vehicle.name || vehicle.plateNumber || "", 50),
      userName: input.userName,
      phone: input.phone,
      startDate: input.startDate,
      endDate: input.endDate,
      city: input.city,
      note: input.note,
      status: "pending",
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    }

    const addRes = await db.collection("bookings").add({
      data: bookingData
    })

    const bookingId = addRes && (addRes._id || addRes.id) ? addRes._id || addRes.id : ""

    await writeAuditLogBestEffort({
      openid,
      action: "bookingCreate",
      bookingId,
      vehicleId: input.vehicleId,
      vehicleName: bookingData.vehicleName,
      startDate: input.startDate,
      endDate: input.endDate,
      city: input.city
    })

    return {
      ok: true,
      id: bookingId,
      message: "预约信息已提交，客服将尽快联系您"
    }
  } catch (error) {
    await writeErrorLogBestEffort({
      function: "bookingCreate",
      openid,
      vehicleId: input.vehicleId,
      input,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : ""
    })

    console.error({
      function: "bookingCreate",
      openid,
      vehicleId: input.vehicleId,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "预约提交失败，请稍后重试")
  }
}
