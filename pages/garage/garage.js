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

function getStatusText(status, fallbackText) {
  const statusTextMap = {
    available: "在库",
    rented: "在用",
    maintenance: "维护中",
    reserved: "已预约"
  }

  return statusTextMap[status] || fallbackText || "在库"
}

function attachStatusClass(car) {
  const statusClassMap = {
    available: "status-available",
    rented: "status-rented",
    maintenance: "status-maintenance",
    reserved: "status-reserved"
  }

  return {
    ...car,
    statusText: getStatusText(car.status, car.statusText),
    statusClass: statusClassMap[car.status] || "status-available"
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
  const availableCars = filteredCars.filter((car) => car.status === "available").length

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
    filteredCars: []
  },

  onLoad() {
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

    this.loadOperationConfig()
    this.loadCars()
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

  loadCars() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setCarsLoadError("云能力未初始化，请稍后重试")
      return
    }

    wx.cloud.callFunction({
      name: "garageVehicleList",
      data: {},
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !Array.isArray(result.list)) {
          this.setCarsLoadError((result && result.message) || "车辆列表加载失败，请稍后重试")
          return
        }

        this.applyCars(result.list)
      },
      fail: (error) => {
        this.setCarsLoadError((error && (error.errMsg || error.message)) || "车辆列表加载失败，请稍后重试")
      }
    })
  },

  setCarsLoadError(message) {
    this.setData({
      loadError: true,
      loadErrorText: String(message || "车辆列表加载失败，请稍后重试"),
      categories: [],
      cars: [],
      filteredCars: [],
      categorySummary: {
        name: "",
        total: 0,
        available: 0
      }
    })
  },

  applyCars(carList) {
    const sortedCars = sortCars(Array.isArray(carList) ? carList : [])
    const categories = buildCategoriesWithCount(sortedCars)
    const categoryIds = categories.map((item) => item.id)
    const nextCategory = categoryIds.includes(this.data.currentCategory) ? this.data.currentCategory : "all"

    this.setData({
      loadError: false,
      categories,
      cars: sortedCars
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
