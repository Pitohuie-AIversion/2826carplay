const mockCars = require("../../data/cars")
const mockCategories = require("../../data/categories")

const CATEGORY_LABEL_MAP = {
  all: "全部",
  sedan: "轿车",
  suv: "SUV",
  mpv: "MPV",
  sports: "跑车",
  truck: "卡车",
  other: "其他"
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

  const dynamicCategories = Object.keys(countMap)
    .sort()
    .map((id) => ({
      id,
      name: CATEGORY_LABEL_MAP[id] || id,
      count: countMap[id]
    }))

  return [
    {
      id: "all",
      name: "全部",
      count: carList.length
    }
  ].concat(dynamicCategories)
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
    categorySummary: {
      name: "",
      total: 0,
      available: 0
    },
    servicePhone: "4008001234",
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

    this.loadCars()
  },

  onShow() {
    this.loadCars()
  },

  loadCars() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.applyCars(mockCars)
      return
    }

    wx.cloud.callFunction({
      name: "garageVehicleList",
      data: {},
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !Array.isArray(result.list)) {
          this.applyCars(mockCars)
          return
        }

        this.applyCars(result.list)
      },
      fail: () => {
        this.applyCars(mockCars)
      }
    })
  },

  applyCars(carList) {
    const sortedCars = sortCars(Array.isArray(carList) ? carList : [])
    const categories = buildCategoriesWithCount(sortedCars)
    const categoryIds = categories.map((item) => item.id)
    const nextCategory = categoryIds.includes(this.data.currentCategory) ? this.data.currentCategory : "all"

    this.setData({
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

  onShareAppMessage() {
    return {
      title: "极境车库",
      path: "/pages/garage/garage"
    }
  }
})
