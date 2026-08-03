const cloud = require("wx-server-sdk")
const crypto = require("crypto")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const ALLOWED_PERMISSIONS = ["vehicle_manage", "booking_manage"]
const OPENID_PATTERN = /^[A-Za-z0-9_-]{6,128}$/
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const ROLE_UPSERT_TARGET_FIELDS = {
  _id: true,
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
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

function normalizeRoleTokens(value) {
  return normalizeStringArray(value)
}

function buildRoleDocumentId(openid) {
  return `role_${crypto.createHash("sha256").update(openid).digest("hex").slice(0, 27)}`
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
      function: "roleUpsert",
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
      function: "roleUpsert",
      stage: "errorLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

async function isAdminOpenid(openid) {
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
  return list.some((item) => hasAdminRole(item))
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    openid: String(payload.openid || "").trim(),
    permissions: normalizeStringArray(payload.permissions)
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const operatorOpenid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = normalizeEvent(event)

  try {
    const allowed = await isAdminOpenid(operatorOpenid)
    if (!allowed) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "权限不足"
      }
    }

    if (!input.openid) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "参数校验失败",
        details: {
          errors: [{ field: "openid", message: "OpenID 不能为空" }]
        }
      }
    }

    if (!OPENID_PATTERN.test(input.openid)) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "OpenID 格式不正确",
        details: {
          errors: [
            {
              field: "openid",
              message: "OpenID 仅支持 6-128 位字母、数字、下划线和连字符"
            }
          ]
        }
      }
    }

    if (input.openid === operatorOpenid) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "不支持修改自己的权限"
      }
    }

    const invalidPermissions = input.permissions.filter((item) => !ALLOWED_PERMISSIONS.includes(item))
    if (invalidPermissions.length) {
      return {
        ok: false,
        code: "VALIDATION_ERROR",
        message: "权限项不合法",
        details: {
          errors: [{ field: "permissions", message: "仅支持 vehicle_manage / booking_manage", value: invalidPermissions }]
        }
      }
    }

    const existedRes = await db
      .collection("roles")
      .where({ openid: input.openid })
      .field(ROLE_UPSERT_TARGET_FIELDS)
      .limit(20)
      .get()
    const existedList = existedRes && Array.isArray(existedRes.data) ? existedRes.data : []
    const adminRecord = existedList.find((item) => hasAdminRole(item))
    if (adminRecord) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "不能修改管理员权限"
      }
    }

    const now = db.serverDate()
    const payload = {
      openid: input.openid,
      role: input.permissions.length ? "operator" : "member",
      permissions: input.permissions,
      updatedAt: now,
      updatedByOpenid: operatorOpenid
    }

    if (existedList.length) {
      const fromPermissions = []
      existedList.forEach((record) => {
        normalizeRoleTokens(record && record.permissions ? record.permissions : []).forEach((permission) => {
          if (!fromPermissions.includes(permission)) {
            fromPermissions.push(permission)
          }
        })
      })

      await Promise.all(
        existedList.map((record) =>
          db.collection("roles").doc(record._id).update({
            data: payload
          })
        )
      )

      await writeAuditLogBestEffort({
        openid: operatorOpenid,
        action: "roleUpsert",
        targetOpenid: input.openid,
        fromPermissions,
        toPermissions: normalizeRoleTokens(input.permissions),
        updated: true
      })

      return {
        ok: true,
        openid: input.openid,
        permissions: input.permissions,
        updated: true,
        message: "权限已更新"
      }
    }

    await db.collection("roles").doc(buildRoleDocumentId(input.openid)).set({
      data: {
        ...payload,
        createdAt: now,
        createdByOpenid: operatorOpenid
      }
    })

    await writeAuditLogBestEffort({
      openid: operatorOpenid,
      action: "roleUpsert",
      targetOpenid: input.openid,
      fromPermissions: [],
      toPermissions: normalizeRoleTokens(input.permissions),
      updated: false
    })

    return {
      ok: true,
      openid: input.openid,
      permissions: input.permissions,
      updated: false,
      message: "权限已创建"
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    console.error({
      function: "roleUpsert",
      operatorAuthenticated: Boolean(operatorOpenid),
      targetProvided: Boolean(input.openid),
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    await writeErrorLogBestEffort({
      function: "roleUpsert",
      stage: "main",
      operatorAuthenticated: Boolean(operatorOpenid),
      targetProvided: Boolean(input.openid),
      errorMessage,
      occurredAt: new Date().toISOString()
    })

    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "保存权限失败，请稍后重试"
    }
  }
}
