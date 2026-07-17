const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const MAX_IMAGE_COUNT = 9
const ALLOWED_ACTIONS = ["add", "remove", "setCover"]

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

async function isAdminOpenid(openid) {
  if (!openid) {
    return false
  }

  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasAdminRole(item))
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

async function deleteFilesBestEffort(fileList, context) {
  const list = normalizeStringArray(fileList)
  if (!list.length) {
    return
  }

  try {
    await cloud.deleteFile({ fileList: list })
  } catch (error) {
    console.error({
      function: "vehicleImageUpdate",
      stage: "deleteFile",
      fileCount: list.length,
      fileList: list,
      context: context || {},
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    try {
      await db.collection("pending_file_deletions").add({
        data: {
          fileList: list,
          context: context || {},
          source: "vehicleImageUpdate",
          createdAt: db.serverDate()
        }
      })
    } catch (queueError) {}
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
    const allowed = await isAdminOpenid(openid)
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
        errors: [{ field: "action", message: "仅支持 add/remove/setCover" }]
      })
    }

    const currentRes = await db.collection("vehicles").doc(input.id).get()
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
      await deleteFilesBestEffort([input.fileId], { openid, id: input.id, action: input.action })
    }

    await writeAuditLogBestEffort({
      openid,
      action: "vehicleImageUpdate",
      vehicleId: input.id,
      imageAction: input.action,
      fileId: input.fileId,
      fileIds: input.fileIds,
      imageCount: nextImageList.length,
      coverImage: nextCoverImage
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
    await writeErrorLogBestEffort({
      function: "vehicleImageUpdate",
      openid,
      id: input.id,
      action: input.action,
      input,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : ""
    })

    console.error({
      function: "vehicleImageUpdate",
      openid,
      id: input.id,
      action: input.action,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "更新车辆图片失败，请稍后重试")
  }
}
