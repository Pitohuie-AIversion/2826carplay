const { trackEvent } = require("../../shared/analytics")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const LAST_BOOKING_CONTACT_KEY = "lastBookingContact"
const BOOKING_CAR_LOAD_TIMEOUT_MS = 15 * 1000
const AVAILABILITY_CHECK_TIMEOUT_MS = 12 * 1000
const BOOKING_SUBMIT_TIMEOUT_MS = 15 * 1000

function formatDate(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")

  return `${year}-${month}-${day}`
}

function addDays(dateText, days) {
  const base = dateText ? new Date(`${dateText}T00:00:00`) : new Date()
  base.setDate(base.getDate() + Number(days || 0))
  return formatDate(base)
}

function createBookingRequestId() {
  const timestamp = Date.now().toString(36)
  const random = Math.random().toString(36).slice(2, 14)
  return `${timestamp}-${random}`
}

function buildFormProgress(form, privacyAgreed) {
  const source = form && typeof form === "object" ? form : {}
  const checks = [
    { key: "userName", label: "填写姓名", complete: Boolean(String(source.userName || "").trim()) },
    {
      key: "phone",
      label: "填写正确手机号",
      complete: /^1\d{10}$/.test(String(source.phone || "").trim())
    },
    {
      key: "startDate",
      label: "选择取车日期",
      complete: Boolean(String(source.startDate || "").trim())
    },
    {
      key: "endDate",
      label: "选择有效还车日期",
      complete: Boolean(
        source.startDate &&
          source.endDate &&
          String(source.endDate) >= String(source.startDate)
      )
    },
    { key: "privacy", label: "阅读并同意隐私政策", complete: Boolean(privacyAgreed) }
  ]
  const completed = checks.filter((item) => item.complete).length
  const nextCheck = checks.find((item) => !item.complete)
  const contactComplete = checks[0].complete && checks[1].complete
  const datesComplete = checks[2].complete && checks[3].complete
  const privacyComplete = checks[4].complete
  const ready = completed === checks.length

  return {
    completed,
    total: checks.length,
    percent: Math.round((completed / checks.length) * 100),
    ready,
    userNameComplete: checks[0].complete,
    phoneComplete: checks[1].complete,
    startDateComplete: checks[2].complete,
    endDateComplete: checks[3].complete,
    privacyComplete,
    nextLabel: nextCheck ? nextCheck.label : "可以提交预约",
    submitHint: ready ? "信息已完整，可以提交预约" : `还需完成：${nextCheck.label}`,
    contactStepClass: contactComplete ? "form-step-complete" : "form-step-current",
    dateStepClass: datesComplete
      ? "form-step-complete"
      : contactComplete
        ? "form-step-current"
        : "form-step-upcoming",
    privacyStepClass: privacyComplete
      ? "form-step-complete"
      : contactComplete && datesComplete
        ? "form-step-current"
        : "form-step-upcoming"
  }
}

function formatBookingDate(value) {
  const text = String(value || "").trim()
  const match = text.match(/^\d{4}-(\d{2})-(\d{2})$/)
  return match ? `${match[1]}月${match[2]}日` : "—"
}

function maskPhone(value) {
  const phone = String(value || "").trim()
  return /^1\d{10}$/.test(phone)
    ? `${phone.slice(0, 3)}****${phone.slice(-4)}`
    : phone || "—"
}

function getDateSpanText(startDate, endDate) {
  const start = new Date(`${String(startDate || "")}T00:00:00`)
  const end = new Date(`${String(endDate || "")}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return "待选择日期"
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86400000)
  return days === 0 ? "当日取还" : `${days} 天跨度`
}

function buildBookingSummary(form, carName) {
  const source = form && typeof form === "object" ? form : {}
  const hasDates = Boolean(source.startDate && source.endDate && source.endDate >= source.startDate)

  return {
    carName: String(carName || "").trim() || "—",
    dateText: hasDates
      ? `${formatBookingDate(source.startDate)} → ${formatBookingDate(source.endDate)}`
      : "待选择日期",
    durationText: getDateSpanText(source.startDate, source.endDate),
    contactText: String(source.userName || "").trim()
      ? `${String(source.userName).trim()} · ${maskPhone(source.phone)}`
      : maskPhone(source.phone),
    cityText: String(source.city || "").trim() || "待顾问确认"
  }
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
    submitSuccess: false,
    submittedBookingId: "",
    submittedSummary: null,
    submitRequestId: "",
    privacyAgreed: false,
    formProgress: buildFormProgress(null, false),
    bookingSummary: buildBookingSummary(null, ""),
    cityOptions: [],
    cityIndex: -1,
    pickerCityIndex: 0,
    bookingStatusTemplateId: "",
    subscriptionEnabled: false,
    savedContactAvailable: false,
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

    this.loadSavedContact()
    this.loadOperationConfig()
    this.loadBookingCar(carId)
    trackEvent("booking_start", carId)
  },

  loadSavedContact() {
    if (typeof wx.getStorageSync !== "function") {
      return
    }
    try {
      const saved = wx.getStorageSync(LAST_BOOKING_CONTACT_KEY)
      this._savedContact = saved && typeof saved === "object" ? saved : null
      this.setData({
        savedContactAvailable: Boolean(
          this._savedContact &&
          String(this._savedContact.userName || "").trim() &&
          /^1\d{10}$/.test(String(this._savedContact.phone || "").trim())
        )
      })
    } catch (error) {}
  },

  handleUseSavedContact() {
    if (this.data.isSubmitting) {
      return
    }
    const saved = this._savedContact
    if (!saved) {
      return
    }
    const nextForm = {
      ...this.data.form,
      userName: String(saved.userName || "").trim().slice(0, 20),
      phone: String(saved.phone || "").replace(/\D/g, "").slice(0, 11)
    }
    this.setData({
      "form.userName": nextForm.userName,
      "form.phone": nextForm.phone,
      formProgress: buildFormProgress(nextForm, this.data.privacyAgreed),
      bookingSummary: buildBookingSummary(nextForm, this.data.carName),
      submitRequestId: ""
    })
    wx.showToast({ title: "已填入上次联系人", icon: "none" })
  },

  loadOperationConfig() {
    this.cancelOperationConfigRequest()
    this._cancelOperationConfigRequest = requestOperationConfig({
      onSuccess: (config) => {
        this.setData({
          privacyTip: config.bookingPrivacyTip || this.data.privacyTip,
          cityOptions: Array.isArray(config.cityOptions) ? config.cityOptions : [],
          bookingStatusTemplateId: String(config.bookingStatusTemplateId || "").trim(),
          subscriptionEnabled: Boolean(String(config.bookingStatusTemplateId || "").trim())
        })

        this.syncCitySelection()
      }
    })
  },

  loadBookingCar(carId) {
    const requestId = Number(this._bookingCarRequestId || 0) + 1
    this._bookingCarRequestId = requestId
    if (this._bookingCarLoadTimer) {
      clearTimeout(this._bookingCarLoadTimer)
      this._bookingCarLoadTimer = null
    }

    if (!carId) {
      this.applyCar(null)
      return
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setLoadError("云能力未初始化，请稍后重试")
      return
    }

    this.setData({
      loadingCar: true,
      loadError: false
    })

    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._bookingCarRequestId) {
        return false
      }
      settled = true
      if (this._bookingCarLoadTimer) {
        clearTimeout(this._bookingCarLoadTimer)
        this._bookingCarLoadTimer = null
      }
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setLoadError(message)
    }

    this._bookingCarLoadTimer = setTimeout(() => {
      handleFailure("车辆信息加载超时，请检查网络后重试")
    }, BOOKING_CAR_LOAD_TIMEOUT_MS)

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

        this.setLoadError((result && result.message) || "车辆信息加载失败，请稍后重试")
      },
      fail: (error) => {
        handleFailure((error && (error.errMsg || error.message)) || "车辆信息加载失败，请稍后重试")
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure((error && (error.errMsg || error.message)) || "车辆信息加载失败，请稍后重试")
    }
  },

  onUnload() {
    cancelPageNativeActions(this)
    this._bookingCarRequestId = Number(this._bookingCarRequestId || 0) + 1
    this.availabilityRequestSerial = Number(this.availabilityRequestSerial || 0) + 1
    this._bookingSubmitSerial = Number(this._bookingSubmitSerial || 0) + 1
    this.cancelOperationConfigRequest()
    if (this._bookingCarLoadTimer) {
      clearTimeout(this._bookingCarLoadTimer)
      this._bookingCarLoadTimer = null
    }
    this.clearAvailabilityCheckTimer()
    this.clearBookingSubmitTimer()
  },

  cancelOperationConfigRequest() {
    if (typeof this._cancelOperationConfigRequest === "function") {
      this._cancelOperationConfigRequest()
      this._cancelOperationConfigRequest = null
    }
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
    const carName = car ? car.name || "" : ""
    const nextForm = {
      ...this.data.form,
      city: car ? car.location || "" : ""
    }
    this.setData({
      loadingCar: false,
      loadError: false,
      carName,
      "form.city": nextForm.city,
      bookingSummary: buildBookingSummary(nextForm, carName)
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

    this.setData({
      cityIndex,
      pickerCityIndex: cityIndex >= 0 ? cityIndex : 0
    })
  },

  handleInput(event) {
    if (this.data.isSubmitting) {
      return
    }
    const { field } = event.currentTarget.dataset
    let value = event.detail.value

    if (!field) {
      return
    }

    if (field === "phone") {
      value = String(value || "").replace(/\D/g, "").slice(0, 11)
    }

    const nextForm = {
      ...this.data.form,
      [field]: value
    }
    this.setData({
      [`form.${field}`]: value,
      submitRequestId: "",
      formProgress: buildFormProgress(nextForm, this.data.privacyAgreed),
      bookingSummary: buildBookingSummary(nextForm, this.data.carName)
    })
  },

  handleDateChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const { field } = event.currentTarget.dataset
    const value = event.detail.value

    if (!field) {
      return
    }

    if (field === "startDate") {
      const nextForm = {
        ...this.data.form,
        startDate: value
      }
      const nextData = {
        "form.startDate": value,
        endMinDate: value,
        submitRequestId: ""
      }

      if (this.data.form.endDate && this.data.form.endDate < value) {
        nextData["form.endDate"] = ""
        nextForm.endDate = ""
      }

      nextData.formProgress = buildFormProgress(nextForm, this.data.privacyAgreed)
      nextData.bookingSummary = buildBookingSummary(nextForm, this.data.carName)
      this.setData(nextData)
      this.checkVehicleAvailability()
      return
    }

    const nextForm = {
      ...this.data.form,
      [field]: value
    }
    this.setData({
      [`form.${field}`]: value,
      submitRequestId: "",
      formProgress: buildFormProgress(nextForm, this.data.privacyAgreed),
      bookingSummary: buildBookingSummary(nextForm, this.data.carName)
    })
    this.checkVehicleAvailability()
  },

  handleDateShortcut(event) {
    if (this.data.isSubmitting) {
      return
    }
    const action = String(event.currentTarget.dataset.action || "")
    const today = this.data.today
    const nextForm = { ...this.data.form }
    if (action === "today" || action === "tomorrow") {
      nextForm.startDate = action === "today" ? today : addDays(today, 1)
      if (nextForm.endDate && nextForm.endDate < nextForm.startDate) {
        nextForm.endDate = ""
      }
    } else if (action === "three-days") {
      nextForm.startDate = nextForm.startDate || today
      nextForm.endDate = addDays(nextForm.startDate, 3)
    } else {
      return
    }

    this.setData({
      "form.startDate": nextForm.startDate,
      "form.endDate": nextForm.endDate,
      endMinDate: nextForm.startDate || today,
      submitRequestId: "",
      formProgress: buildFormProgress(nextForm, this.data.privacyAgreed),
      bookingSummary: buildBookingSummary(nextForm, this.data.carName)
    }, () => this.checkVehicleAvailability())
  },

  resetAvailability() {
    this.availabilityRequestSerial = Number(this.availabilityRequestSerial || 0) + 1
    this.clearAvailabilityCheckTimer()
    this.setData({
      availabilityState: "idle",
      availabilityText: "选好取还车日期后，将自动查看同期咨询情况",
      availabilityConflictCount: 0
    })
  },

  clearAvailabilityCheckTimer() {
    if (!this._availabilityCheckTimer) {
      return
    }
    clearTimeout(this._availabilityCheckTimer)
    this._availabilityCheckTimer = null
  },

  clearBookingSubmitTimer() {
    if (!this._bookingSubmitTimer) {
      return
    }
    clearTimeout(this._bookingSubmitTimer)
    this._bookingSubmitTimer = null
  },

  checkVehicleAvailability() {
    if (this.data.isSubmitting) {
      return
    }
    const form = this.data.form || {}
    const vehicleId = String(this.data.carId || "").trim()
    const startDate = String(form.startDate || "").trim()
    const endDate = String(form.endDate || "").trim()

    if (!vehicleId || !startDate || !endDate || endDate < startDate) {
      this.resetAvailability()
      return
    }

    const requestSerial = Number(this.availabilityRequestSerial || 0) + 1
    this.availabilityRequestSerial = requestSerial
    this.clearAvailabilityCheckTimer()

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        availabilityState: "unknown",
        availabilityText: "暂时无法查看档期，仍可提交并由顾问确认",
        availabilityConflictCount: 0
      })
      return
    }

    this.setData({
      availabilityState: "checking",
      availabilityText: "正在查看同期咨询情况…",
      availabilityConflictCount: 0
    })

    let settled = false
    const finishRequest = () => {
      if (settled || requestSerial !== this.availabilityRequestSerial) {
        return false
      }
      settled = true
      this.clearAvailabilityCheckTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        availabilityState: "unknown",
        availabilityText: message || "档期查询暂时失败，仍可提交并由顾问确认",
        availabilityConflictCount: 0
      })
    }

    this._availabilityCheckTimer = setTimeout(() => {
      handleFailure("档期查询超时，仍可提交并由顾问确认")
    }, AVAILABILITY_CHECK_TIMEOUT_MS)

    const requestOptions = {
      name: "vehicleAvailabilityCheck",
      data: {
        vehicleId,
        startDate,
        endDate
      },
      success: (res) => {
        if (!finishRequest()) {
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
        handleFailure()
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure()
    }
  },

  handleCityChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const index = Number(event.detail && event.detail.value)
    const cityOptions = Array.isArray(this.data.cityOptions) ? this.data.cityOptions : []
    if (!Number.isInteger(index) || index < 0 || index >= cityOptions.length) {
      return
    }

    const nextForm = {
      ...this.data.form,
      city: cityOptions[index]
    }
    this.setData({
      cityIndex: index,
      pickerCityIndex: index,
      "form.city": cityOptions[index],
      submitRequestId: "",
      bookingSummary: buildBookingSummary(nextForm, this.data.carName)
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
    if (this.data.isSubmitting) {
      return
    }
    const values = event && event.detail && Array.isArray(event.detail.value) ? event.detail.value : []
    const privacyAgreed = values.includes("agreed")
    this.setData({
      privacyAgreed,
      formProgress: buildFormProgress(this.data.form, privacyAgreed)
    })
  },

  handleOpenPrivacyPolicy() {
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: "/pages/content-page/content-page?type=privacy",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
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
        title: formatToastTitle(errorMessage, "预约信息有误"),
        icon: "none"
      })
      return
    }

    const requestId = this.data.submitRequestId || createBookingRequestId()
    const submittedVehicleId = String(this.data.carId || "").trim()
    const submittedForm = {
      ...this.data.form
    }
    const submittedSummary = {
      ...this.data.bookingSummary
    }
    const submitSerial = Number(this._bookingSubmitSerial || 0) + 1
    this._bookingSubmitSerial = submitSerial

    this.setData({
      isSubmitting: true,
      submitButtonText: "正在提交",
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
      if (submitSerial !== this._bookingSubmitSerial) {
        return
      }

      let settled = false
      const finishRequest = () => {
        if (settled || submitSerial !== this._bookingSubmitSerial) {
          return false
        }
        settled = true
        this.clearBookingSubmitTimer()
        return true
      }
      const handleFailure = (message) => {
        if (!finishRequest()) {
          return
        }
        wx.showToast({
          title: formatToastTitle(message, "预约提交失败"),
          icon: "none"
        })
        this.setData({
          isSubmitting: false,
          submitButtonText: "提交预约"
        })
      }

      this._bookingSubmitTimer = setTimeout(() => {
        handleFailure("提交超时，请重试")
      }, BOOKING_SUBMIT_TIMEOUT_MS)

      const requestOptions = {
        name: "bookingCreate",
        data: {
          vehicleId: submittedVehicleId,
          userName: submittedForm.userName,
          phone: submittedForm.phone,
          startDate: submittedForm.startDate,
          endDate: submittedForm.endDate,
          city: submittedForm.city,
          note: submittedForm.note,
          requestId
        },
        success: (res) => {
          if (!finishRequest()) {
            return
          }
          const result = res && res.result ? res.result : null
          if (!result || !result.ok) {
            wx.showToast({
              title: formatToastTitle(result && result.message, "预约提交失败"),
              icon: "none"
            })
            this.setData({
              isSubmitting: false,
              submitButtonText: "提交预约"
            })
            return
          }

          trackEvent("booking_submit", submittedVehicleId)
          if (typeof wx.setStorageSync === "function") {
            try {
              wx.setStorageSync(LAST_BOOKING_CONTACT_KEY, {
                userName: String(submittedForm.userName || "").trim(),
                phone: String(submittedForm.phone || "").trim()
              })
            } catch (error) {}
          }
          this.setData({
            isSubmitting: false,
            submitButtonText: "提交预约",
            submitSuccess: true,
            submittedBookingId: String(result.id || "").trim(),
            submittedSummary
          })
          wx.setNavigationBarTitle({
            title: "预约已提交"
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
    })
  },

  handleViewSubmittedBooking() {
    const id = String(this.data.submittedBookingId || "").trim()
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: id
        ? `/pages/booking-detail/booking-detail?id=${id}`
        : "/pages/bookings/bookings",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "预约记录打开失败",
          icon: "none"
        })
      }
    })
  },

  handleContinueBrowse() {
    const action = beginPageNativeAction(this)
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
    if (this.data.loadingCar || this.data.isSubmitting) {
      return
    }
    this.loadBookingCar(this.data.carId)
  }
})
