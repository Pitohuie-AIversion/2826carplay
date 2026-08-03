const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const DEFAULT_PAGE_SIZE = 10
const MAX_PAGE_SIZE = 20
const FALLBACK_MAX_RECORDS = 500
const FAVORITE_RECORD_FIELDS = {
  _id: true,
  vehicleId: true,
  createdAt: true
}
const FAVORITE_CARD_FIELDS = {
  _id: true,
  brandModel: true,
  plateNumber: true,
  vehicleType: true,
  status: true,
  transmission: true,
  priceDay: true,
  coverImage: true,
  imageList: true
}
const STATUS_MAP = {
  idle: { status: "available", statusText: "可预约" },
  active: { status: "rented", statusText: "使用中" },
  maintenance: { status: "maintenance", statusText: "维护中" }
}

function normalizePage(value, fallback) {
  const number = Number(value)
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : fallback
}

function maskPlateNumber(value) {
  const text = String(value || "").trim()
  if (!text) {
    return ""
  }
  if (text.length <= 3) {
    return "***"
  }
  if (text.length === 4) {
    return `${text.slice(0, 1)}**${text.slice(-1)}`
  }
  return `${text.slice(0, 2)}${"*".repeat(text.length - 4)}${text.slice(-2)}`
}

function toTimestamp(value) {
  if (!value) {
    return 0
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === "object" && typeof value.toDate === "function") {
    return value.toDate().getTime()
  }
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

function buildVehicleCard(vehicle) {
  if (!vehicle || String(vehicle.status || "") === "retired") {
    return null
  }

  const brandModel = String(vehicle.brandModel || "").trim()
  const brand = brandModel.split(/\s+/)[0] || "未知品牌"
  const plateNumber = String(vehicle.plateNumber || "").trim()
  const vehicleType = String(vehicle.vehicleType || "").trim()
  const vehicleTypeText =
    {
      sedan: "轿车",
      suv: "SUV",
      mpv: "MPV",
      sports: "跑车",
      truck: "卡车",
      other: "其他"
    }[vehicleType] || vehicleType || "精选车辆"
  const images = Array.isArray(vehicle.imageList) ? vehicle.imageList.filter(Boolean) : []
  const coverImage = String(vehicle.coverImage || "").trim()
  const cover = coverImage || images[0] || ""
  const priceDay = Number.isInteger(vehicle.priceDay) && vehicle.priceDay > 0 ? vehicle.priceDay : 0
  const statusMeta = STATUS_MAP[vehicle.status] || STATUS_MAP.idle
  const tags = [vehicleTypeText]

  if (vehicle.transmission) {
    tags.push(
      vehicle.transmission === "manual"
        ? "手动挡"
        : vehicle.transmission === "automatic"
          ? "自动挡"
          : String(vehicle.transmission)
    )
  }
  if (plateNumber) {
    tags.push(maskPlateNumber(plateNumber))
  }

  return {
    id: String(vehicle._id || vehicle.id || "").trim(),
    name: brandModel || maskPlateNumber(plateNumber) || "未命名车辆",
    nickname: plateNumber ? `车牌尾号 ${plateNumber.slice(-2)}` : vehicleTypeText,
    brand,
    cover,
    coverPlaceholderText: brandModel || vehicleTypeText,
    priceText: priceDay ? `今日 ￥${priceDay} / 24小时` : "价格到店详询",
    status: statusMeta.status,
    statusText: statusMeta.statusText,
    statusClass: `status-${statusMeta.status}`,
    tags: tags.filter(Boolean).slice(0, 3)
  }
}

async function readVehicle(vehicleId) {
  try {
    const res = await db
      .collection("vehicles")
      .doc(vehicleId)
      .field(FAVORITE_CARD_FIELDS)
      .get()
    return res && res.data ? res.data : null
  } catch (error) {
    return null
  }
}

async function readFavoritePage(openid, page, pageSize) {
  try {
    const res = await db
      .collection("favorites")
      .where({ openid })
      .field(FAVORITE_RECORD_FIELDS)
      .orderBy("createdAt", "desc")
      .skip(page * pageSize)
      .limit(pageSize + 1)
      .get()
    const records = res && Array.isArray(res.data) ? res.data : []
    return {
      records: records.slice(0, pageSize),
      hasMore: records.length > pageSize
    }
  } catch (indexError) {
    console.warn({
      function: "favoriteMyList",
      stage: "indexFallback",
      errorMessage:
        indexError && (indexError.message || indexError.errMsg)
          ? indexError.message || indexError.errMsg
          : String(indexError),
      createdAt: new Date().toISOString()
    })
    const res = await db
      .collection("favorites")
      .where({ openid })
      .field(FAVORITE_RECORD_FIELDS)
      .limit(FALLBACK_MAX_RECORDS + 1)
      .get()
    const rawList = res && Array.isArray(res.data) ? res.data : []
    const records = rawList
      .slice(0, FALLBACK_MAX_RECORDS)
      .sort((prev, next) => toTimestamp(next.createdAt) - toTimestamp(prev.createdAt))
    const start = page * pageSize
    return {
      records: records.slice(start, start + pageSize),
      hasMore: start + pageSize < records.length || rawList.length > FALLBACK_MAX_RECORDS
    }
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = event && typeof event === "object" ? event : {}
  const page = normalizePage(input.page, 0)
  const pageSize = Math.min(
    Math.max(normalizePage(input.pageSize, DEFAULT_PAGE_SIZE), 1),
    MAX_PAGE_SIZE
  )

  try {
    if (!openid) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "未获取到用户身份"
      }
    }

    const favoritePage = await readFavoritePage(openid, page, pageSize)
    const pageRecords = favoritePage.records
    const vehicles = await Promise.all(
      pageRecords.map((item) => readVehicle(String(item.vehicleId || "").trim()))
    )
    const list = vehicles
      .map((vehicle, index) => {
        const car = buildVehicleCard(vehicle)
        if (!car) {
          return null
        }
        return {
          ...car,
          favoriteId: String(pageRecords[index]._id || "")
        }
      })
      .filter(Boolean)

    return {
      ok: true,
      page,
      pageSize,
      hasMore: favoritePage.hasMore,
      list
    }
  } catch (error) {
    console.error({
      function: "favoriteMyList",
      authenticated: Boolean(openid),
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "收藏列表加载失败，请稍后重试"
    }
  }
}
