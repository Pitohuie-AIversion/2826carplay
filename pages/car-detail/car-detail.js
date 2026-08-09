const { trackEvent } = require("../../shared/analytics")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const CAR_DETAIL_LOAD_TIMEOUT_MS = 15 * 1000
const FAVORITE_STATUS_TIMEOUT_MS = 10 * 1000
const FAVORITE_UPDATE_TIMEOUT_MS = 12 * 1000

function getStatusText(status, fallbackText) {
  const statusTextMap = {
    available: "可预约",
    rented: "使用中",
    maintenance: "维护中",
    reserved: "已预约"
  }

  return statusTextMap[status] || fallbackText || "可预约"
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
    unknown: "—"
  }

  const fuelTypeMap = {
    gasoline: "燃油",
    electric: "纯电",
    hybrid: "混动",
    unknown: "—"
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

  const actionHintMap = {
    available: "提交意向后，由顾问确认档期、价格与服务规则",
    reserved: "可先登记候补意向，由顾问协助确认档期",
    rented: "可先咨询后续档期，由顾问联系确认时间",
    maintenance: "可先咨询恢复时间或获取相近车型推荐"
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
    actionHintText:
      actionHintMap[car.status] || "提交意向后，由顾问确认档期、价格与服务规则",
    transmissionText: transmissionMap[car.transmission] || car.transmission || "—",
    fuelTypeText: fuelTypeMap[car.fuelType] || car.fuelType || "—",
    seatsText: car.seatsText || (car.seats ? `${car.seats} 座` : "—"),
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
    serviceSteps: [
      { key: "request", index: "01", title: "提交意向", desc: "填写日期与联系方式" },
      { key: "confirm", index: "02", title: "顾问确认", desc: "核对档期、价格和规则" },
      { key: "delivery", index: "03", title: "安排交付", desc: "确认取还车时间与方式" }
    ],
    rentalTips: [
      "车辆价格、可用时间、押金和取还车规则以客服最终确认为准。",
      "提交预约后，客服将与您确认车辆档期和具体租赁细节。"
    ]
  },

  onLoad(options) {
    activatePageNativeActions(this)
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

    this.loadOperationConfig()
    this.loadCarDetail(carId)
    this.loadFavoriteStatus(carId)
    trackEvent("vehicle_detail", carId)
  },

  loadOperationConfig() {
    this.cancelOperationConfigRequest()
    this._cancelOperationConfigRequest = requestOperationConfig({
      onSuccess: (config) => {
        const servicePhone =
          String(config.servicePhone || "").trim()

        if (servicePhone) {
          this.setData({
            servicePhone
          })
        }
      }
    })
  },

  loadFavoriteStatus(carId) {
    const requestId = Number(this._favoriteStatusRequestId || 0) + 1
    this._favoriteStatusRequestId = requestId
    this.clearFavoriteStatusTimer()
    if (!carId || !wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return
    }
    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._favoriteStatusRequestId) {
        return false
      }
      settled = true
      this.clearFavoriteStatusTimer()
      return true
    }

    this._favoriteStatusTimer = setTimeout(() => {
      finishRequest()
    }, FAVORITE_STATUS_TIMEOUT_MS)

    const requestOptions = {
      name: "favoriteStatus",
      data: {
        vehicleId: carId
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (result && result.ok) {
          this.setData({
            favorited: Boolean(result.favorited)
          })
        }
      },
      fail: () => {
        finishRequest()
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      finishRequest()
    }
  },

  loadCarDetail(carId) {
    const requestId = Number(this._carDetailRequestId || 0) + 1
    this._carDetailRequestId = requestId
    this.clearCarDetailLoadTimer()

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

    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._carDetailRequestId) {
        return false
      }
      settled = true
      this.clearCarDetailLoadTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setLoadError(message || "车辆详情加载失败，请返回车库后重试")
    }

    this._carDetailLoadTimer = setTimeout(() => {
      handleFailure("车辆详情加载超时，请检查网络后重试")
    }, CAR_DETAIL_LOAD_TIMEOUT_MS)

    const requestOptions = {
      name: "vehiclePublicDetail",
      data: {
        id: carId
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
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
        handleFailure((error && (error.errMsg || error.message)) || "车辆详情加载失败，请返回车库后重试")
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure((error && (error.errMsg || error.message)) || "车辆详情加载失败，请返回车库后重试")
    }
  },

  clearCarDetailLoadTimer() {
    if (!this._carDetailLoadTimer) {
      return
    }
    clearTimeout(this._carDetailLoadTimer)
    this._carDetailLoadTimer = null
  },

  onUnload() {
    cancelPageNativeActions(this)
    this._carDetailRequestId = Number(this._carDetailRequestId || 0) + 1
    this._favoriteStatusRequestId = Number(this._favoriteStatusRequestId || 0) + 1
    this._favoriteUpdateSerial = Number(this._favoriteUpdateSerial || 0) + 1
    this.cancelOperationConfigRequest()
    this.clearCarDetailLoadTimer()
    this.clearFavoriteStatusTimer()
    this.clearFavoriteUpdateTimer()
  },

  cancelOperationConfigRequest() {
    if (typeof this._cancelOperationConfigRequest === "function") {
      this._cancelOperationConfigRequest()
      this._cancelOperationConfigRequest = null
    }
  },

  clearFavoriteStatusTimer() {
    if (this._favoriteStatusTimer) {
      clearTimeout(this._favoriteStatusTimer)
      this._favoriteStatusTimer = null
    }
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
    const car = this.data.car
    const imageCount = car && Array.isArray(car.imageItems) ? car.imageItems.length : 0
    this.setData({
      currentImageIndex:
        Number.isInteger(current) && current >= 0 && current < imageCount ? current : 0
    })
  },

  handleHeroImageTap(event) {
    const car = this.data.car
    if (!car || !Array.isArray(car.images) || !car.images.length) {
      return
    }
    const index = Number(event.currentTarget.dataset.index)
    const currentIndex =
      Number.isInteger(index) && index >= 0 && index < car.images.length
        ? index
        : this.data.currentImageIndex
    const current = car.images[currentIndex] || car.images[0]

    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.previewImage({
      current,
      urls: car.images,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "图片预览失败",
          icon: "none"
        })
      }
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
    const vehicleId = String(this.data.carId || "").trim()
    const updateSerial = Number(this._favoriteUpdateSerial || 0) + 1
    this._favoriteUpdateSerial = updateSerial
    this._favoriteStatusRequestId = Number(this._favoriteStatusRequestId || 0) + 1
    this.clearFavoriteStatusTimer()
    this.clearFavoriteUpdateTimer()
    this.setData({ favoriteLoading: true })

    let settled = false
    const finishRequest = () => {
      if (settled || updateSerial !== this._favoriteUpdateSerial) {
        return false
      }
      settled = true
      this.clearFavoriteUpdateTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ favoriteLoading: false })
      wx.showToast({
        title: formatToastTitle(message, "收藏操作失败"),
        icon: "none"
      })
    }

    this._favoriteUpdateTimer = setTimeout(() => {
      handleFailure("收藏请求超时，请重试")
    }, FAVORITE_UPDATE_TIMEOUT_MS)

    const requestOptions = {
      name: "favoriteSet",
      data: {
        vehicleId,
        favorited: nextFavorited
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ favoriteLoading: false })
          wx.showToast({
            title: formatToastTitle(result && result.message, "收藏操作失败"),
            icon: "none"
          })
          return
        }
        this.setData({
          favorited: Boolean(result.favorited),
          favoriteLoading: false
        })
        if (result.favorited) {
          trackEvent("favorite_add", vehicleId)
        }
        wx.showToast({
          title: result.favorited ? "已加入收藏" : "已取消收藏",
          icon: "success"
        })
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  clearFavoriteUpdateTimer() {
    if (!this._favoriteUpdateTimer) {
      return
    }
    clearTimeout(this._favoriteUpdateTimer)
    this._favoriteUpdateTimer = null
  },

  handleBookingTap() {
    if (!this.data.carId) {
      return
    }

    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages/booking/booking?carId=${this.data.carId}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "预约页面打开失败",
          icon: "none"
        })
      }
    })
  },

  handlePhoneCall() {
    const phone = String(this.data.servicePhone || "").trim()
    if (!phone) {
      wx.showToast({
        title: "客服电话暂不可用",
        icon: "none"
      })
      return
    }

    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: (error) => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        const message = error && (error.errMsg || error.message)
        if (message && String(message).includes("cancel")) {
          return
        }
        wx.showModal({
          title: "拨号失败",
          content: `请联系客服：${phone}`,
          confirmText: "知道了",
          confirmColor: "#528fff",
          showCancel: false
        })
      }
    })
  },

  handleBackGarage() {
    const action = beginPageNativeAction(this)
    const pages = getCurrentPages()

    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          if (!isPageNativeActionActive(this, action)) {
            return
          }
          wx.redirectTo({
            url: "/pages/garage/garage",
            fail: () => {
              if (!isPageNativeActionActive(this, action)) {
                return
              }
              wx.reLaunch({
                url: "/pages/garage/garage",
                fail: () => {
                  if (!isPageNativeActionActive(this, action)) {
                    return
                  }
                  wx.showToast({
                    title: "返回车库失败",
                    icon: "none"
                  })
                }
              })
            }
          })
        }
      })
      return
    }

    wx.redirectTo({
      url: "/pages/garage/garage",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.reLaunch({
          url: "/pages/garage/garage",
          fail: () => {
            if (!isPageNativeActionActive(this, action)) {
              return
            }
            wx.showToast({
              title: "返回车库失败",
              icon: "none"
            })
          }
        })
      }
    })
  },

  handleRetryLoad() {
    if (this.data.loading || this.data.favoriteLoading) {
      return
    }
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
