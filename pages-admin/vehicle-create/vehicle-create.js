const vehicleUtils = require("../../shared/vehicle")
const { toDiscountTiers, discountFormMethods } = require("../rentalDiscountForm")
const { buildVehicleFormProgress } = require("../../shared/vehicleFormProgress")
const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { clearUnsaved, markUnsaved } = require("../../shared/unsavedChanges")
const { activatePageNativeActions, beginPageNativeAction, cancelPageNativeActions, isPageNativeActionActive, isPageCurrent } = require("../../shared/pageNativeAction")
const VEHICLE_CREATE_TIMEOUT_MS = 20 * 1000
const {
  VEHICLE_TYPE_LABEL_MAP,
  STATUS_LABEL_MAP,
  TRANSMISSION_LABEL_MAP,
  FUEL_TYPE_LABEL_MAP
} = require("../../shared/vehicleLabels")
const DRIVETRAIN_OPTIONS = [
  "前置前驱 (FF)",
  "前置后驱 (FR)",
  "中置后驱 (MR)",
  "后置后驱 (RR)",
  "前置四驱 (4WD)",
  "全时四驱 (AWD)",
  "分时四驱 (Part-Time 4WD)",
  "智能四驱",
  "后轮驱动 (RWD)",
  "前轮驱动 (FWD)",
  "双电机四驱",
  "三电机四驱"
]
const FIELD_LABEL_MAP = {
  plateNumber: "车牌号",
  vehicleType: "车辆类型",
  brandModel: "品牌型号",
  registerDate: "注册日期",
  status: "使用状态",
  location: "城市",
  transmission: "变速箱",
  fuelType: "燃油类型",
  seats: "座位数",
  priceDay: "日租金",
  rentalDiscountTiers: "连租折扣",
  vin: "VIN",
  engineNumber: "发动机号",
  publicDescription: "公开说明",
  publicDrivingTips: "人工用车提示",
  archiveDate: "保养到期日",
  archiveReview: "年检到期日",
  note: "内部备注",
  "performance.acceleration": "百公里加速",
  "performance.horsepower": "最大马力",
  "performance.drivetrain": "驱动方式",
  "performance.torque": "最大扭矩"
}
function formatDate(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}
function buildLabels(values, map) {
  return values.map((value) => map[value] || value)
}
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
      } catch (error) {}
    }
    requirePagePermission(this, {
      required: "canManageVehicles",
      noPermissionMessage: "无权访问新增车辆",
      onAuthorized: () => {}
    })
  },
  onUnload() {
    cancelPageNativeActions(this)
    this._createdVehiclePending = null
    cancelPagePermissionCheck(this)
    this._vehicleCreateUnloaded = true
    this._vehicleCreateRequestId = Number(this._vehicleCreateRequestId || 0) + 1
    this.clearVehicleCreateTimer()
  },
  onShow() {
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
    let value = event.detail.value
    if (field === "brandModel") {
      value = String(value || "").slice(0, 50)
    }
    if (field === "location") {
      value = String(value || "").slice(0, 20)
    }
    if (field === "vin" || field === "engineNumber") {
      value = String(value || "").slice(0, 32)
    }
    if (field === "publicDrivingTips") {
      value = String(value || "").slice(0, 500)
    }
    if (field === "publicDescription" || field === "note") {
      value = String(value || "").slice(0, 200)
    }
    if (field === "seats") {
      value = String(value || "").replace(/\D/g, "").slice(0, 1)
    }
    if (field === "priceDay") {
      value = String(value || "").replace(/\D/g, "").slice(0, 5)
    }
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
    if (!["archiveDate", "archiveReview", "publicMaterialsUpdatedDate", "publicInspectionDate", "performance.drivetrain", "transmission", "fuelType"].includes(field)) return
    const patch = { [`form.${field}`]: "" }
    if (field === "performance.drivetrain") {
      patch.drivetrainIndex = -1
      patch.drivetrainLabel = ""
    }
    if (field === "transmission" || field === "fuelType") {
      patch[`${field}Index`] = 0
      patch[`${field}Label`] = ""
    }
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
    let value = event.detail.value
    if (inner === "acceleration") {
      value = String(value || "").replace(/[^\d.s秒]/g, "").slice(0, 12)
    } else if (inner === "horsepower") {
      value = String(value || "").replace(/[^\d.kKwWpPsShH匹马力千瓦]/g, "").slice(0, 16)
    } else if (inner === "torque") {
      value = String(value || "").replace(/[^\d.nN·mM牛米]/g, "").slice(0, 18)
    } else {
      value = String(value || "").slice(0, 30)
    }
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
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ isSubmitting: false })
      wx.showToast({
        title: formatToastTitle(message, "新增失败"),
        icon: "none"
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
        wx.showToast({
          title,
          icon: "none"
        })
        this.setData({
          isSubmitting: false
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
