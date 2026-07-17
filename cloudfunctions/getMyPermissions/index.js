const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

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

function extractCapabilities(record) {
  if (!record || typeof record !== "object") {
    return []
  }

  if (hasAdminRole(record)) {
    return ["admin", "vehicle_manage", "booking_manage"]
  }

  const merged = normalizeStringArray([record.role].concat(record.roles || [], record.permissions || []))
  const capabilities = []

  if (merged.includes("vehicle_manage") || merged.includes("vehicle_manager")) {
    capabilities.push("vehicle_manage")
  }

  if (merged.includes("booking_manage") || merged.includes("booking_manager")) {
    capabilities.push("booking_manage")
  }

  return capabilities
}

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""

  try {
    if (!openid) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "未获取到用户身份"
      }
    }

    const res = await db.collection("roles").where({ openid }).limit(20).get()
    const roleList = res && Array.isArray(res.data) ? res.data : []
    const permissions = []
    roleList.forEach((item) => {
      extractCapabilities(item).forEach((capability) => {
        if (!permissions.includes(capability)) {
          permissions.push(capability)
        }
      })
    })

    return {
      ok: true,
      openid,
      isAdmin: permissions.includes("admin"),
      permissions,
      canManageRoles: permissions.includes("admin"),
      canManageConfig: permissions.includes("admin"),
      canViewAuditLogs: permissions.includes("admin"),
      canManageVehicles: permissions.includes("admin") || permissions.includes("vehicle_manage"),
      canManageBookings: permissions.includes("admin") || permissions.includes("booking_manage")
    }
  } catch (error) {
    console.error({
      function: "getMyPermissions",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "获取权限信息失败，请稍后重试"
    }
  }
}
