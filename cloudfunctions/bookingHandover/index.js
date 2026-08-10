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
const STAGES = ["pickup", "return"]
const ANGLES = ["front", "rear", "left", "right"]
const ADMIN_ACTIONS = ["submit", "archive", "cleanupUpload"]
const BOOKING_FIELDS = {
  _id: true,
  openid: true,
  status: true,
  latestPickupHandoverId: true,
  latestPickupHandoverVersion: true,
  latestReturnHandoverId: true,
  latestReturnHandoverVersion: true
}

function error(code, message, details) {
  const result = { ok: false, code, message }
  if (details !== undefined) result.details = details
  return result
}

function text(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength)
}

function strings(value) {
  if (!Array.isArray(value)) return []
  return [...new Set(value.map((item) => String(item || "").trim()).filter(Boolean))]
}

function hasAdminRole(record) {
  return Boolean(record && (
    record.role === "admin" ||
    (Array.isArray(record.roles) && record.roles.includes("admin")) ||
    record.isAdmin === true ||
    record.admin === true
  ))
}

async function canManage(openid) {
  if (!openid) return false
  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  return (res.data || []).some((record) => {
    if (hasAdminRole(record)) return true
    const capabilities = strings([record.role].concat(record.roles || [], record.permissions || []))
    return capabilities.includes("booking_manage") || capabilities.includes("booking_manager")
  })
}

function normalizePhotos(value, bookingId, stage) {
  if (!Array.isArray(value)) return []
  const pathToken = `/handover-images/${bookingId}/${stage}/`
  const photos = value.map((item) => ({
    angle: text(item && item.angle, 20),
    fileId: text(item && (item.fileId || item.fileID), 1024)
  }))
  const angleSet = new Set(photos.map((item) => item.angle))
  const fileSet = new Set(photos.map((item) => item.fileId))
  if (
    photos.length !== ANGLES.length ||
    angleSet.size !== ANGLES.length ||
    fileSet.size !== ANGLES.length ||
    !ANGLES.every((angle) => angleSet.has(angle)) ||
    photos.some((item) => !item.fileId.startsWith("cloud://") || !item.fileId.includes(pathToken) || !/\.(?:jpe?g|png|webp)$/i.test(item.fileId))
  ) return []
  return ANGLES.map((angle) => photos.find((item) => item.angle === angle))
}

function normalizeInput(event) {
  const source = event && typeof event === "object" ? event : {}
  return {
    action: text(source.action, 30),
    bookingId: text(source.bookingId, 128),
    handoverId: text(source.handoverId, 160),
    stage: text(source.stage, 20),
    requestId: text(source.requestId, 80),
    mileageProvided: source.mileageKm !== "" && source.mileageKm !== null && source.mileageKm !== undefined,
    mileageKm: Number(source.mileageKm),
    energyType: text(source.energyType, 20),
    energyLevelProvided: source.energyLevelPercent !== "" && source.energyLevelPercent !== null && source.energyLevelPercent !== undefined,
    energyLevelPercent: Number(source.energyLevelPercent),
    damageNote: text(source.damageNote, 500),
    additionalNote: text(source.additionalNote, 500),
    photos: source.photos,
    fileList: strings(source.fileList).slice(0, 9)
  }
}

function validateSubmit(input) {
  const errors = []
  if (!input.bookingId) errors.push({ field: "bookingId", message: "预约 ID 不能为空" })
  if (!STAGES.includes(input.stage)) errors.push({ field: "stage", message: "交接类型不合法" })
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.requestId)) errors.push({ field: "requestId", message: "请求标识不合法" })
  if (!input.mileageProvided || !Number.isInteger(input.mileageKm) || input.mileageKm < 0 || input.mileageKm > 5000000) errors.push({ field: "mileageKm", message: "里程须为 0 至 5000000 的整数" })
  if (!["fuel", "electric"].includes(input.energyType)) errors.push({ field: "energyType", message: "能源类型不合法" })
  if (!input.energyLevelProvided || !Number.isInteger(input.energyLevelPercent) || input.energyLevelPercent < 0 || input.energyLevelPercent > 100) errors.push({ field: "energyLevelPercent", message: "油量或电量须为 0 至 100 的整数" })
  if (!input.damageNote) errors.push({ field: "damageNote", message: "请填写已知损伤情况；无损伤时请明确填写未发现" })
  const photos = normalizePhotos(input.photos, input.bookingId, input.stage)
  if (!photos.length) errors.push({ field: "photos", message: "请上传前、后、左、右四个角度且不重复的照片" })
  return { errors, photos }
}

function isMissing(errorValue) {
  return /not found|not exist|DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST/i.test(String(errorValue && (errorValue.message || errorValue.errMsg || errorValue.code) || errorValue || ""))
}

async function getDocOrNull(collection, id, fields) {
  try {
    const res = await collection.doc(id).field(fields).get()
    return res && res.data ? res.data : null
  } catch (err) {
    if (isMissing(err)) return null
    throw err
  }
}

async function writeAudit(payload) {
  try {
    await db.collection("audit_logs").add({ data: { ...payload, createdAt: db.serverDate() } })
  } catch (err) {}
}

async function enqueueDeletion(fileList, source, context, delayMs) {
  const files = strings(fileList)
  if (!files.length) return
  await db.collection("pending_file_deletions").add({
    data: {
      fileList: files,
      source,
      context,
      attemptCount: 0,
      notBeforeAt: new Date(Date.now() + Math.max(0, Number(delayMs) || 0)),
      createdAt: db.serverDate()
    }
  })
}

async function submit(input, openid) {
  const validation = validateSubmit(input)
  if (validation.errors.length) return error("VALIDATION_ERROR", "交接记录校验失败", { errors: validation.errors })

  const result = await db.runTransaction(async (transaction) => {
    const booking = await getDocOrNull(transaction.collection("bookings"), input.bookingId, BOOKING_FIELDS)
    if (!booking) return { result: error("NOT_FOUND", "预约不存在") }
    if (booking.status !== "confirmed") return { result: error("STATUS_NOT_ALLOWED", "仅已确认预约可以提交交接记录") }

    const prefix = input.stage === "pickup" ? "Pickup" : "Return"
    const latestId = text(booking[`latest${prefix}HandoverId`], 160)
    const latest = latestId
      ? await getDocOrNull(transaction.collection("booking_handovers"), latestId, { _id: true, submitRequestId: true, status: true, version: true })
      : null
    if (latest && latest.submitRequestId === input.requestId) {
      return { result: { ok: true, action: "submit", duplicate: true, handoverId: latestId, version: Number(latest.version) || 1 } }
    }
    if (input.stage === "return") {
      const pickupId = text(booking.latestPickupHandoverId, 160)
      const pickup = pickupId
        ? await getDocOrNull(transaction.collection("booking_handovers"), pickupId, { status: true })
        : null
      if (!pickup || pickup.status !== "confirmed") return { result: error("PICKUP_NOT_CONFIRMED", "请先由用户核对取车记录") }
    }

    const version = Math.max(Number(booking[`latest${prefix}HandoverVersion`]) || 0, Number(latest && latest.version) || 0) + 1
    const handoverId = `${input.bookingId}__${input.stage}__v${version}`
    if (latest && ["submitted", "confirmed"].includes(latest.status)) {
      await transaction.collection("booking_handovers").doc(latestId).update({ data: {
        status: "superseded", supersededAt: db.serverDate(), supersededByVersion: version, updatedAt: db.serverDate()
      } })
    }
    await transaction.collection("booking_handovers").doc(handoverId).set({ data: {
      bookingId: input.bookingId,
      stage: input.stage,
      version,
      status: "submitted",
      mileageKm: input.mileageKm,
      energyType: input.energyType,
      energyLevelPercent: input.energyLevelPercent,
      damageNote: input.damageNote,
      additionalNote: input.additionalNote,
      photos: validation.photos,
      submitRequestId: input.requestId,
      submittedBy: openid,
      capturedAt: db.serverDate(),
      submittedAt: db.serverDate(),
      createdAt: db.serverDate(),
      updatedAt: db.serverDate()
    } })
    await transaction.collection("bookings").doc(input.bookingId).update({ data: {
      [`latest${prefix}HandoverId`]: handoverId,
      [`latest${prefix}HandoverVersion`]: version,
      [`${input.stage}HandoverSubmittedAt`]: db.serverDate(),
      [`${input.stage}HandoverConfirmedAt`]: null,
      updatedAt: db.serverDate()
    } })
    return { result: { ok: true, action: "submit", duplicate: false, handoverId, version } }
  })
  const response = result && result.result ? result.result : result
  if (response && response.ok && !response.duplicate) await writeAudit({ openid, action: "bookingHandoverSubmit", bookingId: input.bookingId, stage: input.stage, version: response.version, photoCount: ANGLES.length })
  return response
}

async function confirm(input, openid) {
  if (!input.bookingId || !input.handoverId || !STAGES.includes(input.stage)) return error("VALIDATION_ERROR", "交接确认参数不完整")
  const result = await db.runTransaction(async (transaction) => {
    const booking = await getDocOrNull(transaction.collection("bookings"), input.bookingId, BOOKING_FIELDS)
    if (!booking) return { result: error("NOT_FOUND", "预约不存在") }
    if (text(booking.openid, 128) !== openid) return { result: error("FORBIDDEN", "只能核对自己的交接记录") }
    if (!["confirmed", "completed"].includes(booking.status)) return { result: error("STATUS_NOT_ALLOWED", "当前预约不能核对交接记录") }
    const prefix = input.stage === "pickup" ? "Pickup" : "Return"
    if (text(booking[`latest${prefix}HandoverId`], 160) !== input.handoverId) return { result: error("VERSION_CONFLICT", "交接记录已更新，请刷新后核对") }
    const record = await getDocOrNull(transaction.collection("booking_handovers"), input.handoverId, { bookingId: true, stage: true, status: true, version: true })
    if (!record || record.bookingId !== input.bookingId || record.stage !== input.stage) return { result: error("NOT_FOUND", "交接记录不存在") }
    if (record.status === "confirmed") return { result: { ok: true, action: "confirm", duplicate: true, handoverId: input.handoverId, version: Number(record.version) || 1 } }
    if (record.status !== "submitted") return { result: error("STATUS_NOT_ALLOWED", "当前版本不能确认") }
    await transaction.collection("booking_handovers").doc(input.handoverId).update({ data: { status: "confirmed", confirmedBy: openid, confirmedAt: db.serverDate(), updatedAt: db.serverDate() } })
    await transaction.collection("bookings").doc(input.bookingId).update({ data: { [`${input.stage}HandoverConfirmedAt`]: db.serverDate(), updatedAt: db.serverDate() } })
    return { result: { ok: true, action: "confirm", duplicate: false, handoverId: input.handoverId, version: Number(record.version) || 1 } }
  })
  const response = result && result.result ? result.result : result
  if (response && response.ok && !response.duplicate) await writeAudit({ openid, action: "bookingHandoverConfirm", bookingId: input.bookingId, stage: input.stage, version: response.version })
  return response
}

async function archive(input, openid) {
  if (!input.bookingId || !input.handoverId || !STAGES.includes(input.stage)) return error("VALIDATION_ERROR", "归档参数不完整")
  const result = await db.runTransaction(async (transaction) => {
    const booking = await getDocOrNull(transaction.collection("bookings"), input.bookingId, BOOKING_FIELDS)
    if (!booking) return { result: error("NOT_FOUND", "预约不存在") }
    const prefix = input.stage === "pickup" ? "Pickup" : "Return"
    if (text(booking[`latest${prefix}HandoverId`], 160) !== input.handoverId) return { result: error("VERSION_CONFLICT", "只能归档当前交接版本") }
    const record = await getDocOrNull(transaction.collection("booking_handovers"), input.handoverId, { bookingId: true, stage: true, status: true, photos: true, version: true })
    if (!record || record.bookingId !== input.bookingId || record.stage !== input.stage) return { result: error("NOT_FOUND", "交接记录不存在") }
    if (record.status === "archived") return { result: { ok: true, action: "archive", duplicate: true, fileList: [], version: Number(record.version) || 1 } }
    const fileList = (record.photos || []).map((item) => item && item.fileId).filter(Boolean)
    await transaction.collection("booking_handovers").doc(input.handoverId).update({ data: {
      status: "archived", photos: [], archivedPhotoCount: fileList.length, archivedBy: openid, archivedAt: db.serverDate(), updatedAt: db.serverDate()
    } })
    await transaction.collection("bookings").doc(input.bookingId).update({ data: {
      [`${input.stage}HandoverConfirmedAt`]: null,
      updatedAt: db.serverDate()
    } })
    return { result: { ok: true, action: "archive", duplicate: false, fileList, version: Number(record.version) || 1 } }
  })
  const response = result && result.result ? result.result : result
  if (response && response.ok && !response.duplicate) {
    await enqueueDeletion(response.fileList, "bookingHandoverArchive", { bookingId: input.bookingId, handoverId: input.handoverId, stage: input.stage }, 0)
    await writeAudit({ openid, action: "bookingHandoverArchive", bookingId: input.bookingId, stage: input.stage, version: response.version, photoCount: response.fileList.length })
  }
  if (response) delete response.fileList
  return response
}

async function cleanupUpload(input, openid) {
  if (!input.bookingId || !STAGES.includes(input.stage)) return error("VALIDATION_ERROR", "清理参数不完整")
  const validPrefix = `/handover-images/${input.bookingId}/${input.stage}/`
  const fileList = input.fileList.filter((fileId) => fileId.startsWith("cloud://") && fileId.includes(validPrefix))
  if (!fileList.length || fileList.length !== input.fileList.length) return error("VALIDATION_ERROR", "待清理图片路径不合法")
  await enqueueDeletion(fileList, "bookingHandoverUploadCleanup", { bookingId: input.bookingId, stage: input.stage }, 30000)
  await writeAudit({ openid, action: "bookingHandoverUploadCleanup", bookingId: input.bookingId, stage: input.stage, photoCount: fileList.length })
  return { ok: true, action: "cleanupUpload", queued: fileList.length }
}

exports.main = async (event) => {
  const openid = text(cloud.getWXContext() && cloud.getWXContext().OPENID, 128)
  const input = normalizeInput(event)
  try {
    if (!openid) return error("UNAUTHORIZED", "未获取到用户身份")
    if (ADMIN_ACTIONS.includes(input.action)) {
      if (!(await canManage(openid))) return error("FORBIDDEN", "权限不足")
      if (input.action === "submit") return submit(input, openid)
      if (input.action === "archive") return archive(input, openid)
      return cleanupUpload(input, openid)
    }
    if (input.action === "confirm") return confirm(input, openid)
    return error("VALIDATION_ERROR", "交接操作不合法")
  } catch (err) {
    const errorMessage = text(err && (err.message || err.errMsg) || err, 300)
    try { await db.collection("error_logs").add({ data: { function: "bookingHandover", stage: input.action || "main", bookingId: input.bookingId, authenticated: Boolean(openid), errorMessage, createdAt: db.serverDate() } }) } catch (logError) {}
    console.error({ function: "bookingHandover", stage: input.action || "main", bookingId: input.bookingId, authenticated: Boolean(openid), errorMessage })
    return error("INTERNAL_ERROR", "交接记录处理失败，请稍后重试")
  }
}
