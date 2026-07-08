const cloud = require("wx-server-sdk")
const vehicleUtils = require("./shared/vehicle")

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

function buildStats(list) {
  return {
    total: list.length,
    active: list.filter((item) => item.status === "active").length,
    idle: list.filter((item) => item.status === "idle").length,
    maintenance: list.filter((item) => item.status === "maintenance").length,
    retired: list.filter((item) => item.status === "retired").length
  }
}

function matchesKeyword(item, keyword) {
  if (!keyword) {
    return true
  }

  const source = [item.plateNumber, item.brandModel, item.vehicleType, item.status]
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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""

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
      vin: item.vin || "",
      engineNumber: item.engineNumber || "",
      note: item.note || "",
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

    return {
      ok: true,
      filters,
      total: filteredList.length,
      stats: buildStats(filteredList),
      list: filteredList
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
