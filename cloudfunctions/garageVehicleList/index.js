const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const _ = db.command
const VEHICLE_BATCH_SIZE = 100
const MAX_VEHICLE_RECORDS = 500
const STATS_PROJECTION_LIMIT = 500
const PUBLIC_VEHICLE_FIELDS = {
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
  publicDescription: true,
  imageList: true,
  coverImage: true,
  updatedAt: true,
  createdAt: true
}

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

const CATEGORY_LABEL_MAP = {
  luxury_sedan: "豪华轿车",
  city_suv: "城市SUV",
  offroad: "硬派越野",
  supercar: "超级跑车",
  commuter_ev: "代步电车",
  pickup: "皮卡"
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

function maskPlateNumber(plateNumber) {
  const value = String(plateNumber || "").trim()
  if (!value) {
    return ""
  }

  if (value.length <= 3) {
    return "***"
  }

  if (value.length === 4) {
    return `${value.slice(0, 1)}**${value.slice(-1)}`
  }

  return `${value.slice(0, 2)}${"*".repeat(value.length - 4)}${value.slice(-2)}`
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
    const suffix = plateNumber.slice(-2)
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
    tags.push(maskPlateNumber(vehicle.plateNumber))
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
  const maskedPlateNumber = maskPlateNumber(plateNumber)
  const publicDescription = String((vehicle && vehicle.publicDescription) || "").trim()
  const coverPlaceholderText = brandModel || maskedPlateNumber || vehicleTypeText
  const seats = Number.isInteger(vehicle && vehicle.seats) ? vehicle.seats : ""
  const priceDay = Number.isInteger(vehicle && vehicle.priceDay) ? vehicle.priceDay : 0
  const fuelType = String((vehicle && vehicle.fuelType) || "").trim() || "unknown"

  return {
    id: String((vehicle && vehicle._id) || (vehicle && vehicle.id) || "").trim(),
    name: brandModel || maskedPlateNumber || "未命名车辆",
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
    seatsText: seats ? `${seats} 座` : "—",
    cover,
    images,
    hasImages: images.length > 0,
    coverPlaceholderText,
    description:
      publicDescription ||
      `${brandModel || maskedPlateNumber || "该车"}支持到店咨询与预约服务。`,
    sort: new Date(formatTime(vehicle && (vehicle.updatedAt || vehicle.createdAt)) || 0).getTime() || 0,
    registerDate: String((vehicle && vehicle.registerDate) || "").trim(),
    updatedAt: formatTime(vehicle && vehicle.updatedAt),
    createdAt: formatTime(vehicle && vehicle.createdAt)
  }
}

function normalizeSearchKeyword(value) {
  return String(value || "").trim().toLowerCase().slice(0, 50)
}

function matchesVehicleSearch(vehicle, keyword) {
  const query = normalizeSearchKeyword(keyword)
  if (!query) {
    return true
  }

  const source = vehicle && typeof vehicle === "object" ? vehicle : {}
  const tags = Array.isArray(source.tags) ? source.tags : []
  return [
    source.name,
    source.nickname,
    source.brand,
    source.category,
    CATEGORY_LABEL_MAP[source.category],
    source.location,
    ...tags
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ")
    .includes(query)
}

function buildCategoryCounts(list) {
  const counts = { all: list.length }
  list.forEach((item) => {
    const category = String((item && item.category) || "").trim()
    if (category) {
      counts[category] = (counts[category] || 0) + 1
    }
  })
  return counts
}

async function readVehiclesByMode(ordered) {
  const list = []

  for (let offset = 0; offset <= MAX_VEHICLE_RECORDS; offset += VEHICLE_BATCH_SIZE) {
    const remaining = MAX_VEHICLE_RECORDS + 1 - list.length
    const batchSize = Math.min(VEHICLE_BATCH_SIZE, remaining)
    let query = db.collection("vehicles").field(PUBLIC_VEHICLE_FIELDS)
    if (ordered) {
      query = query.orderBy("updatedAt", "desc")
    }
    const res = await query.skip(offset).limit(batchSize).get()
    const batch = res && Array.isArray(res.data) ? res.data : []

    list.push(...batch)
    if (batch.length < batchSize || list.length > MAX_VEHICLE_RECORDS) {
      break
    }
  }

  return {
    list: list.slice(0, MAX_VEHICLE_RECORDS),
    truncated: list.length > MAX_VEHICLE_RECORDS
  }
}

async function readVehicles() {
  try {
    return await readVehiclesByMode(true)
  } catch (indexError) {
    console.warn({
      function: "garageVehicleList",
      stage: "indexFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    return readVehiclesByMode(false)
  }
}

async function queryNativePage(page, pageSize, ordered) {
  const skip = page * pageSize
  let query = db.collection("vehicles").field(PUBLIC_VEHICLE_FIELDS)
  if (typeof query.where === "function") {
    query = query.where({ status: _.neq("retired") })
  }

  if (ordered && typeof query.orderBy === "function") {
    query = query.orderBy("updatedAt", "desc")
  }

  const res = await query.skip(skip).limit(pageSize).get()
  return {
    list: res && Array.isArray(res.data) ? res.data : [],
    ordered
  }
}

async function queryNativePageWithFallback(page, pageSize) {
  try {
    return await queryNativePage(page, pageSize, true)
  } catch (indexError) {
    console.warn({
      function: "garageVehicleList",
      stage: "nativeOrderByFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    return queryNativePage(page, pageSize, false)
  }
}

async function countTotalActive() {
  const res = await db
    .collection("vehicles")
    .where({ status: _.neq("retired") })
    .count()
  return res && typeof res.total === "number" ? res.total : 0
}

const STATS_PROJECTION_FIELDS = {
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
  publicDescription: true,
  coverImage: true,
  updatedAt: true,
  createdAt: true
}

async function queryStatsProjection(ordered) {
  const list = []

  for (let offset = 0; offset <= STATS_PROJECTION_LIMIT; offset += VEHICLE_BATCH_SIZE) {
    const remaining = STATS_PROJECTION_LIMIT + 1 - list.length
    const batchSize = Math.min(VEHICLE_BATCH_SIZE, remaining)
    let query = db.collection("vehicles").field(STATS_PROJECTION_FIELDS)

    if (typeof query.where === "function") {
      query = query.where({ status: _.neq("retired") })
    }

    if (ordered && typeof query.orderBy === "function") {
      query = query.orderBy("updatedAt", "desc")
    }

    if (typeof query.skip === "function") {
      query = query.skip(offset)
    }

    const res = await query.limit(batchSize).get()
    const batch = res && Array.isArray(res.data) ? res.data : []

    list.push(...batch)
    if (batch.length < batchSize || list.length > STATS_PROJECTION_LIMIT) {
      break
    }
  }

  return {
    list: list.slice(0, STATS_PROJECTION_LIMIT),
    truncated: list.length > STATS_PROJECTION_LIMIT
  }
}

let cachedStatsProjection = null
let cachedStatsProjectionExpiresAt = 0
const STATS_CACHE_TTL_MS = 30 * 1000

function clearStatsProjectionCache() {
  cachedStatsProjection = null
  cachedStatsProjectionExpiresAt = 0
}

async function queryStatsProjectionCached() {
  const now = Date.now()
  if (cachedStatsProjection && now < cachedStatsProjectionExpiresAt) {
    return cachedStatsProjection
  }
  const result = await queryStatsProjectionWithFallback()
  if (result && Array.isArray(result.list)) {
    cachedStatsProjection = result
    cachedStatsProjectionExpiresAt = now + STATS_CACHE_TTL_MS
  }
  return result
}

async function queryStatsProjectionWithFallback() {
  try {
    return await queryStatsProjection(true)
  } catch (indexError) {
    console.warn({
      function: "garageVehicleList",
      stage: "statsOrderByFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    return queryStatsProjection(false)
  }
}

function sortVehicleList(list, sortBy) {
  if (!Array.isArray(list)) return []
  if (sortBy === "price_asc") {
    return list.slice().sort((a, b) => (Number(a.priceDay) || 0) - (Number(b.priceDay) || 0))
  }
  if (sortBy === "price_desc") {
    return list.slice().sort((a, b) => (Number(b.priceDay) || 0) - (Number(a.priceDay) || 0))
  }
  return list.slice().sort((prev, next) => next.sort - prev.sort)
}

function buildFilteredLists(publicList, keyword, category, availableOnly, city, sortBy) {
  const cityFiltered = city
    ? publicList.filter((item) => String((item && item.location) || "").toLowerCase().includes(city.toLowerCase()))
    : publicList
  const searchedList = cityFiltered.filter((item) => matchesVehicleSearch(item, keyword))
  const categoryCounts = buildCategoryCounts(searchedList)
  const categoryList = category === "all"
    ? searchedList
    : searchedList.filter((item) => item.category === category)
  const availableCount = categoryList.filter((item) => item.status === "available").length
  const rawList = availableOnly
    ? categoryList.filter((item) => item.status === "available")
    : categoryList
  const fullList = sortVehicleList(rawList, sortBy)
  return { searchedList, categoryCounts, categoryList, availableCount, fullList }
}

async function runLegacyFallback(page, pageSize, keyword, category, availableOnly, city, sortBy) {
  const vehicleRecords = await readVehicles()
  const publicList = vehicleRecords.list
    .filter((item) => item && item.status !== "retired")
    .map(mapVehicle)
    .sort((prev, next) => next.sort - prev.sort)
  const { searchedList, categoryCounts, categoryList, availableCount, fullList } = buildFilteredLists(
    publicList,
    keyword,
    category,
    availableOnly,
    city,
    sortBy
  )
  const offset = page * pageSize
  const list = fullList.slice(offset, offset + pageSize)

  return {
    ok: true,
    page,
    pageSize,
    total: fullList.length,
    searchedTotal: searchedList.length,
    categoryTotal: categoryList.length,
    availableCount,
    categoryCounts,
    keyword,
    city,
    category,
    availableOnly,
    sortBy,
    truncated: vehicleRecords.truncated,
    hasMore: offset + pageSize < fullList.length,
    list
  }
}

async function runNativeOptimized(page, pageSize, keyword, category, availableOnly, skipStats, city, sortBy) {
  const hasFilter = Boolean(keyword || (category && category !== "all") || availableOnly || city || (sortBy && sortBy !== "default"))

  if (skipStats && !hasFilter) {
    const pageResult = await queryNativePageWithFallback(page, pageSize)
    const pagePublicList = (pageResult && Array.isArray(pageResult.list) ? pageResult.list : [])
      .filter((item) => item && item.status !== "retired")
      .map(mapVehicle)
      .sort((prev, next) => next.sort - prev.sort)

    return {
      ok: true,
      page,
      pageSize,
      hasMore: pagePublicList.length >= pageSize,
      list: pagePublicList
    }
  }

  const [totalCountResult, statsResult, pageResult] = await Promise.all([
    countTotalActive().catch(() => null),
    queryStatsProjectionCached(),
    queryNativePageWithFallback(page, pageSize)
  ])


  if (!statsResult || !pageResult) {
    throw new Error("NATIVE_QUERY_EMPTY_RESULT")
  }

  const statsPublicList = statsResult.list
    .filter((item) => item && item.status !== "retired")
    .map(mapVehicle)
    .sort((prev, next) => next.sort - prev.sort)

  const statsFiltered = buildFilteredLists(statsPublicList, keyword, category, availableOnly, city, sortBy)
  const { searchedList, categoryCounts, categoryList, availableCount, fullList } = statsFiltered

  const pagePublicList = pageResult.list
    .filter((item) => item && item.status !== "retired")
    .map(mapVehicle)
    .sort((prev, next) => next.sort - prev.sort)

  const pageFiltered = buildFilteredLists(pagePublicList, keyword, category, availableOnly, city, sortBy)
  const offset = page * pageSize
  const hasMore = offset + pageSize < fullList.length

  const categoryTotalForMeta = categoryList.length
  const totalForMeta = fullList.length

  const truncated = Boolean(statsResult.truncated) || (totalCountResult !== null && totalCountResult > STATS_PROJECTION_LIMIT)
  const list = hasFilter ? fullList.slice(offset, offset + pageSize) : pageFiltered.fullList


  return {
    ok: true,
    page,
    pageSize,
    total: totalForMeta,
    searchedTotal: searchedList.length,
    categoryTotal: categoryTotalForMeta,
    availableCount,
    categoryCounts,
    keyword,
    city,
    category,
    availableOnly,
    sortBy,
    truncated,
    hasMore,
    list
  }
}

exports.main = async (event) => {
  try {
    const payload = event && typeof event === "object" ? event : {}
    const pageRaw = Number(payload.page)
    const pageSizeRaw = Number(payload.pageSize)
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 0
    const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(Math.max(Math.floor(pageSizeRaw), 1), 100) : 100
    const keyword = normalizeSearchKeyword(payload.keyword)
    const city = String(payload.city || "").trim().slice(0, 50)
    const category = String(payload.category || "all").trim().slice(0, 50) || "all"
    const availableOnly = payload.availableOnly === true
    const skipStats = payload.skipStats === true
    const sortBy = String(payload.sortBy || "default").trim().slice(0, 50) || "default"

    try {
      return await runNativeOptimized(page, pageSize, keyword, category, availableOnly, skipStats, city, sortBy)
    } catch (nativeError) {
      console.warn({
        function: "garageVehicleList",
        stage: "nativeToLegacyFallback",
        errorMessage:
          nativeError && (nativeError.message || nativeError.errMsg)
            ? nativeError.message || nativeError.errMsg
            : String(nativeError),
        createdAt: new Date().toISOString()
      })
      return runLegacyFallback(page, pageSize, keyword, category, availableOnly, city, sortBy)
    }
  } catch (error) {
    console.error({
      function: "garageVehicleList",
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return createError("INTERNAL_ERROR", "获取首页车辆失败，请稍后重试")
  }
}
