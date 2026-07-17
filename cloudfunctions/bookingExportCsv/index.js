const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const BOOKING_STATUSES = ["pending", "contacted", "completed", "cancelled"]

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

function normalizeFilters(event) {
  const payload = event && typeof event === "object" ? event : {}
  const status = String(payload.status || "").trim()
  const keyword = String(payload.keyword || "").trim().toUpperCase()
  const limitRaw = Number(payload.limit)
  const limit = Number.isFinite(limitRaw) ? Math.floor(limitRaw) : 500

  return {
    status,
    keyword,
    limit: Math.min(Math.max(limit, 1), 500)
  }
}

function validateFilters(event) {
  const filters = normalizeFilters(event)
  if (filters.status && filters.status !== "all" && !BOOKING_STATUSES.includes(filters.status)) {
    return createError("VALIDATION_ERROR", "筛选条件不合法", {
      errors: [
        {
          field: "status",
          message: "预约状态不合法",
          value: filters.status,
          allowed: ["all"].concat(BOOKING_STATUSES)
        }
      ]
    })
  }

  return { ok: true, value: filters }
}

function formatTime(input) {
  if (!input) {
    return ""
  }

  if (typeof input === "string") {
    return input
  }

  if (input instanceof Date) {
    return input.toISOString()
  }

  if (typeof input === "object" && typeof input.toDate === "function") {
    return input.toDate().toISOString()
  }

  return ""
}

function matchesKeyword(item, keyword) {
  if (!keyword) {
    return true
  }

  const source = [
    item.vehicleName,
    item.vehicleId,
    item.userName,
    item.phone,
    item.city,
    item.note,
    item.adminRemark,
    item.status
  ]
    .filter(Boolean)
    .join(" ")
    .toUpperCase()

  return source.includes(keyword)
}

function pad2(value) {
  return `${value}`.padStart(2, "0")
}

function formatFileName(date) {
  const year = date.getFullYear()
  const month = pad2(date.getMonth() + 1)
  const day = pad2(date.getDate())
  const hour = pad2(date.getHours())
  const minute = pad2(date.getMinutes())
  const second = pad2(date.getSeconds())
  return `bookings_${year}${month}${day}_${hour}${minute}${second}.csv`
}

function escapeCsvCell(value) {
  const text = String(value === undefined || value === null ? "" : value)
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const escaped = normalized.replace(/"/g, '""')
  const needWrap = /[",\n]/.test(escaped)
  return needWrap ? `"${escaped}"` : escaped
}

function buildCsv(items) {
  const header = [
    "提交时间",
    "状态",
    "车辆名称",
    "联系人",
    "手机号",
    "城市",
    "开始日期",
    "结束日期",
    "用户备注",
    "管理员备注",
    "最后更新时间",
    "预约ID"
  ]

  const lines = [header.map(escapeCsvCell).join(",")]
  items.forEach((item) => {
    lines.push(
      [
        item.createdAt,
        item.status,
        item.vehicleName,
        item.userName,
        item.phone,
        item.city,
        item.startDate,
        item.endDate,
        item.note,
        item.adminRemark,
        item.updatedAt,
        item.id
      ]
        .map(escapeCsvCell)
        .join(",")
    )
  })

  return `\ufeff${lines.join("\r\n")}`
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""

  try {
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    const check = validateFilters(event)
    if (!check.ok) {
      return check
    }

    const filters = check.value
    const res = await db.collection("bookings").limit(filters.limit).get()
    const rawList = res && Array.isArray(res.data) ? res.data : []

    const list = rawList
      .map((item) => ({
        id: item._id || item.id || "",
        vehicleId: item.vehicleId || "",
        vehicleName: item.vehicleName || "",
        userName: item.userName || "",
        phone: item.phone || "",
        startDate: item.startDate || "",
        endDate: item.endDate || "",
        city: item.city || "",
        note: item.note || "",
        adminRemark: item.adminRemark || "",
        status: item.status || "pending",
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      }))
      .filter((item) => {
        if (filters.status && filters.status !== "all" && item.status !== filters.status) {
          return false
        }
        return matchesKeyword(item, filters.keyword)
      })

    const fileName = formatFileName(new Date())
    const csvText = buildCsv(list)

    return {
      ok: true,
      filters,
      fileName,
      total: list.length,
      csvText
    }
  } catch (error) {
    console.error({
      function: "bookingExportCsv",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "导出失败，请稍后重试")
  }
}

