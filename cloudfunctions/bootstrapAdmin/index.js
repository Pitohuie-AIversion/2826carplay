const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

exports.main = async (event) => {
  const context = cloud.getWXContext()
  const openid = context && context.OPENID ? context.OPENID : ""
  const token = String(event && event.token ? event.token : "").trim()
  const requiredToken = String(process.env.BOOTSTRAP_TOKEN || "").trim()

  try {
    const existed = await db.collection("roles").limit(100).get()
    const roleList = existed && Array.isArray(existed.data) ? existed.data : []
    const currentRole = roleList.find((item) => item && item.openid === openid)

    if (currentRole && hasAdminRole(currentRole)) {
      return {
        ok: true,
        openid,
        initialized: false,
        alreadyAdmin: true,
        message: "当前账号已是管理员"
      }
    }

    if (roleList.length > 0) {
      return {
        ok: false,
        code: "BOOTSTRAP_LOCKED",
        message: "管理员已初始化，请联系现有管理员分配权限"
      }
    }

    if (requiredToken && token !== requiredToken) {
      return {
        ok: false,
        code: "BOOTSTRAP_TOKEN_REQUIRED",
        message: "管理员初始化已加锁，请联系开发人员获取口令"
      }
    }

    const now = db.serverDate()
    await db.collection("roles").add({
      data: {
        openid,
        role: "admin",
        bootstrap: true,
        createdAt: now,
        updatedAt: now
      }
    })

    return {
      ok: true,
      openid,
      initialized: true,
      alreadyAdmin: false,
      message: "已初始化为首个管理员"
    }
  } catch (error) {
    console.error({
      function: "bootstrapAdmin",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
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
