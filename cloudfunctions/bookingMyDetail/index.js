const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const BOOKING_MY_DETAIL_FIELDS = {
  _id: true,
  openid: true,
  vehicleId: true,
  vehicleName: true,
  userName: true,
  phone: true,
  startDate: true,
  endDate: true,
  city: true,
  note: true,
  latestQuoteId: true,
  latestQuoteVersion: true,
  quotedAt: true,
  confirmedAt: true,
  adjustmentRequestedAt: true,
  latestPickupHandoverId: true,
  latestPickupHandoverVersion: true,
  latestReturnHandoverId: true,
  latestReturnHandoverVersion: true,
  pickupHandoverConfirmedAt: true,
  returnHandoverConfirmedAt: true,
  status: true,
  createdAt: true,
  updatedAt: true
}
const BOOKING_MY_QUOTE_FIELDS = {
  _id: true,
  bookingId: true,
  vehicleId: true,
  vehicleName: true,
  startDate: true,
  endDate: true,
  rentalDays: true,
  baseRentalCents: true,
  protectionCents: true,
  serviceFeeCents: true,
  deliveryFeeCents: true,
  otherFeeCents: true,
  totalCents: true,
  depositText: true,
  validUntil: true,
  customerNote: true,
  adjustmentNote: true,
  version: true,
  status: true,
  responseStatus: true,
  sentAt: true,
  confirmedAt: true,
  adjustmentRequestedAt: true,
  expiredAt: true
}
const BOOKING_MY_HANDOVER_FIELDS = {
  _id: true, bookingId: true, stage: true, version: true, status: true,
  mileageKm: true, energyType: true, energyLevelPercent: true,
  damageNote: true, additionalNote: true, photos: true,
  capturedAt: true, submittedAt: true, confirmedAt: true, archivedAt: true, archivedPhotoCount: true
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

function formatTime(input) {
  if (!input) {
    return ""
  }

  if (typeof input === "string") {
    return input
  }

  if (input instanceof Date) {
    return input.toISOString()
  }

  if (typeof input === "object" && typeof input.toDate === "function") {
    return input.toDate().toISOString()
  }

  return ""
}

function buildVehicleDisplayIdentity(value) {
  const vehicleName = String(value || "").trim()
  const normalized = vehicleName.toUpperCase()
  const isPlateNumber = /^[京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][A-HJ-NP-Z0-9]{5,6}$/.test(normalized)
  return isPlateNumber
    ? { vehicleName: "预约车辆", vehicleReference: `车牌尾号 ${normalized.slice(-2)}` }
    : { vehicleName: vehicleName || "预约车辆", vehicleReference: "" }
}

function mapQuote(item) {
  if (!item) return null
  return {
    id: String(item._id || item.id || ""),
    bookingId: String(item.bookingId || ""),
    vehicleId: String(item.vehicleId || ""),
    vehicleName: String(item.vehicleName || ""),
    startDate: String(item.startDate || ""),
    endDate: String(item.endDate || ""),
    rentalDays: Math.max(0, Number(item.rentalDays || 0)),
    baseRentalCents: Math.max(0, Number(item.baseRentalCents || 0)),
    protectionCents: Math.max(0, Number(item.protectionCents || 0)),
    serviceFeeCents: Math.max(0, Number(item.serviceFeeCents || 0)),
    deliveryFeeCents: Math.max(0, Number(item.deliveryFeeCents || 0)),
    otherFeeCents: Math.max(0, Number(item.otherFeeCents || 0)),
    totalCents: Math.max(0, Number(item.totalCents || 0)),
    depositText: String(item.depositText || ""),
    validUntil: String(item.validUntil || ""),
    customerNote: String(item.customerNote || ""),
    adjustmentNote: String(item.adjustmentNote || ""),
    version: Math.max(0, Number(item.version || 0)),
    status: String(item.status || ""),
    responseStatus: String(item.responseStatus || ""),
    sentAt: formatTime(item.sentAt),
    confirmedAt: formatTime(item.confirmedAt),
    adjustmentRequestedAt: formatTime(item.adjustmentRequestedAt),
    expiredAt: formatTime(item.expiredAt)
  }
}

async function readLatestQuote(item) {
  const quoteId = String((item && item.latestQuoteId) || "").trim()
  if (!quoteId) return null
  try {
    const res = await db.collection("booking_quotes").doc(quoteId).field(BOOKING_MY_QUOTE_FIELDS).get()
    const quote = res && res.data ? res.data : null
    if (!quote || String(quote.bookingId || "") !== String(item._id || item.id || "")) return null
    return mapQuote(quote)
  } catch (error) {
    const message = String(error && (error.message || error.errMsg) || error)
    if (message.includes("Unexpected collection:") || message.includes("not exist") || message.includes("not found")) return null
    throw error
  }
}

async function mapHandover(item) {
  if (!item) return null
  const photos = Array.isArray(item.photos) ? item.photos : []
  const urlMap = new Map()
  if (photos.length && typeof cloud.getTempFileURL === "function") {
    try {
      const res = await cloud.getTempFileURL({ fileList: photos.map((photo) => photo.fileId).filter(Boolean) })
      ;(res && res.fileList || []).forEach((entry) => {
        const fileId = String(entry && (entry.fileID || entry.fileId) || "")
        if (fileId && entry.tempFileURL && Number(entry.status || 0) === 0) urlMap.set(fileId, entry.tempFileURL)
      })
    } catch (error) {}
  }
  return {
    id: String(item._id || item.id || ""),
    bookingId: String(item.bookingId || ""),
    stage: String(item.stage || ""),
    version: Math.max(0, Number(item.version || 0)),
    status: String(item.status || ""),
    mileageKm: Math.max(0, Number(item.mileageKm || 0)),
    energyType: String(item.energyType || ""),
    energyLevelPercent: Math.max(0, Number(item.energyLevelPercent || 0)),
    damageNote: String(item.damageNote || ""),
    additionalNote: String(item.additionalNote || ""),
    photos: photos.map((photo) => ({ angle: String(photo.angle || ""), url: urlMap.get(String(photo.fileId || "")) || "" })),
    capturedAt: formatTime(item.capturedAt),
    submittedAt: formatTime(item.submittedAt),
    confirmedAt: formatTime(item.confirmedAt),
    archivedAt: formatTime(item.archivedAt),
    archivedPhotoCount: Math.max(0, Number(item.archivedPhotoCount || 0))
  }
}

async function readLatestHandovers(item) {
  const bookingId = String(item && (item._id || item.id) || "")
  const pairs = [
    ["pickup", String(item && item.latestPickupHandoverId || "")],
    ["return", String(item && item.latestReturnHandoverId || "")]
  ]
  const result = { pickup: null, return: null }
  await Promise.all(pairs.map(async ([stage, id]) => {
    if (!id) return
    try {
      const res = await db.collection("booking_handovers").doc(id).field(BOOKING_MY_HANDOVER_FIELDS).get()
      const record = res && res.data
      if (record && String(record.bookingId || "") === bookingId && String(record.stage || "") === stage) result[stage] = await mapHandover(record)
    } catch (error) {
      const message = String(error && (error.message || error.errMsg) || error)
      if (!message.includes("Unexpected collection:") && !message.includes("not exist") && !message.includes("not found")) throw error
    }
  }))
  return result
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
      function: "bookingMyDetail",
      stage: "errorLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const id = String((event && event.id) || "").trim()

  try {
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }

    if (!id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      })
    }

    const res = await db.collection("bookings").doc(id).field(BOOKING_MY_DETAIL_FIELDS).get()
    const item = res && res.data ? res.data : null
    if (!item) {
      return createError("NOT_FOUND", "预约不存在")
    }

    if (String(item.openid || "").trim() !== openid) {
      return createError("FORBIDDEN", "只能查看自己的预约")
    }

    const vehicleIdentity = buildVehicleDisplayIdentity(item.vehicleName)
    const latestQuote = await readLatestQuote(item)
    const handovers = await readLatestHandovers(item)

    return {
      ok: true,
      detail: {
        id: item._id || item.id || "",
        vehicleId: item.vehicleId || "",
        ...vehicleIdentity,
        userName: item.userName || "",
        phone: item.phone || "",
        startDate: item.startDate || "",
        endDate: item.endDate || "",
        city: item.city || "",
        note: item.note || "",
        latestQuoteId: item.latestQuoteId || "",
        latestQuoteVersion: Math.max(0, Number(item.latestQuoteVersion || 0)),
        quotedAt: formatTime(item.quotedAt),
        confirmedAt: formatTime(item.confirmedAt),
        adjustmentRequestedAt: formatTime(item.adjustmentRequestedAt),
        latestPickupHandoverId: item.latestPickupHandoverId || "",
        latestPickupHandoverVersion: Math.max(0, Number(item.latestPickupHandoverVersion || 0)),
        latestReturnHandoverId: item.latestReturnHandoverId || "",
        latestReturnHandoverVersion: Math.max(0, Number(item.latestReturnHandoverVersion || 0)),
        pickupHandoverConfirmedAt: formatTime(item.pickupHandoverConfirmedAt),
        returnHandoverConfirmedAt: formatTime(item.returnHandoverConfirmedAt),
        status: item.status || "pending",
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      },
      latestQuote,
      handovers
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    console.error({
      function: "bookingMyDetail",
      authenticated: Boolean(openid),
      id,
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    await writeErrorLogBestEffort({
      function: "bookingMyDetail",
      bookingId: id,
      stage: "main",
      authenticated: Boolean(openid),
      errorMessage,
      occurredAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询预约详情失败，请稍后重试")
  }
}
