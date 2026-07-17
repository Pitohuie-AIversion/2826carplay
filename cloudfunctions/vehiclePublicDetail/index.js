const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const VEHICLE_TYPE_LABEL_MAP = {
  sedan: "轿车",
  suv: "SUV",
  mpv: "MPV",
  sports: "跑车",
  truck: "卡车",
  other: "其他"
}

const STATUS_MAP = {
  idle: {
    status: "available",
    statusText: "在库"
  },
  active: {
    status: "rented",
    statusText: "在用"
  },
  maintenance: {
    status: "maintenance",
    statusText: "维护中"
  }
}

const PERFORMANCE_BRANDS = ["PORSCHE", "FERRARI", "LAMBORGHINI", "MCLAREN", "LOTUS", "ASTON"]
const OFFROAD_BRANDS = [
  "JEEP",
  "WRANGLER",
  "DEFENDER",
  "BRONCO",
  "LAND",
  "RANGE",
  "G-CLASS",
  "G63",
  "G500",
  "坦克",
  "牧马人",
  "卫士",
  "普拉多",
  "陆巡",
  "帕杰罗",
  "途乐"
]
const LUXURY_BRANDS = [
  "BMW",
  "MERCEDES",
  "BENZ",
  "AUDI",
  "LEXUS",
  "CADILLAC",
  "VOLVO",
  "LAND",
  "RANGE",
  "LI",
  "理想",
  "问界",
  "腾势"
]
const MINI_FUN_BRANDS = ["MINI", "MAZDA", "MX-5", "ABARTH"]

function createError(code, message, details) {
  const result = {
    ok: false,
    code: String(code || "VALIDATION_ERROR"),
    message: String(message || "参数错误")
  }

  if (details !== undefined) {
    result.details = details
  }

  return result
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

function getBrand(brandModel) {
  const value = String(brandModel || "").trim()
  if (!value) {
    return "未知品牌"
  }

  return value.split(/\s+/)[0] || value
}

function inferCategory(vehicleType, brandModel, fuelType) {
  const upperBrandModel = String(brandModel || "").trim().toUpperCase()
  const normalizedFuelType = String(fuelType || "").trim().toLowerCase()

  if (vehicleType === "truck") {
    return "pickup"
  }

  if (normalizedFuelType === "electric") {
    return "commuter_ev"
  }

  if (vehicleType === "sports" || PERFORMANCE_BRANDS.some((item) => upperBrandModel.includes(item))) {
    return "supercar"
  }

  if (vehicleType === "suv" && OFFROAD_BRANDS.some((item) => upperBrandModel.includes(item))) {
    return "offroad"
  }

  if (vehicleType === "suv" || vehicleType === "mpv") {
    return "city_suv"
  }

  if (vehicleType === "sedan" || LUXURY_BRANDS.some((item) => upperBrandModel.includes(item)) || MINI_FUN_BRANDS.some((item) => upperBrandModel.includes(item))) {
    return "luxury_sedan"
  }

  return "luxury_sedan"
}

function buildNickname(plateNumber, vehicleTypeText) {
  if (plateNumber) {
    const suffix = plateNumber.slice(-4)
    if (suffix) {
      return `车牌尾号 ${suffix}`
    }
  }

  return vehicleTypeText || "精选车辆"
}

function buildPriceText(priceDay) {
  if (Number.isInteger(priceDay) && priceDay > 0) {
    return `今日 ￥${priceDay} / 24小时`
  }

  return "价格到店详询"
}

function buildTags(vehicle, vehicleTypeText) {
  const tags = []

  if (vehicleTypeText) {
    tags.push(vehicleTypeText)
  }

  if (vehicle && vehicle.registerDate) {
    tags.push(`上牌 ${String(vehicle.registerDate).slice(0, 4)}`)
  }

  if (vehicle && vehicle.plateNumber) {
    tags.push(String(vehicle.plateNumber).trim())
  }

  if (vehicle && vehicle.transmission) {
    tags.push(vehicle.transmission === "manual" ? "手动挡" : vehicle.transmission === "automatic" ? "自动挡" : String(vehicle.transmission))
  }

  return tags.filter(Boolean).slice(0, 3)
}

function buildImages(vehicle) {
  const imageList = Array.isArray(vehicle && vehicle.imageList) ? vehicle.imageList.filter(Boolean) : []
  const coverImage = String((vehicle && vehicle.coverImage) || "").trim()

  if (!coverImage) {
    return imageList
  }

  const restImages = imageList.filter((fileId) => fileId !== coverImage)
  return [coverImage].concat(restImages)
}

function mapVehicle(vehicle) {
  const vehicleType = String((vehicle && vehicle.vehicleType) || "").trim()
  const vehicleTypeText = VEHICLE_TYPE_LABEL_MAP[vehicleType] || vehicleType || "其他"
  const mappedStatus = STATUS_MAP[vehicle && vehicle.status] || STATUS_MAP.idle
  const images = buildImages(vehicle)
  const cover = images[0] || ""
  const brandModel = String((vehicle && vehicle.brandModel) || "").trim()
  const plateNumber = String((vehicle && vehicle.plateNumber) || "").trim()
  const note = String((vehicle && vehicle.note) || "").trim()
  const coverPlaceholderText = brandModel || plateNumber || vehicleTypeText
  const seats = Number.isInteger(vehicle && vehicle.seats) ? vehicle.seats : ""
  const priceDay = Number.isInteger(vehicle && vehicle.priceDay) ? vehicle.priceDay : 0
  const fuelType = String((vehicle && vehicle.fuelType) || "").trim() || "unknown"

  return {
    id: String((vehicle && vehicle._id) || (vehicle && vehicle.id) || "").trim(),
    name: brandModel || plateNumber || "未命名车辆",
    nickname: buildNickname(plateNumber, vehicleTypeText),
    brand: getBrand(brandModel),
    category: inferCategory(vehicleType, brandModel, fuelType),
    priceDay,
    priceText: buildPriceText(priceDay),
    status: mappedStatus.status,
    statusText: mappedStatus.statusText,
    location: String((vehicle && vehicle.location) || "").trim() || "门店咨询",
    tags: buildTags(vehicle, vehicleTypeText),
    transmission: String((vehicle && vehicle.transmission) || "").trim() || "unknown",
    fuelType,
    seats,
    seatsText: seats ? `${seats} 座` : "--",
    cover,
    images,
    hasImages: images.length > 0,
    coverPlaceholderText,
    description: note || `${brandModel || plateNumber || "该车"}支持到店咨询与预约服务。`,
    sort: new Date(formatTime(vehicle && (vehicle.updatedAt || vehicle.createdAt)) || 0).getTime() || 0,
    registerDate: String((vehicle && vehicle.registerDate) || "").trim(),
    updatedAt: formatTime(vehicle && vehicle.updatedAt),
    createdAt: formatTime(vehicle && vehicle.createdAt)
  }
}

function normalizeEvent(event) {
  const payload = event && typeof event === "object" ? event : {}
  return {
    id: String(payload.id || payload.carId || payload.vehicleId || "").trim()
  }
}

exports.main = async (event) => {
  const input = normalizeEvent(event)

  try {
    if (!input.id) {
      return createError("VALIDATION_ERROR", "参数校验失败", {
        errors: [{ field: "id", message: "车辆 ID 不能为空" }]
      })
    }

    const res = await db.collection("vehicles").doc(input.id).get()
    const current = res && res.data ? res.data : null
    if (!current) {
      return createError("NOT_FOUND", "车辆不存在")
    }

    if (String(current.status || "").trim() === "retired") {
      return createError("NOT_AVAILABLE", "车辆已停用")
    }

    const mapped = mapVehicle({
      ...current,
      _id: current._id || input.id
    })

    return {
      ok: true,
      car: mapped
    }
  } catch (error) {
    console.error({
      function: "vehiclePublicDetail",
      id: input.id,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "获取车辆详情失败，请稍后重试")
  }
}
