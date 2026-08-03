const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const ROLE_BATCH_SIZE = 100
const MAX_ROLE_RECORDS = 2000
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const ROLE_LIST_FIELDS = {
  _id: true,
  openid: true,
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true,
  createdAt: true,
  updatedAt: true
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

  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasAdminRole(item))
}

function normalizePageSize(value) {
  const num = Number(value)
  if (!Number.isFinite(num)) {
    return 20
  }

  return Math.min(50, Math.max(1, Math.floor(num)))
}

async function listRoleRecords() {
  const list = []

  for (let offset = 0; offset <= MAX_ROLE_RECORDS; offset += ROLE_BATCH_SIZE) {
    const remaining = MAX_ROLE_RECORDS + 1 - list.length
    const batchSize = Math.min(ROLE_BATCH_SIZE, remaining)
    const res = await db
      .collection("roles")
      .field(ROLE_LIST_FIELDS)
      .skip(offset)
      .limit(batchSize)
      .get()
    const batch = res && Array.isArray(res.data) ? res.data : []

    list.push(...batch)
    if (batch.length < batchSize || list.length > MAX_ROLE_RECORDS) {
      break
    }
  }

  return {
    list: list.slice(0, MAX_ROLE_RECORDS),
    truncated: list.length > MAX_ROLE_RECORDS
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const pageSize = normalizePageSize((event && event.pageSize) || (event && event.limit))
  const pageRaw = Number(event && event.page)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0

  try {
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "权限不足"
      }
    }

    const roleRecords = await listRoleRecords()
    const sortedList = roleRecords.list
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
    const start = page * pageSize
    const end = start + pageSize
    const list = sortedList.slice(start, end)

    return {
      ok: true,
      page,
      pageSize,
      hasMore: end < sortedList.length || (roleRecords.truncated && end <= MAX_ROLE_RECORDS),
      list
    }
  } catch (error) {
    console.error({
      function: "roleList",
      authenticated: Boolean(openid),
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
