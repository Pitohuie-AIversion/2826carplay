const cloud = require("wx-server-sdk")
const vehicleUtils = require("./vehicle")

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

async function isAdminOpenid(openid) {
  if (!openid) {
    return false
  }

  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasAdminRole(item))
}

function normalizeFilters(input) {
  const payload = input && typeof input === "object" ? input : {}
  const keyword = String(payload.keyword || "").trim().toUpperCase()
  const status = String(payload.status || "").trim()

  return {
    keyword,
    status
  }
}

function validateFilters(input) {
  const value = normalizeFilters(input)

  if (value.status && value.status !== "all" && !vehicleUtils.VEHICLE_STATUSES.includes(value.status)) {
    return vehicleUtils.createError("VALIDATION_ERROR", "筛选条件不合法", {
      errors: [
        {
          field: "status",
          message: "车辆状态不合法",
          value: value.status,
          allowed: ["all"].concat(vehicleUtils.VEHICLE_STATUSES)
        }
      ]
    })
  }

  return vehicleUtils.createOk(value)
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

function toTimestamp(input) {
  if (!input) {
    return 0
  }

  if (typeof input === "string") {
    return new Date(input).getTime() || 0
  }

  if (input instanceof Date) {
    return input.getTime() || 0
  }

  if (typeof input === "object" && typeof input.toDate === "function") {
    return input.toDate().getTime() || 0
  }

  return 0
}

function buildStats(list) {
  return {
    total: list.length,
    active: list.filter((item) => item.status === "active").length,
    idle: list.filter((item) => item.status === "idle").length,
    maintenance: list.filter((item) => item.status === "maintenance").length,
    retired: list.filter((item) => item.status === "retired").length
  }
}

function buildDashboardStats(list) {
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  return {
    idle: list.filter((item) => item.status === "idle").length,
    active: list.filter((item) => item.status === "active").length,
    maintenance: list.filter((item) => item.status === "maintenance").length,
    recentAdded7d: list.filter((item) => {
      const createdAt = toTimestamp(item.createdAt)
      return createdAt >= sevenDaysAgo && createdAt <= now
    }).length
  }
}

function matchesKeyword(item, keyword) {
  if (!keyword) {
    return true
  }

  const source = [item.plateNumber, item.brandModel, item.vehicleType, item.status]
    .concat([item.location, item.transmission, item.fuelType, item.priceDay])
    .filter(Boolean)
    .join(" ")
    .toUpperCase()

  return source.includes(keyword)
}

function sortList(list) {
  return list.slice().sort((prev, next) => {
    const nextTime = new Date(next.updatedAt || next.createdAt || 0).getTime()
    const prevTime = new Date(prev.updatedAt || prev.createdAt || 0).getTime()
    return nextTime - prevTime
  })
}

function buildRecentAddedList(list) {
  const now = Date.now()
  const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000

  return list
    .filter((item) => {
      const createdAt = toTimestamp(item.createdAt)
      return createdAt >= sevenDaysAgo && createdAt <= now
    })
    .sort((prev, next) => toTimestamp(next.createdAt) - toTimestamp(prev.createdAt))
    .slice(0, 5)
    .map((item) => ({
      id: item.id,
      plateNumber: item.plateNumber,
      brandModel: item.brandModel,
      status: item.status,
      location: item.location,
      createdAt: item.createdAt
    }))
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const pageRaw = Number(event && event.page)
  const pageSizeRaw = Number(event && event.pageSize)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(Math.max(Math.floor(pageSizeRaw), 1), 100) : 0

  try {
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return vehicleUtils.createError("FORBIDDEN", "权限不足")
    }

    const filterCheck = validateFilters(event)
    if (!filterCheck.ok) {
      return filterCheck
    }

    const filters = filterCheck.value
    const res = await db.collection("vehicles").limit(100).get()
    const rawList = res && Array.isArray(res.data) ? res.data : []

    const formattedList = rawList.map((item) => ({
      id: item._id || item.id || "",
      plateNumber: vehicleUtils.normalizePlateNumber(item.plateNumber),
      vehicleType: item.vehicleType || "",
      brandModel: item.brandModel || "",
      registerDate: item.registerDate || "",
      status: item.status || "",
      location: item.location || "",
      transmission: item.transmission || "",
      fuelType: item.fuelType || "",
      seats: item.seats === undefined ? null : item.seats,
      priceDay: item.priceDay === undefined ? null : item.priceDay,
      vin: item.vin || "",
      engineNumber: item.engineNumber || "",
      note: item.note || "",
      imageList: Array.isArray(item.imageList) ? item.imageList.filter(Boolean) : [],
      coverImage: item.coverImage || "",
      createdByOpenid: item.createdByOpenid || "",
      createdAt: formatTime(item.createdAt),
      updatedAt: formatTime(item.updatedAt)
    }))

    const filteredList = sortList(
      formattedList.filter((item) => {
        if (filters.status && filters.status !== "all" && item.status !== filters.status) {
          return false
        }

        return matchesKeyword(item, filters.keyword)
      })
    )

    const offset = pageSize ? page * pageSize : 0
    const list = pageSize ? filteredList.slice(offset, offset + pageSize) : filteredList

    const pagination = pageSize
      ? {
          page,
          pageSize,
          hasMore: Boolean(offset + pageSize < filteredList.length)
        }
      : {}

    return {
      ok: true,
      filters,
      total: filteredList.length,
      stats: buildStats(filteredList),
      dashboard: buildDashboardStats(formattedList),
      recentAddedList: buildRecentAddedList(formattedList),
      ...pagination,
      list: list.map((item) => ({
        ...item,
        imageCount: Array.isArray(item.imageList) ? item.imageList.length : 0
      }))
    }
  } catch (error) {
    console.error({
      function: "vehicleList",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return vehicleUtils.createError("INTERNAL_ERROR", "查询车辆列表失败，请稍后重试")
  }
}
