function formatDate(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")

  return `${year}-${month}-${day}`
}

Page({
  data: {
    carId: "",
    carName: "",
    loadError: false,
    loadErrorText: "车辆信息加载失败，请稍后重试",
    today: formatDate(new Date()),
    endMinDate: formatDate(new Date()),
    notFoundText: "未找到该车辆，请返回车库重新选择",
    submitText: "预约信息已提交，客服将尽快联系您",
    submitButtonText: "提交预约",
    isSubmitting: false,
    cityOptions: [],
    cityIndex: -1,
    pickerCityIndex: 0,
    privacyTip:
      "提交预约即表示您同意我们仅将所填信息用于本次车辆预约沟通与联系确认。您可在【我的预约】查看与取消；如需删除预约记录或个人信息，请联系管理员处理。车辆档期、价格、押金及取还车规则以客服最终确认为准。",
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
          privacyTip: result.config.bookingPrivacyTip || this.data.privacyTip,
          cityOptions: Array.isArray(result.config.cityOptions) ? result.config.cityOptions : []
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
      [`form.${field}`]: value
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
        endMinDate: value
      }

      if (this.data.form.endDate && this.data.form.endDate < value) {
        nextData["form.endDate"] = ""
      }

      this.setData(nextData)
      return
    }

    this.setData({
      [`form.${field}`]: value
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
      "form.city": cityOptions[index]
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

    return ""
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

    this.setData({
      isSubmitting: true,
      submitButtonText: "提交中"
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

    wx.cloud.callFunction({
      name: "bookingCreate",
      data: {
        vehicleId: this.data.carId,
        userName: this.data.form.userName,
        phone: this.data.form.phone,
        startDate: this.data.form.startDate,
        endDate: this.data.form.endDate,
        city: this.data.form.city,
        note: this.data.form.note
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

        setTimeout(() => {
          this.setData({
            isSubmitting: false,
            submitButtonText: "提交预约",
            form: {
              userName: "",
              phone: "",
              startDate: "",
              endDate: "",
              city: defaultCity,
              note: ""
            },
            endMinDate: this.data.today
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
