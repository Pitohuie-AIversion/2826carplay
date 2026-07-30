const { trackEvent } = require("../../shared/analytics")

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

function formatCarViewModel(car) {
  const transmissionMap = {
    manual: "手动挡",
    automatic: "自动挡",
    unknown: "--"
  }

  const fuelTypeMap = {
    gasoline: "燃油",
    electric: "纯电",
    hybrid: "混动",
    unknown: "--"
  }

  const statusNoticeMap = {
    available: "",
    reserved: "该车当前已被预约，可先提交咨询，由客服为您确认候补档期或推荐相近车型。",
    rented: "该车当前正在使用中，可先提交咨询，由客服为您确认可预约时间。",
    maintenance: "该车当前维护中，可先提交咨询，由客服为您确认恢复时间或推荐相近车型。"
  }

  const primaryActionTextMap = {
    available: "立即预约",
    reserved: "咨询候补",
    rented: "咨询档期",
    maintenance: "咨询恢复时间"
  }

  const statusCar = attachStatusClass(car)
  const images = Array.isArray(car.images) && car.images.length ? car.images : car.cover ? [car.cover] : []
  const imageItems = images.map((src, index) => ({
    key: `vehicle-image-${index}`,
    src,
    loaded: false,
    failed: false
  }))

  return {
    ...statusCar,
    images,
    imageItems,
    hasImages: images.length > 0,
    statusNoticeText: statusNoticeMap[car.status] || "",
    primaryActionText: primaryActionTextMap[car.status] || "立即预约",
    transmissionText: transmissionMap[car.transmission] || car.transmission || "--",
    fuelTypeText: fuelTypeMap[car.fuelType] || car.fuelType || "--",
    seatsText: car.seatsText || (car.seats ? `${car.seats} 座` : "--"),
    brand: car.brand || "未知品牌",
    location: car.location || "门店咨询"
  }
}

Page({
  data: {
    servicePhone: "15715710090",
    carId: "",
    car: null,
    currentImageIndex: 0,
    favoriteLoading: false,
    favorited: false,
    loading: true,
    loadError: false,
    loadErrorText: "车辆详情加载失败，请返回车库后重试",
    notFoundText: "未找到该车辆，请返回车库重新选择",
    rentalTips: [
      "车辆价格、可用时间、押金和取还车规则以客服最终确认为准。",
      "提交预约后，客服将与您确认车辆档期和具体租赁细节。"
    ]
  },

  onLoad(options) {
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

    const carId = String((options && options.carId) || "").trim()
    this.setData({
      carId
    })

    this.loadCarDetail(carId)
    this.loadFavoriteStatus(carId)
    trackEvent("vehicle_detail", carId)
  },

  loadFavoriteStatus(carId) {
    if (!carId || !wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return
    }
    wx.cloud.callFunction({
      name: "favoriteStatus",
      data: {
        vehicleId: carId
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (result && result.ok) {
          this.setData({
            favorited: Boolean(result.favorited)
          })
        }
      },
      fail: () => {}
    })
  },

  loadCarDetail(carId) {
    if (!carId) {
      this.applyCar(null)
      return
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setLoadError("云能力未初始化，请稍后重试")
      return
    }

    this.setData({
      loading: true,
      loadError: false
    })

    wx.cloud.callFunction({
      name: "vehiclePublicDetail",
      data: {
        id: carId
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        const car = result && result.ok ? result.car : null
        if (car) {
          this.applyCar(car)
          return
        }

        if (result && result.code === "NOT_FOUND") {
          this.applyCar(null)
          return
        }

        this.setLoadError((result && result.message) || "车辆详情加载失败，请返回车库后重试")
      },
      fail: (error) => {
        this.setLoadError((error && (error.errMsg || error.message)) || "车辆详情加载失败，请返回车库后重试")
      }
    })
  },

  setLoadError(message) {
    this.setData({
      car: null,
      currentImageIndex: 0,
      loading: false,
      loadError: true,
      loadErrorText: String(message || "车辆详情加载失败，请返回车库后重试")
    })

    wx.setNavigationBarTitle({
      title: "车辆详情"
    })
  },

  applyCar(targetCar) {
    if (!targetCar) {
      this.setData({
        car: null,
        currentImageIndex: 0,
        loading: false,
        loadError: false
      })
      wx.setNavigationBarTitle({
        title: "车辆详情"
      })
      return
    }

    this.setData({
      car: formatCarViewModel(targetCar),
      currentImageIndex: 0,
      loading: false,
      loadError: false
    })

    wx.setNavigationBarTitle({
      title: targetCar.name || "车辆详情"
    })
  },

  handleHeroImageLoad(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) {
      return
    }

    this.setData({
      [`car.imageItems[${index}].loaded`]: true,
      [`car.imageItems[${index}].failed`]: false
    })
  },

  handleHeroImageError(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) {
      return
    }

    this.setData({
      [`car.imageItems[${index}].loaded`]: false,
      [`car.imageItems[${index}].failed`]: true
    })
  },

  handleHeroSwiperChange(event) {
    const current = Number(event && event.detail && event.detail.current)
    this.setData({
      currentImageIndex: Number.isInteger(current) && current >= 0 ? current : 0
    })
  },

  handleFavoriteTap() {
    if (!this.data.carId || this.data.favoriteLoading) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const nextFavorited = !this.data.favorited
    this.setData({ favoriteLoading: true })
    wx.cloud.callFunction({
      name: "favoriteSet",
      data: {
        vehicleId: this.data.carId,
        favorited: nextFavorited
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "收藏操作失败",
            icon: "none"
          })
          return
        }
        this.setData({
          favorited: Boolean(result.favorited)
        })
        if (result.favorited) {
          trackEvent("favorite_add", this.data.carId)
        }
        wx.showToast({
          title: result.favorited ? "已加入收藏" : "已取消收藏",
          icon: "success"
        })
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "收藏操作失败",
          icon: "none"
        })
      },
      complete: () => {
        this.setData({ favoriteLoading: false })
      }
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

  handleRetryLoad() {
    this.loadCarDetail(this.data.carId)
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
