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
const VEHICLE_IMAGE_FIELDS = {
  imageList: true,
  coverImage: true
}
const MAX_IMAGE_COUNT = 9
const MAX_FILE_ID_LENGTH = 1024
const ORPHAN_CLEANUP_GRACE_MS = 30 * 1000
const MIN_VALID_UPLOAD_TIMESTAMP = Date.UTC(2020, 0, 1)
const MAX_UPLOAD_CLOCK_SKEW_MS = 5 * 60 * 1000
const ALLOWED_ACTIONS = ["add", "remove", "setCover", "cleanupUpload"]

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

function normalizeStringArray(input) {
  if (!Array.isArray(input)) {
    return []
  }

  const result = []
  input.forEach((item) => {
    const value = String(item || "").trim()
    if (value && !result.includes(value)) {
      result.push(value)
    }
  })
  return result
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
  if (capability === "vehicle_manage") {
    return merged.includes("vehicle_manage") || merged.includes("vehicle_manager")
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

function buildImageState(vehicle) {
  const imageList = normalizeStringArray(vehicle && vehicle.imageList)
  const rawCover = String((vehicle && vehicle.coverImage) || "").trim()
  const coverImage = rawCover && imageList.includes(rawCover) ? rawCover : imageList[0] || ""

  return {
    imageList,
    coverImage
  }
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || "").trim(),
    action: String(payload.action || "").trim(),
    fileId: String(payload.fileId || "").trim(),
    fileIds: normalizeStringArray(payload.fileIds)
  }
}

function isCurrentVehicleImageFileId(fileId, vehicleId) {
  const value = String(fileId || "").trim()
  const id = String(vehicleId || "").trim()
  return (
    Boolean(value) &&
    value.length <= MAX_FILE_ID_LENGTH &&
    value.startsWith("cloud://") &&
    value.includes(`/vehicle-images/${id}/`)
  )
}

function normalizeDeletionContext(context) {
  const input = context && typeof context === "object" ? context : {}
  return {
    vehicleId: String(input.vehicleId || input.id || "").trim().slice(0, 128),
    action: String(input.action || "removeImage").trim().slice(0, 32)
  }
}

function getSafeErrorCode(error) {
  return String((error && (error.code || error.errCode)) || "").trim().slice(0, 64)
}

async function deleteFilesBestEffort(fileList, context) {
  const list = normalizeStringArray(fileList)
  if (!list.length) {
    return
  }
  const safeContext = normalizeDeletionContext(context)

  try {
    await cloud.deleteFile({ fileList: list })
  } catch (error) {
    console.error({
      function: "vehicleImageUpdate",
      stage: "deleteFile",
      fileCount: list.length,
      context: safeContext,
      errorCode: getSafeErrorCode(error),
      createdAt: new Date().toISOString()
    })

    try {
      await db.collection("pending_file_deletions").add({
        data: {
          fileList: list,
          context: safeContext,
          source: "vehicleImageUpdate",
          createdAt: db.serverDate()
        }
      })
    } catch (queueError) {}
  }
}

async function queueUploadedFilesForCleanup(fileList, vehicleId) {
  const list = normalizeStringArray(fileList)
  if (!list.length) {
    return 0
  }
  const normalizedVehicleId = String(vehicleId || "").trim().slice(0, 128)

  await Promise.all(list.map((fileId) => {
    const digest = crypto
      .createHash("sha256")
      .update(`${normalizedVehicleId}|${fileId}`)
      .digest("hex")
      .slice(0, 32)
    return db
      .collection("pending_file_deletions")
      .doc(`pending_image_cleanup_${digest}`)
      .set({
        data: {
          fileList: [fileId],
          context: {
            vehicleId: normalizedVehicleId,
            action: "cleanupUpload"
          },
          source: "vehicleImageUploadCleanup",
          notBeforeAt: new Date(
            resolveUploadTimestamp(fileId) + ORPHAN_CLEANUP_GRACE_MS
          ),
          createdAt: db.serverDate()
        }
      })
  }))
  return list.length
}

function resolveUploadTimestamp(fileId) {
  const match = String(fileId || "").match(/\/(\d{13})_\d+\.[^/?]+(?:\?|$)/)
  const timestamp = match ? Number(match[1]) : 0
  const now = Date.now()
  return Number.isFinite(timestamp) &&
    timestamp >= MIN_VALID_UPLOAD_TIMESTAMP &&
    timestamp <= now + MAX_UPLOAD_CLOCK_SKEW_MS
    ? timestamp
    : now
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
      function: "vehicleImageUpdate",
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
      function: "vehicleImageUpdate",
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
  const input = normalizeEvent(event)

  try {
    const allowed = await hasOpenidCapability(openid, "vehicle_manage")
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!input.id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "车辆 ID 不能为空" }]
      })
    }

    if (!ALLOWED_ACTIONS.includes(input.action)) {
      return createError("VALIDATION_ERROR", "图片操作类型不合法", {
        errors: [{ field: "action", message: "仅支持 add/remove/setCover/cleanupUpload" }]
      })
    }

    if (input.fileId.length > MAX_FILE_ID_LENGTH || input.fileIds.some((fileId) => fileId.length > MAX_FILE_ID_LENGTH)) {
      return createError("VALIDATION_ERROR", "图片文件 ID 过长", {
        errors: [{ field: "fileId", message: `图片文件 ID 不能超过 ${MAX_FILE_ID_LENGTH} 个字符` }]
      })
    }

    if (input.action === "cleanupUpload") {
      if (!input.fileIds.length || input.fileIds.length > MAX_IMAGE_COUNT) {
        return createError("VALIDATION_ERROR", "待清理图片数量不合法", {
          errors: [{ field: "fileIds", message: `每次只能清理 1 至 ${MAX_IMAGE_COUNT} 张图片` }]
        })
      }

      const invalidFileIds = input.fileIds.filter(
        (fileId) => !isCurrentVehicleImageFileId(fileId, input.id)
      )
      if (invalidFileIds.length) {
        return createError("VALIDATION_ERROR", "图片不属于当前车辆目录", {
          errors: [{ field: "fileIds", message: "只能清理当前车辆目录下的云图片" }]
        })
      }

      const queuedCount = await queueUploadedFilesForCleanup(input.fileIds, input.id)
      await writeAuditLogBestEffort({
        openid,
        action: "vehicleImageUpdate",
        vehicleId: input.id,
        imageAction: input.action,
        fileIdsCount: input.fileIds.length
      })

      return {
        ok: true,
        id: input.id,
        action: input.action,
        requestedCount: input.fileIds.length,
        queuedCount,
        message: "已提交未入库图片核验清理"
      }
    }

    const currentRes = await db
      .collection("vehicles")
      .doc(input.id)
      .field(VEHICLE_IMAGE_FIELDS)
      .get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    const state = buildImageState(current)
    let nextImageList = state.imageList.slice()
    let nextCoverImage = state.coverImage
    const shouldDeleteFile = input.action === "remove" && input.fileId && state.imageList.includes(input.fileId)

    if (input.action === "add") {
      if (!input.fileIds.length) {
        return createError("VALIDATION_ERROR", "未提供待上传图片", {
          errors: [{ field: "fileIds", message: "至少上传一张图片" }]
        })
      }

      const invalidFileIds = input.fileIds.filter(
        (fileId) => !isCurrentVehicleImageFileId(fileId, input.id)
      )
      if (invalidFileIds.length) {
        return createError("VALIDATION_ERROR", "图片不属于当前车辆目录", {
          errors: [{ field: "fileIds", message: "只能添加当前车辆目录下的云图片" }]
        })
      }

      input.fileIds.forEach((fileId) => {
        if (!nextImageList.includes(fileId)) {
          nextImageList.push(fileId)
        }
      })

      if (nextImageList.length > MAX_IMAGE_COUNT) {
        return createError("VALIDATION_ERROR", `最多只能上传 ${MAX_IMAGE_COUNT} 张图片`, {
          errors: [{ field: "fileIds", message: `图片数量不能超过 ${MAX_IMAGE_COUNT} 张` }]
        })
      }

      if (!nextCoverImage) {
        nextCoverImage = nextImageList[0] || ""
      }
    }

    if (input.action === "remove") {
      if (!input.fileId) {
        return createError("VALIDATION_ERROR", "未提供待删除图片", {
          errors: [{ field: "fileId", message: "图片文件 ID 不能为空" }]
        })
      }

      nextImageList = nextImageList.filter((fileId) => fileId !== input.fileId)
      if (nextCoverImage === input.fileId) {
        nextCoverImage = nextImageList[0] || ""
      }
    }

    if (input.action === "setCover") {
      if (!input.fileId) {
        return createError("VALIDATION_ERROR", "未提供封面图片", {
          errors: [{ field: "fileId", message: "封面文件 ID 不能为空" }]
        })
      }

      if (!nextImageList.includes(input.fileId)) {
        return createError("VALIDATION_ERROR", "封面图片不在当前图片列表中", {
          errors: [{ field: "fileId", message: "请先上传该图片后再设为封面" }]
        })
      }

      nextCoverImage = input.fileId
    }

    await db.collection("vehicles").doc(input.id).update({
      data: {
        imageList: nextImageList,
        coverImage: nextCoverImage,
        updatedAt: db.serverDate()
      }
    })

    if (shouldDeleteFile) {
      await deleteFilesBestEffort([input.fileId], {
        vehicleId: input.id,
        action: input.action
      })
    }

    await writeAuditLogBestEffort({
      openid,
      action: "vehicleImageUpdate",
      vehicleId: input.id,
      imageAction: input.action,
      fileIdProvided: Boolean(input.fileId),
      fileIdsCount: input.fileIds.length,
      imageCount: nextImageList.length,
      hasCoverImage: Boolean(nextCoverImage)
    })

    return {
      ok: true,
      id: input.id,
      action: input.action,
      imageList: nextImageList,
      coverImage: nextCoverImage,
      imageCount: nextImageList.length
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    await writeErrorLogBestEffort({
      function: "vehicleImageUpdate",
      id: input.id,
      action: input.action,
      authenticated: Boolean(openid),
      fileIdProvided: Boolean(input.fileId),
      fileIdsCount: input.fileIds.length,
      errorMessage
    })

    console.error({
      function: "vehicleImageUpdate",
      authenticated: Boolean(openid),
      id: input.id,
      action: input.action,
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "更新车辆图片失败，请稍后重试")
  }
}
