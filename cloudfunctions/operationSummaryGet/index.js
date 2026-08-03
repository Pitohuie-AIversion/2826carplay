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
const _ = db.command

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
  return Boolean(
    record &&
      (record.role === "admin" ||
        (Array.isArray(record.roles) && record.roles.includes("admin")) ||
        record.isAdmin === true ||
        record.admin === true)
  )
}

function hasBookingCapability(record) {
  if (hasAdminRole(record)) {
    return true
  }

  const merged = normalizeStringArray(
    [record && record.role].concat((record && record.roles) || [], (record && record.permissions) || [])
  )
  return merged.includes("booking_manage") || merged.includes("booking_manager")
}

async function readPermissions(openid) {
  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return {
    isAdmin: list.some(hasAdminRole),
    canManageBookings: list.some(hasBookingCapability)
  }
}

function normalizeCount(result) {
  const total = Number(result && result.total)
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
}

async function countSafely(key, queryFactory) {
  try {
    const result = await queryFactory().count()
    return {
      key,
      count: normalizeCount(result),
      available: true
    }
  } catch (error) {
    console.warn({
      function: "operationSummaryGet",
      stage: "count",
      metric: key,
      errorMessage:
        error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return {
      key,
      count: 0,
      available: false
    }
  }
}

async function countCoordinationPendingSafely() {
  try {
    const activeStatus = _.in(["pending", "contacted"])
    const [activeResult, resolvedResult] = await Promise.all([
      db.collection("bookings").where({ status: activeStatus }).count(),
      db
        .collection("bookings")
        .where({
          status: activeStatus,
          coordinationStatus: "resolved"
        })
        .count()
    ])
    return {
      key: "bookingCoordinationPending",
      count: Math.max(
        0,
        normalizeCount(activeResult) - normalizeCount(resolvedResult)
      ),
      available: true
    }
  } catch (error) {
    console.warn({
      function: "operationSummaryGet",
      stage: "count",
      metric: "bookingCoordinationPending",
      errorMessage:
        error && (error.message || error.errMsg)
          ? error.message || error.errMsg
          : String(error),
      createdAt: new Date().toISOString()
    })
    return {
      key: "bookingCoordinationPending",
      count: 0,
      available: false
    }
  }
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

    const permissions = await readPermissions(openid)
    if (!permissions.isAdmin && !permissions.canManageBookings) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "权限不足"
      }
    }

    const tasks = []
    if (permissions.canManageBookings) {
      tasks.push(
        countSafely("bookingPending", () =>
          db.collection("bookings").where({ status: "pending" })
        ),
        countCoordinationPendingSafely()
      )
    }
    if (permissions.isAdmin) {
      tasks.push(
        countSafely("privacyPending", () =>
          db.collection("privacy_requests").where({ status: "pending" })
        ),
        countSafely("privacyProcessing", () =>
          db.collection("privacy_requests").where({ status: "processing" })
        ),
        countSafely("storageCleanupPending", () =>
          db.collection("pending_file_deletions")
        )
      )
    }

    const metrics = await Promise.all(tasks)
    const counts = {
      bookingPending: 0,
      bookingCoordinationPending: 0,
      privacyPending: 0,
      privacyProcessing: 0,
      storageCleanupPending: 0
    }
    const unavailable = []
    metrics.forEach((metric) => {
      counts[metric.key] = metric.count
      if (!metric.available) {
        unavailable.push(metric.key)
      }
    })

    return {
      ok: true,
      counts,
      unavailable,
      partial: unavailable.length > 0
    }
  } catch (error) {
    console.error({
      function: "operationSummaryGet",
      authenticated: Boolean(openid),
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "运营待办加载失败，请稍后重试"
    }
  }
}
