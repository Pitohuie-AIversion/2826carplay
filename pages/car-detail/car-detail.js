// Phase 9 note:
// 当前详情页按 carId 从本地 mock 数据中查询车辆。
// 后续如接入云数据库，仍应继续以 carId 作为唯一查询条件，
// 这里只替换数据来源，不改变页面展示结构与跳转逻辑。
const cars = require("../../data/cars")

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

function formatCarViewModel(car) {
  const transmissionMap = {
    manual: "手动挡",
    automatic: "自动挡"
  }

  const fuelTypeMap = {
    gasoline: "燃油",
    electric: "纯电",
    hybrid: "混动"
  }

  const statusNoticeMap = {
    available: "",
    reserved: "该车当前已被预约，可先提交咨询，由客服为您确认候补档期或推荐相近车型。",
    rented: "该车当前已租出，可先提交咨询，由客服为您确认预计归还时间或推荐相近车型。",
    maintenance: "该车当前维护中，可先提交咨询，由客服为您确认恢复时间或推荐相近车型。"
  }

  const primaryActionTextMap = {
    available: "立即预约",
    reserved: "咨询候补",
    rented: "咨询档期",
    maintenance: "咨询恢复时间"
  }

  const statusCar = attachStatusClass(car)

  return {
    ...statusCar,
    statusNoticeText: statusNoticeMap[car.status] || "",
    primaryActionText: primaryActionTextMap[car.status] || "立即预约",
    transmissionText: transmissionMap[car.transmission] || car.transmission || "-",
    fuelTypeText: fuelTypeMap[car.fuelType] || car.fuelType || "-"
  }
}

Page({
  data: {
    servicePhone: "4008001234",
    carId: "",
    car: null,
    notFoundText: "未找到该车辆，请返回车库重新选择",
    rentalTips: [
      "车辆价格、可用时间、押金和取还车规则以客服最终确认为准。",
      "提交预约后，客服将与您确认车辆档期和具体租赁细节。"
    ]
  },

  onLoad(options) {
    const carId = options.carId || ""
    const targetCar = cars.find((item) => item.id === carId)

    if (!targetCar) {
      this.setData({
        carId,
        car: null
      })
      wx.setNavigationBarTitle({
        title: "车辆详情"
      })
      return
    }

    this.setData({
      carId,
      car: formatCarViewModel(targetCar)
    })

    wx.setNavigationBarTitle({
      title: targetCar.name
    })
  },

  handleBookingTap() {
    if (!this.data.carId) {
      return
    }

    wx.navigateTo({
      url: `/pages/booking/booking?carId=${this.data.carId}`
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

  handleBackGarage() {
    const pages = getCurrentPages()

    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.redirectTo({
            url: "/pages/garage/garage"
          })
        }
      })
      return
    }

    wx.redirectTo({
      url: "/pages/garage/garage",
      fail: () => {
        wx.reLaunch({
          url: "/pages/garage/garage"
        })
      }
    })
  },

  onShareAppMessage() {
    const car = this.data.car

    if (!car) {
      return {
        title: "极境车库",
        path: "/pages/garage/garage"
      }
    }

    return {
      title: `${car.nickname} ${car.name}`,
      path: `/pages/car-detail/car-detail?carId=${car.id}`
    }
  }
})
