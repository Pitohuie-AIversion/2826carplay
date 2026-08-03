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
const ROLE_EXISTENCE_FIELDS = {
  _id: true
}
const BOOTSTRAP_ROLE_ID = "bootstrap_admin"
const MIN_BOOTSTRAP_TOKEN_LENGTH = 32
const MAX_BOOTSTRAP_TOKEN_LENGTH = 256

function secureTokenEquals(input, expected) {
  const inputHash = crypto.createHash("sha256").update(String(input || "")).digest()
  const expectedHash = crypto.createHash("sha256").update(String(expected || "")).digest()
  return crypto.timingSafeEqual(inputHash, expectedHash)
}

function getDocumentFromResult(result) {
  if (!result || !result.data) {
    return null
  }
  if (Array.isArray(result.data)) {
    return result.data[0] || null
  }
  return typeof result.data === "object" ? result.data : null
}

function isDocumentNotFoundError(error) {
  const code = String(error && (error.code || error.errCode) ? error.code || error.errCode : "")
  const message = String(
    error && (error.message || error.errMsg) ? error.message || error.errMsg : error || ""
  )
  return (
    /DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST|OBJECT_NOT_EXIST/i.test(code) ||
    /document.*(?:not\s+found|not\s+exist)|文档不存在/i.test(message)
  )
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

async function readCurrentRole(openid) {
  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.find((item) => hasAdminRole(item)) || null
}

async function hasAnyRoleRecord() {
  const res = await db
    .collection("roles")
    .field(ROLE_EXISTENCE_FIELDS)
    .limit(1)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.length > 0
}

async function claimBootstrapAdmin(openid, now) {
  if (!db || typeof db.runTransaction !== "function") {
    return {
      claimed: false,
      unsupported: true
    }
  }

  const transactionResponse = await db.runTransaction(async (transaction) => {
    const bootstrapRef = transaction.collection("roles").doc(BOOTSTRAP_ROLE_ID)
    let existed = null
    try {
      existed = getDocumentFromResult(await bootstrapRef.get())
    } catch (error) {
      if (!isDocumentNotFoundError(error)) {
        throw error
      }
    }

    if (existed) {
      return {
        claimed: false,
        alreadyOwner: existed.openid === openid && hasAdminRole(existed)
      }
    }

    await bootstrapRef.set({
      data: {
        openid,
        role: "admin",
        bootstrap: true,
        createdAt: now,
        updatedAt: now
      }
    })

    return {
      claimed: true,
      alreadyOwner: false
    }
  }, 3)

  return transactionResponse &&
    transactionResponse.result &&
    typeof transactionResponse.result === "object"
    ? transactionResponse.result
    : transactionResponse
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
      function: "bootstrapAdmin",
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
      function: "bootstrapAdmin",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const context = cloud.getWXContext()
  const openid = context && context.OPENID ? context.OPENID : ""
  const token = String(event && event.token ? event.token : "").trim()
  const requiredToken = String(process.env.BOOTSTRAP_TOKEN || "").trim()

  try {
    if (!openid) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "未获取到用户身份"
      }
    }

    const currentRole = await readCurrentRole(openid)

    if (currentRole && hasAdminRole(currentRole)) {
      return {
        ok: true,
        openid,
        initialized: false,
        alreadyAdmin: true,
        message: "当前账号已是管理员"
      }
    }

    if (await hasAnyRoleRecord()) {
      return {
        ok: false,
        code: "BOOTSTRAP_LOCKED",
        message: "管理员已初始化，请联系现有管理员分配权限"
      }
    }

    if (
      requiredToken.length < MIN_BOOTSTRAP_TOKEN_LENGTH ||
      requiredToken.length > MAX_BOOTSTRAP_TOKEN_LENGTH
    ) {
      return {
        ok: false,
        code: "BOOTSTRAP_DISABLED",
        message: "管理员初始化未启用，请配置 32 至 256 位随机口令"
      }
    }

    if (
      token.length > MAX_BOOTSTRAP_TOKEN_LENGTH ||
      !secureTokenEquals(token, requiredToken)
    ) {
      return {
        ok: false,
        code: "BOOTSTRAP_TOKEN_REQUIRED",
        message: "管理员初始化口令不正确"
      }
    }

    const now = db.serverDate()
    const claimResult = await claimBootstrapAdmin(openid, now)
    if (!claimResult || claimResult.unsupported) {
      return {
        ok: false,
        code: "BOOTSTRAP_DISABLED",
        message: "管理员初始化未启用，请升级云函数依赖后重试"
      }
    }

    if (!claimResult.claimed) {
      if (claimResult.alreadyOwner) {
        return {
          ok: true,
          openid,
          initialized: false,
          alreadyAdmin: true,
          message: "当前账号已是管理员"
        }
      }
      return {
        ok: false,
        code: "BOOTSTRAP_LOCKED",
        message: "管理员已初始化，请联系现有管理员分配权限"
      }
    }

    await writeAuditLogBestEffort({
      openid,
      action: "bootstrapAdmin",
      targetOpenid: openid,
      bootstrap: true,
      tokenProtected: true
    })

    return {
      ok: true,
      openid,
      initialized: true,
      alreadyAdmin: false,
      message: "已初始化为首个管理员"
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    await writeErrorLogBestEffort({
      function: "bootstrapAdmin",
      stage: "main",
      authenticated: Boolean(openid),
      hasRequiredToken: Boolean(requiredToken),
      tokenProvided: Boolean(token),
      errorMessage,
      occurredAt: new Date().toISOString()
    })

    console.error({
      function: "bootstrapAdmin",
      authenticated: Boolean(openid),
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "初始化管理员失败，请检查 roles 集合与云环境配置"
    }
  }
}
