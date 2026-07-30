const { trackEvent } = require("../../shared/analytics")

function formatDate(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")

  return `${year}-${month}-${day}`
}

function createBookingRequestId() {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 14)
  return `${timestamp}-${random}`
}

Page({
  data: {
    carId: "",
    carName: "",
    loadingCar: true,
    loadError: false,
    loadErrorText: "车辆信息加载失败，请稍后重试",
    today: formatDate(new Date()),
    endMinDate: formatDate(new Date()),
    notFoundText: "未找到该车辆，请返回车库重新选择",
    submitText: "预约信息已提交，客服将尽快联系您",
    submitButtonText: "提交预约",
    isSubmitting: false,
    submitRequestId: "",
    privacyAgreed: false,
    cityOptions: [],
    cityIndex: -1,
    pickerCityIndex: 0,
    bookingStatusTemplateId: "",
    subscriptionEnabled: false,
    availabilityState: "idle",
    availabilityText: "选好取还车日期后，将自动查看同期咨询情况",
    availabilityConflictCount: 0,
    privacyTip:
      "提交预约即表示您同意我们仅将所填信息用于本次车辆预约沟通与联系确认。您可在【我的预约】查看、修改联系信息与取消；如需查询、更正或删除其他个人信息，请前往【个人信息申请】。车辆档期、价格、押金及取还车规则以客服最终确认为准。",
    form: {
      userName: "",
      phone: "",
      startDate: "",
      endDate: "",
      city: "",
      note: ""
    }
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

    this.loadOperationConfig()
    this.loadBookingCar(carId)
    trackEvent("booking_start", carId)
  },

  loadOperationConfig() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return
    }

    this.setData({
      loadingCar: true,
      loadError: false
    })

    wx.cloud.callFunction({
      name: "operationConfigGet",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.config) {
          return
        }

        this.setData({
          privacyTip: result.config.bookingPrivacyTip || this.data.privacyTip,
          cityOptions: Array.isArray(result.config.cityOptions) ? result.config.cityOptions : [],
          bookingStatusTemplateId: String(result.config.bookingStatusTemplateId || "").trim(),
          subscriptionEnabled: Boolean(String(result.config.bookingStatusTemplateId || "").trim())
        })

        this.syncCitySelection()
      },
      fail: () => {}
    })
  },

  loadBookingCar(carId) {
    if (!carId) {
      this.applyCar(null)
      return
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setLoadError("云能力未初始化，请稍后重试")
      return
    }

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

        this.setLoadError((result && result.message) || "车辆信息加载失败，请稍后重试")
      },
      fail: (error) => {
        this.setLoadError((error && (error.errMsg || error.message)) || "车辆信息加载失败，请稍后重试")
      }
    })
  },

  setLoadError(message) {
    this.setData({
      loadingCar: false,
      loadError: true,
      loadErrorText: String(message || "车辆信息加载失败，请稍后重试"),
      carName: ""
    })

    wx.setNavigationBarTitle({
      title: "预约咨询"
    })
  },

  applyCar(car) {
    this.setData({
      loadingCar: false,
      loadError: false,
      carName: car ? car.name || "" : "",
      "form.city": car ? car.location || "" : ""
    })

    this.syncCitySelection()

    wx.setNavigationBarTitle({
      title: car ? `${car.name} 预约` : "预约咨询"
    })
  },

  syncCitySelection() {
    const cityOptions = Array.isArray(this.data.cityOptions) ? this.data.cityOptions : []
    const currentCity = String((this.data.form && this.data.form.city) || "").trim()
    const cityIndex = cityOptions.indexOf(currentCity)

    if (!currentCity && cityOptions.length) {
      this.setData({
        cityIndex: 0,
        pickerCityIndex: 0,
        "form.city": cityOptions[0]
      })
      return
    }

    this.setData({
      cityIndex,
      pickerCityIndex: cityIndex >= 0 ? cityIndex : 0
    })
  },

  handleInput(event) {
    const { field } = event.currentTarget.dataset
    let value = event.detail.value

    if (!field) {
      return
    }

    if (field === "phone") {
      value = String(value || "").replace(/\D/g, "").slice(0, 11)
    }

    this.setData({
      [`form.${field}`]: value,
      submitRequestId: ""
    })
  },

  handleDateChange(event) {
    const { field } = event.currentTarget.dataset
    const value = event.detail.value

    if (!field) {
      return
    }

    if (field === "startDate") {
      const nextData = {
        "form.startDate": value,
        endMinDate: value,
        submitRequestId: ""
      }

      if (this.data.form.endDate && this.data.form.endDate < value) {
        nextData["form.endDate"] = ""
      }

      this.setData(nextData)
      this.checkVehicleAvailability()
      return
    }

    this.setData({
      [`form.${field}`]: value,
      submitRequestId: ""
    })
    this.checkVehicleAvailability()
  },

  resetAvailability() {
    this.availabilityRequestSerial = Number(this.availabilityRequestSerial || 0) + 1
    this.setData({
      availabilityState: "idle",
      availabilityText: "选好取还车日期后，将自动查看同期咨询情况",
      availabilityConflictCount: 0
    })
  },

  checkVehicleAvailability() {
    const form = this.data.form || {}
    const vehicleId = String(this.data.carId || "").trim()
    const startDate = String(form.startDate || "").trim()
    const endDate = String(form.endDate || "").trim()

    if (!vehicleId || !startDate || !endDate || endDate < startDate) {
      this.resetAvailability()
      return
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        availabilityState: "unknown",
        availabilityText: "暂时无法查看档期，仍可提交并由顾问确认",
        availabilityConflictCount: 0
      })
      return
    }

    const requestSerial = Number(this.availabilityRequestSerial || 0) + 1
    this.availabilityRequestSerial = requestSerial
    this.setData({
      availabilityState: "checking",
      availabilityText: "正在查看同期咨询情况…",
      availabilityConflictCount: 0
    })

    wx.cloud.callFunction({
      name: "vehicleAvailabilityCheck",
      data: {
        vehicleId,
        startDate,
        endDate
      },
      success: (res) => {
        if (requestSerial !== this.availabilityRequestSerial) {
          return
        }

        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            availabilityState: "unknown",
            availabilityText: (result && result.message) || "暂时无法查看档期，仍可提交并由顾问确认",
            availabilityConflictCount: 0
          })
          return
        }

        const conflictCount = Math.max(0, Number(result.conflictCount || 0))
        this.setData({
          availabilityState:
            result.available === true
              ? "clear"
              : conflictCount > 0
                ? "conflict"
                : "unknown",
          availabilityText: result.message || "档期请以顾问最终确认为准",
          availabilityConflictCount: conflictCount
        })
      },
      fail: () => {
        if (requestSerial !== this.availabilityRequestSerial) {
          return
        }
        this.setData({
          availabilityState: "unknown",
          availabilityText: "档期查询暂时失败，仍可提交并由顾问确认",
          availabilityConflictCount: 0
        })
      }
    })
  },

  handleCityChange(event) {
    const index = Number(event.detail && event.detail.value)
    const cityOptions = Array.isArray(this.data.cityOptions) ? this.data.cityOptions : []
    if (!Number.isInteger(index) || index < 0 || index >= cityOptions.length) {
      return
    }

    this.setData({
      cityIndex: index,
      pickerCityIndex: index,
      "form.city": cityOptions[index],
      submitRequestId: ""
    })
  },

  validateForm() {
    const form = this.data.form

    if (!this.data.carId || !this.data.carName) {
      return "未找到该车辆，请返回车库重新选择"
    }

    if (!form.userName.trim()) {
      return "请输入姓名"
    }

    if (!form.phone.trim()) {
      return "请输入手机号"
    }

    if (!/^1\d{10}$/.test(form.phone.trim())) {
      return "请输入正确的 11 位手机号"
    }

    if (!form.startDate) {
      return "请选择取车日期"
    }

    if (!form.endDate) {
      return "请选择还车日期"
    }

    if (form.endDate < form.startDate) {
      return "还车日期不能早于取车日期"
    }

    if (!this.data.privacyAgreed) {
      return "请先阅读并同意隐私政策"
    }

    return ""
  },

  handlePrivacyAgreementChange(event) {
    const values = event && event.detail && Array.isArray(event.detail.value) ? event.detail.value : []
    this.setData({
      privacyAgreed: values.includes("agreed")
    })
  },

  handleOpenPrivacyPolicy() {
    wx.navigateTo({
      url: "/pages/content-page/content-page?type=privacy",
      fail: () => {
        wx.showToast({
          title: "隐私政策打开失败",
          icon: "none"
        })
      }
    })
  },

  requestStatusSubscription(done) {
    const next = typeof done === "function" ? done : () => {}
    const templateId = String(this.data.bookingStatusTemplateId || "").trim()
    if (!templateId || typeof wx.requestSubscribeMessage !== "function") {
      next()
      return
    }

    let continued = false
    const continueSubmit = () => {
      if (continued) {
        return
      }
      continued = true
      next()
    }

    try {
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        complete: continueSubmit
      })
    } catch (error) {
      continueSubmit()
    }
  },

  handleSubmit() {
    if (this.data.isSubmitting) {
      return
    }

    const errorMessage = this.validateForm()

    if (errorMessage) {
      wx.showToast({
        title: errorMessage,
        icon: "none"
      })
      return
    }

    const defaultCity = this.data.form.city
    const requestId = this.data.submitRequestId || createBookingRequestId()

    this.setData({
      isSubmitting: true,
      submitButtonText: "提交中",
      submitRequestId: requestId
    })

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })

      this.setData({
        isSubmitting: false,
        submitButtonText: "提交预约"
      })
      return
    }

    this.requestStatusSubscription(() => {
      wx.cloud.callFunction({
      name: "bookingCreate",
      data: {
        vehicleId: this.data.carId,
        userName: this.data.form.userName,
        phone: this.data.form.phone,
        startDate: this.data.form.startDate,
        endDate: this.data.form.endDate,
        city: this.data.form.city,
        note: this.data.form.note,
        requestId
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "预约提交失败",
            icon: "none"
          })
          this.setData({
            isSubmitting: false,
            submitButtonText: "提交预约"
          })
          return
        }

        wx.showToast({
          title: this.data.submitText,
          icon: "none",
          duration: 2500
        })
        trackEvent("booking_submit", this.data.carId)

        setTimeout(() => {
          this.setData({
            isSubmitting: false,
            submitButtonText: "提交预约",
            submitRequestId: "",
            privacyAgreed: false,
            form: {
              userName: "",
              phone: "",
              startDate: "",
              endDate: "",
              city: defaultCity,
              note: ""
            },
            endMinDate: this.data.today,
            availabilityState: "idle",
            availabilityText: "选好取还车日期后，将自动查看同期咨询情况",
            availabilityConflictCount: 0
          })
        }, 2500)
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "预约提交失败",
          icon: "none"
        })
        this.setData({
          isSubmitting: false,
          submitButtonText: "提交预约"
        })
      }
    })
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
    this.loadBookingCar(this.data.carId)
  }
})
