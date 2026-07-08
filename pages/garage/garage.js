// Phase 9 note:
// 当前首页直接读取本地 mock 数据。
// 后续接入云数据库时，可在这里替换为云端读取或统一数据服务层，
// 但 filteredCars / currentCategory / carId 跳转逻辑应保持不变。
const cars = require("../../data/cars")
const categories = require("../../data/categories")

function getStatusText(status, fallbackText) {
  const statusTextMap = {
    available: "在库",
    rented: "已租出",
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

function buildCategoriesWithCount(categoryList, carList) {
  return categoryList.map((category) => {
    const count = carList.filter((car) => car.category === category.id).length

    return {
      ...category,
      count
    }
  })
}

Page({
  data: {
    pageTitle: "极境车库",
    pageSubtitle: "精选个性车型，预约你的下一次驾驶体验",
    emptyText: "当前分类暂无车辆，更多车型即将入库",
    categorySummary: {
      name: "",
      total: 0,
      available: 0
    },
    servicePhone: "4008001234",
    currentCategory: "mini_fun",
    categories: [],
    cars: [],
    filteredCars: []
  },

  onLoad() {
    const sortedCars = cars
      .slice()
      .sort((prev, next) => prev.sort - next.sort)
      .map(attachStatusClass)

    this.setData({
      categories: buildCategoriesWithCount(categories, sortedCars),
      cars: sortedCars
    })

    this.filterCars(this.data.currentCategory)
  },

  filterCars(categoryId) {
    const filteredCars = this.data.cars.filter((car) => car.category === categoryId)
    const currentCategory = this.data.categories.find((category) => category.id === categoryId) || {}
    const availableCars = filteredCars.filter((car) => car.status === "available").length

    this.setData({
      currentCategory: categoryId,
      filteredCars,
      categorySummary: {
        name: currentCategory.name || "",
        total: filteredCars.length,
        available: availableCars
      }
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
