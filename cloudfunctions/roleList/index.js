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

function extractPermissions(record) {
  if (hasAdminRole(record)) {
    return ["admin", "vehicle_manage", "booking_manage"]
  }

  const merged = normalizeStringArray([record && record.role].concat((record && record.roles) || [], (record && record.permissions) || []))
  const permissions = []
  if (merged.includes("vehicle_manage") || merged.includes("vehicle_manager")) {
    permissions.push("vehicle_manage")
  }
  if (merged.includes("booking_manage") || merged.includes("booking_manager")) {
    permissions.push("booking_manage")
  }
  return permissions
}

async function isAdminOpenid(openid) {
  if (!openid) {
    return false
  }

  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasAdminRole(item))
}

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""

  try {
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "权限不足"
      }
    }

    const res = await db.collection("roles").limit(200).get()
    const rawList = res && Array.isArray(res.data) ? res.data : []
    const list = rawList
      .map((item) => ({
        id: item._id || "",
        openid: String(item.openid || "").trim(),
        isAdmin: hasAdminRole(item),
        permissions: extractPermissions(item),
        createdAt: item.createdAt || "",
        updatedAt: item.updatedAt || ""
      }))
      .filter((item) => item.openid)
      .sort((prev, next) => {
        if (prev.isAdmin === next.isAdmin) {
          return prev.openid.localeCompare(next.openid)
        }
        return prev.isAdmin ? -1 : 1
      })

    return {
      ok: true,
      list
    }
  } catch (error) {
    console.error({
      function: "roleList",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "获取角色列表失败，请稍后重试"
    }
  }
}
