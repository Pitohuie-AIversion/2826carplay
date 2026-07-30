const { trackEvent } = require("../../shared/analytics")
const mockCategories = require("../../data/categories")

const CATEGORY_LABEL_MAP = {
  all: "全部",
  luxury_sedan: "豪华轿车",
  city_suv: "城市SUV",
  offroad: "硬派越野",
  supercar: "超级跑车",
  commuter_ev: "代步电车",
  pickup: "皮卡"
}

mockCategories.forEach((item) => {
  CATEGORY_LABEL_MAP[item.id] = item.name
})

function normalizeGarageStatus(status) {
  const value = String(status || "").trim()
  if (value === "idle" || value === "available") {
    return "idle"
  }
  if (value === "active" || value === "rented") {
    return "active"
  }
  if (value === "maintenance") {
    return "maintenance"
  }
  if (value === "reserved") {
    return "reserved"
  }
  return "idle"
}

function getStatusText(status, fallbackText) {
  const normalizedStatus = normalizeGarageStatus(status)
  const statusTextMap = {
    idle: "闲置",
    active: "在用",
    maintenance: "维修中",
    reserved: "已预约"
  }

  return statusTextMap[normalizedStatus] || fallbackText || "闲置"
}

function attachStatusClass(car) {
  const normalizedStatus = normalizeGarageStatus(car.status)
  const statusClassMap = {
    idle: "status-idle",
    active: "status-active",
    maintenance: "status-maintenance",
    reserved: "status-reserved"
  }

  return {
    ...car,
    garageStatus: normalizedStatus,
    statusText: getStatusText(car.status, car.statusText),
    statusClass: statusClassMap[normalizedStatus] || "status-idle"
  }
}

function sortCars(carList) {
  return carList
    .slice()
    .sort((prev, next) => {
      const prevSort = Number(prev.sort || 0)
      const nextSort = Number(next.sort || 0)
      if (prevSort > 1000000 || nextSort > 1000000) {
        return nextSort - prevSort
      }

      return prevSort - nextSort
    })
    .map(attachStatusClass)
}

function buildCategoriesWithCount(carList) {
  const countMap = {}

  carList.forEach((car) => {
    const categoryId = String(car.category || "").trim()
    if (!categoryId) {
      return
    }

    countMap[categoryId] = (countMap[categoryId] || 0) + 1
  })

  const baseCategories = mockCategories
    .map((item) => ({
      id: String(item && item.id ? item.id : "").trim(),
      name: String(item && item.name ? item.name : "").trim()
    }))
    .filter((item) => item.id)

  const baseCategoryIds = baseCategories.map((item) => item.id)

  const dynamicCategories = Object.keys(countMap)
    .filter((id) => !baseCategoryIds.includes(id))
    .sort()
    .map((id) => ({
      id,
      name: CATEGORY_LABEL_MAP[id] || id,
      count: countMap[id]
    }))

  const mergedBase = baseCategories.map((item) => ({
    id: item.id,
    name: item.name || CATEGORY_LABEL_MAP[item.id] || item.id,
    count: countMap[item.id] || 0
  }))

  return [
    {
      id: "all",
      name: "全部",
      count: carList.length
    }
  ]
    .concat(mergedBase)
    .concat(dynamicCategories)
}

function buildCategorySummary(categoryId, categories, filteredCars) {
  const currentCategory = categories.find((category) => category.id === categoryId) || {}
  const availableCars = filteredCars.filter((car) => normalizeGarageStatus(car.status) === "idle").length

  return {
    name: currentCategory.name || "",
    total: filteredCars.length,
    available: availableCars
  }
}

Page({
  data: {
    pageTitle: "极境车库",
    pageSubtitle: "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页",
    emptyText: "当前分类暂无车辆，更多车型即将入库",
    loadError: false,
    loadErrorText: "车辆列表加载失败，请稍后重试",
    categorySummary: {
      name: "",
      total: 0,
      available: 0
    },
    servicePhone: "15715710090",
    currentCategory: "all",
    categories: [],
    cars: [],
    filteredCars: [],
    initialLoading: true,
    loadingCars: false,
    page: 0,
    pageSize: 20,
    total: 0,
    truncated: false,
    hasMore: false
  },

  onLoad() {
    trackEvent("garage_view")
    const app = getApp()
    const env =
      app &&
      app.globalData &&
      app.globalData.cloudEnvId
        ? app.globalData.cloudEnvId
        : undefined

    if (wx.cloud && typeof wx.cloud.init === "function") {
      try {
        wx.cloud.init({
          env,
          traceUser: true
        })
      } catch (error) {}
    }

  },

  onShow() {
    this.loadOperationConfig()
    this.loadCars()
  },

  loadOperationConfig() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return
    }

    wx.cloud.callFunction({
      name: "operationConfigGet",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.config) {
          return
        }

        this.setData({
          pageTitle: result.config.garagePageTitle || this.data.pageTitle,
          pageSubtitle: result.config.garagePageSubtitle || this.data.pageSubtitle,
          servicePhone: result.config.servicePhone || this.data.servicePhone
        })
      },
      fail: () => {}
    })
  },

  loadCars(input) {
    const append = Boolean(input && input.append)
    const nextPage = append ? this.data.page + 1 : 0
    if (this.data.loadingCars) {
      return
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setCarsLoadError("云能力未初始化，请稍后重试")
      return
    }

    this.setData({
      loadingCars: true
    })

    wx.cloud.callFunction({
      name: "garageVehicleList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !Array.isArray(result.list)) {
          this.setCarsLoadError((result && result.message) || "车辆列表加载失败，请稍后重试")
          return
        }

        const nextCars = append ? this.data.cars.concat(result.list) : result.list
        this.applyCars(nextCars, {
          page: Number.isInteger(result.page) ? result.page : nextPage,
          total: Number(result.total) || nextCars.length,
          truncated: Boolean(result.truncated),
          hasMore: Boolean(result.hasMore)
        })
      },
      fail: (error) => {
        if (append) {
          this.setData({
            loadingCars: false
          })
          wx.showToast({
            title: (error && (error.errMsg || error.message)) || "加载更多失败",
            icon: "none"
          })
          return
        }
        this.setCarsLoadError((error && (error.errMsg || error.message)) || "车辆列表加载失败，请稍后重试")
      }
    })
  },

  setCarsLoadError(message) {
    this.setData({
      loadError: true,
      initialLoading: false,
      loadingCars: false,
      loadErrorText: String(message || "车辆列表加载失败，请稍后重试"),
      categories: [],
      cars: [],
      filteredCars: [],
      page: 0,
      total: 0,
      truncated: false,
      hasMore: false,
      categorySummary: {
        name: "",
        total: 0,
        available: 0
      }
    })
  },

  applyCars(carList, pagination) {
    const uniqueCars = []
    const ids = new Set()
    ;(Array.isArray(carList) ? carList : []).forEach((car) => {
      const id = String((car && car.id) || "").trim()
      if (!id || ids.has(id)) {
        return
      }
      ids.add(id)
      uniqueCars.push(car)
    })
    const sortedCars = sortCars(uniqueCars)
    const categories = buildCategoriesWithCount(sortedCars)
    const categoryIds = categories.map((item) => item.id)
    const nextCategory = categoryIds.includes(this.data.currentCategory) ? this.data.currentCategory : "all"

    this.setData({
      loadError: false,
      initialLoading: false,
      loadingCars: false,
      categories,
      cars: sortedCars,
      page: pagination && Number.isInteger(pagination.page) ? pagination.page : 0,
      total: pagination ? pagination.total : sortedCars.length,
      truncated: Boolean(pagination && pagination.truncated),
      hasMore: Boolean(pagination && pagination.hasMore)
    })

    this.filterCars(nextCategory)
  },

  filterCars(categoryId) {
    const nextCategory = categoryId || "all"
    const filteredCars =
      nextCategory === "all"
        ? this.data.cars.slice()
        : this.data.cars.filter((car) => car.category === nextCategory)

    this.setData({
      currentCategory: nextCategory,
      filteredCars,
      categorySummary: buildCategorySummary(nextCategory, this.data.categories, filteredCars)
    })
  },

  handleCategoryTap(event) {
    const { categoryId } = event.currentTarget.dataset

    if (!categoryId || categoryId === this.data.currentCategory) {
      return
    }

    this.filterCars(categoryId)
  },

  handleLoadMore() {
    if (this.data.loadingCars || !this.data.hasMore) {
      return
    }

    this.loadCars({ append: true })
  },

  handleCarTap(event) {
    const detail = event.detail || {}
    const carId = detail.carId || event.currentTarget.dataset.carId

    if (!carId) {
      return
    }

    wx.navigateTo({
      url: `/pages/car-detail/car-detail?carId=${carId}`
    })
  },

  handlePhoneCall() {
    wx.makePhoneCall({
      phoneNumber: this.data.servicePhone,
      fail: () => {
        wx.showToast({
          title: `请联系客服：${this.data.servicePhone}`,
          icon: "none"
        })
      }
    })
  },

  handleMineTap() {
    wx.navigateTo({
      url: "/pages/mine/mine"
    })
  },

  handleRetryLoad() {
    this.loadCars()
  },

  onShareAppMessage() {
    return {
      title: "极境车库",
      path: "/pages/garage/garage"
    }
  }
})
