const vehicleUtils = require("../../shared/vehicle")
const { toDiscountTiers, discountFormMethods } = require("../rentalDiscountForm")
const {
  buildVehicleFormProgress,
  cleanVehicleTextInput,
  cleanPerformanceValue,
  getClearOptionalFieldPatch
} = require("../../shared/vehicleFormProgress")
const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { clearUnsaved, disposeUnsavedChanges, markUnsaved, syncUnsavedChanges } = require("../../shared/unsavedChanges")
const { activatePageNativeActions, beginPageNativeAction, cancelPageNativeActions, isPageNativeActionActive, isPageCurrent } = require("../../shared/pageNativeAction")
const VEHICLE_CREATE_TIMEOUT_MS = 20 * 1000
const {
  VEHICLE_TYPE_LABEL_MAP,
  STATUS_LABEL_MAP,
  TRANSMISSION_LABEL_MAP,
  FUEL_TYPE_LABEL_MAP,
  FIELD_LABEL_MAP,
  buildLabels
} = require("../../shared/vehicleLabels")
const { formatDate } = require("../../shared/dateUtils")
const DRIVETRAIN_OPTIONS = vehicleUtils.DRIVETRAIN_OPTIONS
Page({
  ...discountFormMethods,
  data: {
    discountRows: [],
    today: formatDate(new Date()),
    isSubmitting: false,
    publicDescriptionLength: 0,
    noteLength: 0,
    formProgress: buildVehicleFormProgress({}),
    pageAuthorized: false,
    vehicleTypeLabels: buildLabels(vehicleUtils.VEHICLE_TYPES, VEHICLE_TYPE_LABEL_MAP),
    statusLabels: buildLabels(vehicleUtils.VEHICLE_STATUSES, STATUS_LABEL_MAP),
    transmissionLabels: buildLabels(vehicleUtils.TRANSMISSION_TYPES, TRANSMISSION_LABEL_MAP),
    fuelTypeLabels: buildLabels(vehicleUtils.FUEL_TYPES, FUEL_TYPE_LABEL_MAP),
    drivetrainOptions: DRIVETRAIN_OPTIONS,
    vehicleTypeIndex: 0,
    statusIndex: 0,
    transmissionIndex: 0,
    fuelTypeIndex: 0,
    drivetrainIndex: -1,
    vehicleTypeLabel: "",
    statusLabel: "",
    transmissionLabel: "",
    fuelTypeLabel: "",
    drivetrainLabel: "",
    form: {
      plateNumber: "",
      vehicleType: "",
      brandModel: "",
      registerDate: "",
      status: "",
      location: "",
      transmission: "",
      fuelType: "",
      seats: "",
      priceDay: "",
      vin: "",
      engineNumber: "",
      publicDescription: "",
      publicDrivingTips: "",
      archiveDate: "",
      archiveReview: "",
      note: "",
      performance: {
        acceleration: "",
        horsepower: "",
        drivetrain: "",
        torque: "",
        highlights: ["", "", "", ""]
      }
    }
  },
  navigateToImageManage(id) {
    if (!this.isVehicleCreateActive()) {
      return
    }
    if (!id) {
      this.finishSubmitFlow()
      return
    }
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.redirectTo({
      url: `/pages-admin/vehicle-detail-manage/vehicle-detail-manage?id=${id}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.navigateTo({
          url: `/pages-admin/vehicle-detail-manage/vehicle-detail-manage?id=${id}`,
          fail: () => {
            if (!isPageNativeActionActive(this, action)) return
            wx.showToast({ title: "图片管理打开失败", icon: "none" })
            this.finishSubmitFlow()
          }
        })
      }
    })
  },
  finishSubmitFlow() {
    if (!this.isVehicleCreateActive()) {
      return
    }
    const action = beginPageNativeAction(this, { requireCurrent: true })
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          if (!isPageNativeActionActive(this, action)) {
            return
          }
          wx.redirectTo({
            url: "/pages/mine/mine",
            fail: () => {
              if (!isPageNativeActionActive(this, action)) {
                return
              }
              wx.reLaunch({
                url: "/pages/mine/mine",
                fail: () => {
                  if (!isPageNativeActionActive(this, action)) {
                    return
                  }
                  this.setData({ isSubmitting: false })
                  wx.showToast({
                    title: "返回我的页面失败",
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
      url: "/pages/mine/mine",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.reLaunch({
          url: "/pages/mine/mine",
          fail: () => {
            if (!isPageNativeActionActive(this, action)) {
              return
            }
            this.setData({ isSubmitting: false })
            wx.showToast({
              title: "返回我的页面失败",
              icon: "none"
            })
          }
        })
      }
    })
  },
  onLoad() {
    activatePageNativeActions(this)
    this._vehicleCreateUnloaded = false
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
      } catch (error) { console.error(error) }
    }
    requirePagePermission(this, {
      required: "canManageVehicles",
      noPermissionMessage: "无权访问新增车辆",
      onAuthorized: () => {}
    })
  },
  onUnload() {
    disposeUnsavedChanges(this)
    cancelPageNativeActions(this)
    this._createdVehiclePending = null
    this._vehicleCreateDeferredResult = null
    cancelPagePermissionCheck(this)
    this._vehicleCreateUnloaded = true
    this._vehicleCreateRequestId = Number(this._vehicleCreateRequestId || 0) + 1
    this.clearVehicleCreateTimer()
  },
  onShow() {
    syncUnsavedChanges(this)
    const pending = this._vehicleCreateDeferredResult
    if (pending) {
      this._vehicleCreateDeferredResult = null
      pending()
      return
    }
    this.showCreatedVehiclePrompt()
  },
  showCreatedVehiclePrompt() {
    const pending = this._createdVehiclePending
    if (!pending || pending.requestId !== this._vehicleCreateRequestId || !this.isVehicleCreateActive() || !isPageCurrent(this)) return
    const action = beginPageNativeAction(this, { requireCurrent: true, exclusiveKey: "vehicle-create-result" })
    const finish = (uploadImages) => {
      if (!isPageNativeActionActive(this, action) || this._createdVehiclePending !== pending) return
      this._createdVehiclePending = null
      if (uploadImages) this.navigateToImageManage(pending.id)
      else this.finishSubmitFlow()
    }
    wx.showModal({
      title: "新增成功",
      content: "车辆已创建，是否现在上传车辆图片？",
      confirmText: "去上传",
      confirmColor: "#528fff",
      cancelText: "稍后",
      success: (result) => {
        if (!isPageNativeActionActive(this, action)) return
        finish(Boolean(result && result.confirm))
      },
      fail: () => {
        if (!isPageNativeActionActive(this, action)) return
        finish(false)
      }
    })
  },
  handlePlateInput(event) {
    if (this.data.isSubmitting) {
      return
    }
    let value = vehicleUtils.normalizePlateNumber(event.detail.value)
    value = value.replace(/\s/g, "")
    value = value.replace(/[^0-9A-Z\u4e00-\u9fa5]/g, "").slice(0, 8)
    this.setData({
      "form.plateNumber": value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, plateNumber: value })
    })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleTextInput(event) {
    if (this.data.isSubmitting) {
      return
    }
    const { field } = event.currentTarget.dataset
    if (!field) {
      return
    }
    const value = cleanVehicleTextInput(field, event.detail.value)
    const nextData = {
      [`form.${field}`]: value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, [field]: value })
    }
    if (field === "publicDescription") {
      nextData.publicDescriptionLength = String(value || "").length
    }
    if (field === "note") {
      nextData.noteLength = String(value || "").length
    }
    this.setData(nextData)
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleVehicleTypeChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.VEHICLE_TYPES[index] || ""
    const label = VEHICLE_TYPE_LABEL_MAP[value] || ""
    this.setData({
      vehicleTypeIndex: index,
      vehicleTypeLabel: label,
      "form.vehicleType": value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, vehicleType: value })
    })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleStatusChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.VEHICLE_STATUSES[index] || ""
    const label = STATUS_LABEL_MAP[value] || ""
    this.setData({
      statusIndex: index,
      statusLabel: label,
      "form.status": value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, status: value })
    })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleDateChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const value = event.detail.value
    this.setData({
      "form.registerDate": value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, registerDate: value })
    })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleTransmissionChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.TRANSMISSION_TYPES[index] || ""
    const label = TRANSMISSION_LABEL_MAP[value] || ""
    this.setData({
      transmissionIndex: index,
      transmissionLabel: label,
      "form.transmission": value
    })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleFuelTypeChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.FUEL_TYPES[index] || ""
    const label = FUEL_TYPE_LABEL_MAP[value] || ""
    this.setData({
      fuelTypeIndex: index,
      fuelTypeLabel: label,
      "form.fuelType": value
    })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleDueDateChange(event) {
    if (this.data.isSubmitting) return
    const field = String(event.currentTarget.dataset.field || "")
    if (!["archiveDate", "archiveReview"].includes(field)) return
    this.setData({ [`form.${field}`]: event.detail.value })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleClearOptionalField(event) {
    if (this.data.isSubmitting) return
    const field = String(event.currentTarget.dataset.field || "")
    const patch = getClearOptionalFieldPatch(field)
    if (!patch) return
    this.setData(patch)
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleDrivetrainChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const index = Number(event.detail.value)
    if (!Number.isFinite(index) || index < 0 || index >= DRIVETRAIN_OPTIONS.length) {
      return
    }
    const value = DRIVETRAIN_OPTIONS[index] || ""
    const next = {
      drivetrainIndex: index,
      drivetrainLabel: value,
      "form.performance.drivetrain": value
    }
    this.setData(next)
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handlePerformanceTextInput(event) {
    if (this.data.isSubmitting) {
      return
    }
    const { field } = event.currentTarget.dataset
    if (!field || field.indexOf("performance.") !== 0) {
      return
    }
    const inner = field.slice("performance.".length)
    const value = cleanPerformanceValue(inner, event.detail.value)
    const next = { [`form.performance.${inner}`]: value }
    this.setData(next)
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleHighlightInput(event) {
    if (this.data.isSubmitting) {
      return
    }
    const { index } = event.currentTarget.dataset
    const idx = Number(index)
    if (!Number.isInteger(idx) || idx < 0) {
      return
    }
    const highlights = (this.data.form && this.data.form.performance && Array.isArray(this.data.form.performance.highlights))
      ? this.data.form.performance.highlights.slice()
      : []
    while (highlights.length <= idx) {
      highlights.push("")
    }
    highlights[idx] = String(event.detail.value || "").slice(0, 20)
    this.setData({ "form.performance.highlights": highlights })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleAddHighlight() {
    if (this.data.isSubmitting) {
      return
    }
    const highlights = (this.data.form && this.data.form.performance && Array.isArray(this.data.form.performance.highlights))
      ? this.data.form.performance.highlights.slice()
      : []
    if (highlights.length >= 8) {
      wx.showToast({ title: "配置标签最多 8 项", icon: "none" })
      return
    }
    highlights.push("")
    this.setData({ "form.performance.highlights": highlights })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleRemoveHighlight(event) {
    if (this.data.isSubmitting) {
      return
    }
    const { index } = event.currentTarget.dataset
    const idx = Number(index)
    if (!Number.isInteger(idx) || idx < 0) {
      return
    }
    const highlights = (this.data.form && this.data.form.performance && Array.isArray(this.data.form.performance.highlights))
      ? this.data.form.performance.highlights.slice()
      : []
    if (idx >= highlights.length) {
      return
    }
    highlights.splice(idx, 1)
    if (highlights.length < 4) {
      while (highlights.length < 4) {
        highlights.push("")
      }
    }
    this.setData({ "form.performance.highlights": highlights })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  getValidationMessage(result) {
    const details = result && result.details
    const errors = details && details.errors
    const first = Array.isArray(errors) ? errors[0] : null
    if (!first) {
      return (result && result.message) || "参数校验失败"
    }
    const fieldLabel = FIELD_LABEL_MAP[first.field] || first.field
    const message = first.message ? `${fieldLabel}：${first.message}` : fieldLabel
    return message.length > 30 ? message.slice(0, 30) : message
  },
  buildSubmitPayload() {
    const form = { ...this.data.form, rentalDiscountTiers: toDiscountTiers(this.data.discountRows) }
    const perf = form.performance && typeof form.performance === "object" ? form.performance : null
    if (!perf) {
      return form
    }
    const cleanPerf = vehicleUtils.normalizePerformanceInput(perf)
    const cleanForm = Object.assign({}, form)
    cleanForm.performance = cleanPerf
    return cleanForm
  },
  handleSubmit() {
    if (this.data.isSubmitting) {
      return
    }
    const payload = this.buildSubmitPayload()
    const check = vehicleUtils.validateVehicle(payload)
    if (!check.ok) {
      wx.showToast({
        title: formatToastTitle(this.getValidationMessage(check), "车辆信息有误"),
        icon: "none"
      })
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }
    const requestId = Number(this._vehicleCreateRequestId || 0) + 1
    this._vehicleCreateRequestId = requestId
    const action = beginPageNativeAction(this, { requireCurrent: true })
    this.clearVehicleCreateTimer()
    this.setData({ isSubmitting: true })
    let settled = false
    const isCurrent = () => this._vehicleCreateRequestId === requestId
    const finishRequest = () => {
      if (settled || !isCurrent()) {
        return false
      }
      settled = true
      this.clearVehicleCreateTimer()
      return true
    }
    const deliverResult = (callback) => {
      if (!isCurrent()) return
      if (!isPageNativeActionActive(this, action)) {
        this._vehicleCreateDeferredResult = () => deliverResult(callback)
        return
      }
      callback()
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      deliverResult(() => {
        this.setData({ isSubmitting: false })
        wx.showToast({
          title: formatToastTitle(message, "新增失败"),
          icon: "none"
        })
      })
    }
    this._vehicleCreateTimer = setTimeout(() => {
      handleFailure("新增超时，请重试")
    }, VEHICLE_CREATE_TIMEOUT_MS)
    const requestOptions = {
      name: "vehicleCreate",
      data: check.value,
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        deliverResult(() => {
          const result = res && res.result ? res.result : null
          if (result && result.ok) {
            clearUnsaved(this)
            this._createdVehiclePending = { id: result.id, requestId }
            this.showCreatedVehiclePrompt()
            return
          }
          const title =
            result &&
            result.code === "VALIDATION_ERROR" &&
            result.details &&
            result.details.errors
              ? this.getValidationMessage(result)
              : (result && result.message) || "新增失败"
          wx.showToast({ title, icon: "none" })
          this.setData({ isSubmitting: false })
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
  clearVehicleCreateTimer() {
    if (this._vehicleCreateTimer) {
      clearTimeout(this._vehicleCreateTimer)
      this._vehicleCreateTimer = null
    }
  },
  isVehicleCreateActive() {
    return this._vehicleCreateUnloaded !== true
  }
})
