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
const VEHICLE_MANAGE_DETAIL_FIELDS = {
  _id: true,
  plateNumber: true,
  vehicleType: true,
  brandModel: true,
  registerDate: true,
  status: true,
  location: true,
  transmission: true,
  fuelType: true,
  seats: true,
  priceDay: true,
  vin: true,
  engineNumber: true,
  publicDescription: true,
  note: true,
  publicMaterialsUpdatedDate: true,
  publicInspectionDate: true,
  publicInspectionSummary: true,
  publicExteriorSummary: true,
  publicInsuranceSummary: true,
  publicAssistanceSummary: true,
  publicArchiveReviewStatus: true,
  internalMaintenanceRecord: true,
  internalInspectionRecord: true,
  internalInsuranceRecord: true,
  internalArchiveNote: true,
  imageList: true,
  coverImage: true,
  createdByOpenid: true,
  createdAt: true,
  updatedAt: true
}

function buildArchiveHealth(item) {
  const source = item && typeof item === "object" ? item : {}
  const requiredValues = [
    source.publicMaterialsUpdatedDate,
    source.publicInspectionDate,
    source.publicInspectionSummary,
    source.publicExteriorSummary,
    source.publicInsuranceSummary,
    source.publicAssistanceSummary
  ].map((value) => String(value || "").trim())
  const missingCount = requiredValues.filter((value) => !value).length
  const timestamps = [source.publicMaterialsUpdatedDate, source.publicInspectionDate]
    .map((value) => new Date(`${String(value || "").trim()}T00:00:00+08:00`).getTime())
    .filter((value) => Number.isFinite(value))
  const latestTimestamp = timestamps.length ? Math.max(...timestamps) : 0
  const freshnessDays = latestTimestamp
    ? Math.max(0, Math.floor((Date.now() - latestTimestamp) / (24 * 60 * 60 * 1000)))
    : null
  if (missingCount) {
    return { status: "missing", statusText: "资料缺失", missingCount, freshnessDays }
  }
  if (freshnessDays !== null && freshnessDays > 180) {
    return { status: "stale", statusText: "资料已过期", missingCount, freshnessDays }
  }
  if (String(source.publicArchiveReviewStatus || "") !== "reviewed") {
    return { status: "pending", statusText: "资料待复核", missingCount, freshnessDays }
  }
  return { status: "current", statusText: "资料已复核", missingCount, freshnessDays }
}

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

function hasCapability(record, capability) {
  if (hasAdminRole(record)) {
    return true
  }

  const merged = normalizeStringArray([record && record.role].concat((record && record.roles) || [], (record && record.permissions) || []))
  if (capability === "vehicle_manage") {
    return merged.includes("vehicle_manage") || merged.includes("vehicle_manager")
  }

  return false
}

async function hasOpenidCapability(openid, capability) {
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
  return list.some((item) => hasCapability(item, capability))
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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const id = String((event && event.id) || "").trim()

  try {
    const allowed = await hasOpenidCapability(openid, "vehicle_manage")
    if (!allowed) {
      return createError("FORBIDDEN", "权限不足")
    }

    if (!id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "车辆 ID 不能为空" }]
      })
    }

    const res = await db
      .collection("vehicles")
      .doc(id)
      .field(VEHICLE_MANAGE_DETAIL_FIELDS)
      .get()
    const item = res && res.data ? res.data : null
    if (!item) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    return {
      ok: true,
      detail: {
        id: item._id || item.id || "",
        plateNumber: String(item.plateNumber || "").trim().toUpperCase(),
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
        publicDescription: item.publicDescription || "",
        note: item.note || "",
        publicMaterialsUpdatedDate: item.publicMaterialsUpdatedDate || "",
        publicInspectionDate: item.publicInspectionDate || "",
        publicInspectionSummary: item.publicInspectionSummary || "",
        publicExteriorSummary: item.publicExteriorSummary || "",
        publicInsuranceSummary: item.publicInsuranceSummary || "",
        publicAssistanceSummary: item.publicAssistanceSummary || "",
        publicArchiveReviewStatus: item.publicArchiveReviewStatus || "pending",
        internalMaintenanceRecord: item.internalMaintenanceRecord || "",
        internalInspectionRecord: item.internalInspectionRecord || "",
        internalInsuranceRecord: item.internalInsuranceRecord || "",
        internalArchiveNote: item.internalArchiveNote || "",
        archiveHealth: buildArchiveHealth(item),
        imageList: Array.isArray(item.imageList) ? item.imageList.filter(Boolean) : [],
        coverImage: item.coverImage || "",
        createdByOpenid: item.createdByOpenid || "",
        createdAt: formatTime(item.createdAt),
        updatedAt: formatTime(item.updatedAt)
      }
    }
  } catch (error) {
    console.error({
      function: "vehicleDetail",
      authenticated: Boolean(openid),
      id,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "查询车辆详情失败，请稍后重试")
  }
}
