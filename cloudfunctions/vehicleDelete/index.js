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

async function deleteFilesBestEffort(fileList, context) {
  const list = normalizeStringArray(fileList)
  if (!list.length) {
    return
  }

  try {
    await cloud.deleteFile({ fileList: list })
  } catch (error) {
    console.error({
      function: "vehicleDelete",
      stage: "deleteFile",
      fileCount: list.length,
      fileList: list,
      context: context || {},
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
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
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "车辆 ID 不能为空" }]
      })
    }

    const currentRes = await db.collection("vehicles").doc(id).get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    await db.collection("vehicles").doc(id).remove()

    const coverImage = String((current && current.coverImage) || "").trim()
    const fileList = normalizeStringArray(current && current.imageList).concat(coverImage ? [coverImage] : [])
    await deleteFilesBestEffort(fileList, { openid, id })

    return {
      ok: true,
      id,
      message: "车辆已删除"
    }
  } catch (error) {
    console.error({
      function: "vehicleDelete",
      openid,
      id,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "删除车辆失败，请稍后重试")
  }
}
