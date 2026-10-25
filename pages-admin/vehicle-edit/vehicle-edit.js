const vehicleUtils = require("../../shared/vehicle")
const { toDiscountRows, toDiscountTiers, discountFormMethods } = require("../rentalDiscountForm")
const {
  buildVehicleFormProgress,
  cleanVehicleTextInput,
  cleanPerformanceValue,
  getClearOptionalFieldPatch
} = require("../../shared/vehicleFormProgress")
const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { clearUnsaved, disposeUnsavedChanges, markUnsaved, syncUnsavedChanges } = require("../../shared/unsavedChanges")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageCurrent,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const VEHICLE_EDIT_LOAD_TIMEOUT_MS = 15 * 1000
const VEHICLE_EDIT_SUBMIT_TIMEOUT_MS = 20 * 1000
const {
  VEHICLE_TYPE_LABEL_MAP,
  STATUS_LABEL_MAP,
  TRANSMISSION_LABEL_MAP,
  FUEL_TYPE_LABEL_MAP,
  ARCHIVE_REVIEW_LABEL_MAP,
  FIELD_LABEL_MAP,
  buildLabels
} = require("../../shared/vehicleLabels")
const { formatDate } = require("../../shared/dateUtils")
const DRIVETRAIN_OPTIONS = vehicleUtils.DRIVETRAIN_OPTIONS
Page({
  ...discountFormMethods,
  data: {
    discountRows: [],
    id: "",
    today: formatDate(new Date()),
    loading: true,
    loadFailed: false,
    loadErrorText: "车辆档案加载失败，请稍后重试",
    isSubmitting: false,
    publicDescriptionLength: 0,
    noteLength: 0,
    formProgress: buildVehicleFormProgress({}),
    pageAuthorized: false,
    vehicleTypeLabels: buildLabels(vehicleUtils.VEHICLE_TYPES, VEHICLE_TYPE_LABEL_MAP),
    statusLabels: buildLabels(vehicleUtils.VEHICLE_STATUSES, STATUS_LABEL_MAP),
    transmissionLabels: buildLabels(vehicleUtils.TRANSMISSION_TYPES, TRANSMISSION_LABEL_MAP),
    fuelTypeLabels: buildLabels(vehicleUtils.FUEL_TYPES, FUEL_TYPE_LABEL_MAP),
    archiveReviewLabels: buildLabels(vehicleUtils.ARCHIVE_REVIEW_STATUSES, ARCHIVE_REVIEW_LABEL_MAP),
    drivetrainOptions: DRIVETRAIN_OPTIONS,
    vehicleTypeIndex: 0,
    statusIndex: 0,
    transmissionIndex: 0,
    fuelTypeIndex: 0,
    archiveReviewIndex: 0,
    drivetrainIndex: -1,
    vehicleTypeLabel: "",
    statusLabel: "",
    transmissionLabel: "",
    fuelTypeLabel: "",
    archiveReviewLabel: ARCHIVE_REVIEW_LABEL_MAP.pending,
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
      publicMaterialsUpdatedDate: "",
      publicInspectionDate: "",
      publicInspectionSummary: "",
      publicExteriorSummary: "",
      publicInsuranceSummary: "",
      publicAssistanceSummary: "",
      publicArchiveReviewStatus: "pending",
      internalMaintenanceRecord: "",
      internalInspectionRecord: "",
      internalInsuranceRecord: "",
      internalArchiveNote: "",
      performance: {
        acceleration: "",
        horsepower: "",
        drivetrain: "",
        torque: "",
        highlights: ["", "", "", ""]
      }
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
    const id = String((options && options.id) || "").trim()
    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      this.setData({
        loading: false,
        loadFailed: true,
        loadErrorText: "缺少车辆ID，无法加载车辆档案"
      })
      return
    }
    this.setData({ id })
    requirePagePermission(this, {
      required: "canManageVehicles",
      noPermissionMessage: "无权访问编辑车辆",
      onAuthorized: () => {
        this.fetchDetail(id)
      }
    })
  },
  onShow() {
    if (this._vehicleEditNeedsClearUnsaved && isPageCurrent(this)) {
      this._vehicleEditNeedsClearUnsaved = false
      clearUnsaved(this)
    }
    syncUnsavedChanges(this)
    const pending = this._vehicleEditDeferredResult
    if (pending) {
      this._vehicleEditDeferredResult = null
      pending()
      return
    }
    const requestId = Number(this._vehicleEditPendingNavigationRequestId || 0)
    if (
      requestId &&
      !this._vehicleEditNavigationTimer &&
      requestId === this._vehicleEditSubmitRequestId
    ) {
      this.continueVehicleEditNavigation(requestId)
    }
  },
  onUnload() {
    disposeUnsavedChanges(this)
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    this._vehicleEditLoadRequestId =
      Number(this._vehicleEditLoadRequestId || 0) + 1
    this._vehicleEditSubmitRequestId =
      Number(this._vehicleEditSubmitRequestId || 0) + 1
    this._vehicleEditPendingNavigationRequestId = 0
    this._vehicleEditDeferredResult = null
    this._vehicleEditNeedsClearUnsaved = false
    this.clearVehicleEditLoadTimer()
    this.clearVehicleEditSubmitTimer()
    this.clearVehicleEditNavigationTimer()
  },
  fetchDetail(id) {
    this._vehicleEditNeedsClearUnsaved = false
    const vehicleId = String(id || "").trim()
    const requestId = Number(this._vehicleEditLoadRequestId || 0) + 1
    this._vehicleEditLoadRequestId = requestId
    this.clearVehicleEditLoadTimer()
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      this.setData({
        loading: false,
        loadFailed: true,
        loadErrorText: "云能力未初始化，请稍后重试"
      })
      return
    }
    this.setData({
      loading: true,
      loadFailed: false
    })
    let settled = false
    const finishRequest = () => {
      if (settled || this._vehicleEditLoadRequestId !== requestId) {
        return false
      }
      settled = true
      this.clearVehicleEditLoadTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      if (isPageCurrent(this)) {
        wx.showToast({
          title: formatToastTitle(message, "加载失败"),
          icon: "none"
        })
      }
      this.setData({
        loading: false,
        loadFailed: true,
        loadErrorText: message || "车辆档案加载失败，请稍后重试"
      })
    }
    this._vehicleEditLoadTimer = setTimeout(() => {
      handleFailure("档案加载超时，请重试")
    }, VEHICLE_EDIT_LOAD_TIMEOUT_MS)
    const requestOptions = {
      name: "vehicleDetail",
      data: {
        id: vehicleId
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.detail) {
          if (isPageCurrent(this)) {
            wx.showToast({
              title: formatToastTitle(result && result.message, "加载失败"),
              icon: "none"
            })
          }
          this.setData({
            loading: false,
            loadFailed: true,
            loadErrorText: (result && result.message) || "车辆档案加载失败，请稍后重试"
          })
          return
        }
        const current = result.detail
        this._vehicleVersion = Number(current.vehicleVersion) || 0
        const vehicleTypeIndex = Math.max(vehicleUtils.VEHICLE_TYPES.indexOf(current.vehicleType), 0)
        const statusIndex = Math.max(vehicleUtils.VEHICLE_STATUSES.indexOf(current.status), 0)
        const transmissionIndex = Math.max(vehicleUtils.TRANSMISSION_TYPES.indexOf(current.transmission), 0)
        const fuelTypeIndex = Math.max(vehicleUtils.FUEL_TYPES.indexOf(current.fuelType), 0)
        const vehicleType = String(current.vehicleType || "").trim()
        const status = String(current.status || "").trim()
        const transmission = current.transmission || ""
        const fuelType = current.fuelType || ""
        const archiveReviewStatus = vehicleUtils.ARCHIVE_REVIEW_STATUSES.includes(current.publicArchiveReviewStatus)
          ? current.publicArchiveReviewStatus
          : "pending"
        const archiveReviewIndex = Math.max(vehicleUtils.ARCHIVE_REVIEW_STATUSES.indexOf(archiveReviewStatus), 0)
        const rawPerf = vehicleUtils.normalizePerformanceInput(current.performance) || {}
        const perfDrivetrain = String(rawPerf.drivetrain || "").trim()
        const drivetrainIndex = DRIVETRAIN_OPTIONS.indexOf(perfDrivetrain)
        const highlightsRaw = Array.isArray(rawPerf.highlights) ? rawPerf.highlights.slice() : []
        const highlightsPadded = highlightsRaw.slice()
        while (highlightsPadded.length < 4) {
          highlightsPadded.push("")
        }
        this.setData({
          loading: false,
          loadFailed: false,
          publicDescriptionLength: String(current.publicDescription || "").length,
          noteLength: String(current.note || "").length,
          discountRows: toDiscountRows(current.rentalDiscountTiers),
          vehicleTypeIndex,
          statusIndex,
          transmissionIndex: transmission ? transmissionIndex : 0,
          fuelTypeIndex: fuelType ? fuelTypeIndex : 0,
          archiveReviewIndex,
          drivetrainIndex,
          vehicleTypeLabel: VEHICLE_TYPE_LABEL_MAP[vehicleType] || vehicleType,
          statusLabel: STATUS_LABEL_MAP[status] || status,
          transmissionLabel: TRANSMISSION_LABEL_MAP[transmission] || "",
          fuelTypeLabel: FUEL_TYPE_LABEL_MAP[fuelType] || "",
          archiveReviewLabel: ARCHIVE_REVIEW_LABEL_MAP[archiveReviewStatus],
          drivetrainLabel: perfDrivetrain || "",
          formProgress: buildVehicleFormProgress({
            plateNumber: current.plateNumber,
            vehicleType,
            brandModel: current.brandModel,
            registerDate: current.registerDate,
            status
          }),
          form: {
            plateNumber: vehicleUtils.normalizePlateNumber(current.plateNumber),
            vehicleType,
            brandModel: current.brandModel || "",
            registerDate: current.registerDate || "",
            status,
            location: current.location || "",
            transmission,
            fuelType,
            seats: current.seats === undefined || current.seats === null ? "" : String(current.seats),
            priceDay: current.priceDay === undefined || current.priceDay === null ? "" : String(current.priceDay),
            vin: current.vin || "",
            engineNumber: current.engineNumber || "",
            publicDescription: current.publicDescription || "",
            publicDrivingTips: current.publicDrivingTips || "",
            archiveDate: current.archiveDate || "",
            archiveReview: current.archiveReview || "",
            note: current.note || "",
            publicMaterialsUpdatedDate: current.publicMaterialsUpdatedDate || "",
            publicInspectionDate: current.publicInspectionDate || "",
            publicInspectionSummary: current.publicInspectionSummary || "",
            publicExteriorSummary: current.publicExteriorSummary || "",
            publicInsuranceSummary: current.publicInsuranceSummary || "",
            publicAssistanceSummary: current.publicAssistanceSummary || "",
            publicArchiveReviewStatus: archiveReviewStatus,
            internalMaintenanceRecord: current.internalMaintenanceRecord || "",
            internalInspectionRecord: current.internalInspectionRecord || "",
            internalInsuranceRecord: current.internalInsuranceRecord || "",
            internalArchiveNote: current.internalArchiveNote || "",
            performance: {
              acceleration: String(rawPerf.acceleration || "").trim(),
              horsepower: String(rawPerf.horsepower || "").trim(),
              drivetrain: perfDrivetrain,
              torque: String(rawPerf.torque || "").trim(),
              highlights: highlightsPadded
            }
          }
        })
        if (isPageCurrent(this)) clearUnsaved(this)
        else this._vehicleEditNeedsClearUnsaved = true
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
    this.setData({
      "form.registerDate": event.detail.value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, registerDate: event.detail.value })
    })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleArchiveDateChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const field = String((event.currentTarget.dataset && event.currentTarget.dataset.field) || "")
    if (!["publicMaterialsUpdatedDate", "publicInspectionDate"].includes(field)) {
      return
    }
    this.setData({ [`form.${field}`]: event.detail.value })
    markUnsaved(this, "车辆资料尚未保存，确定离开吗？")
  },
  handleArchiveReviewChange(event) {
    if (this.data.isSubmitting) {
      return
    }
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.ARCHIVE_REVIEW_STATUSES[index] || "pending"
    this.setData({
      archiveReviewIndex: index,
      archiveReviewLabel: ARCHIVE_REVIEW_LABEL_MAP[value],
      "form.publicArchiveReviewStatus": value
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
  handleManageImages() {
    if (!this.data.id || this.data.loading) {
      return
    }
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.navigateTo({
      url: `/pages-admin/vehicle-detail-manage/vehicle-detail-manage?id=${this.data.id}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "车辆详情打开失败",
          icon: "none"
        })
      }
    })
  },
  handleRetryLoad() {
    if (!this.data.id || this.data.loading || this.data.isSubmitting) {
      return
    }
    this.setData({
      loading: true,
      loadFailed: false
    })
    this.fetchDetail(this.data.id)
  },
  handleBackList() {
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
            url: "/pages-admin/vehicle-manage/vehicle-manage",
            fail: () => {
              if (!isPageNativeActionActive(this, action)) {
                return
              }
              wx.reLaunch({
                url: "/pages-admin/vehicle-manage/vehicle-manage",
                fail: () => {
                  if (!isPageNativeActionActive(this, action)) {
                    return
                  }
                  wx.showToast({
                    title: "返回车辆管理失败",
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
      url: "/pages-admin/vehicle-manage/vehicle-manage",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.reLaunch({
          url: "/pages-admin/vehicle-manage/vehicle-manage",
          fail: () => {
            if (!isPageNativeActionActive(this, action)) {
              return
            }
            wx.showToast({
              title: "返回车辆管理失败",
              icon: "none"
            })
          }
        })
      }
    })
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
  handleSubmit() {
    if (this.data.loading || this.data.isSubmitting) {
      return
    }
    const normalizedPayload = this.buildSubmitPayload()
    const check = vehicleUtils.validateVehicle(normalizedPayload)
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
    const submitData = {
      id: String(this.data.id || "").trim(),
      expectedVersion: Number(this._vehicleVersion) || 0,
      ...check.value
    }
    const requestId = Number(this._vehicleEditSubmitRequestId || 0) + 1
    this._vehicleEditSubmitRequestId = requestId
    const action = beginPageNativeAction(this, { requireCurrent: true })
    this.clearVehicleEditSubmitTimer()
    this.clearVehicleEditNavigationTimer()
    this.setData({
      isSubmitting: true
    })
    let settled = false
    const isCurrent = () => this._vehicleEditSubmitRequestId === requestId
    const finishRequest = () => {
      if (settled || !isCurrent()) {
        return false
      }
      settled = true
      this.clearVehicleEditSubmitTimer()
      return true
    }
    const deliverResult = (callback) => {
      if (!isCurrent()) return
      if (!isPageNativeActionActive(this, action)) {
        this._vehicleEditDeferredResult = () => deliverResult(callback)
        return
      }
      callback()
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      deliverResult(() => {
        wx.showToast({
          title: formatToastTitle(message, "保存失败"),
          icon: "none"
        })
        this.setData({ isSubmitting: false })
      })
    }
    this._vehicleEditSubmitTimer = setTimeout(() => {
      handleFailure("保存超时，请重试")
    }, VEHICLE_EDIT_SUBMIT_TIMEOUT_MS)
    const requestOptions = {
      name: "vehicleUpdate",
      data: submitData,
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        deliverResult(() => {
          const result = res && res.result ? res.result : null
          if (result && result.ok) {
            if (Number.isSafeInteger(result.vehicleVersion) && result.vehicleVersion >= 0) {
              this._vehicleVersion = result.vehicleVersion
            }
            clearUnsaved(this)
            wx.showToast({
              title: "保存成功",
              icon: "success",
              duration: 1200
            })
            this.scheduleVehicleEditNavigation(requestId)
            return
          }
          if (result && result.code === "VERSION_CONFLICT") {
            this.setData({ isSubmitting: false })
            this.confirmReloadVehicle()
            return
          }
          const title =
            result &&
            result.code === "VALIDATION_ERROR" &&
            result.details &&
            result.details.errors
              ? this.getValidationMessage(result)
              : (result && result.message) || "保存失败"
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
  clearVehicleEditLoadTimer() {
    if (this._vehicleEditLoadTimer) {
      clearTimeout(this._vehicleEditLoadTimer)
      this._vehicleEditLoadTimer = null
    }
  },
  confirmReloadVehicle() {
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.showModal({
      title: "车辆资料已更新",
      confirmColor: "#528fff",
      content: "其他管理员已修改此车。重新加载会替换当前未保存的内容，请先记录需要保留的修改。",
      confirmText: "重新加载",
      cancelText: "保留修改",
      success: (res) => {
        if (!isPageNativeActionActive(this, action) || !res.confirm) return
        this.fetchDetail(this.data.id)
      }
    })
  },
  clearVehicleEditSubmitTimer() {
    if (this._vehicleEditSubmitTimer) {
      clearTimeout(this._vehicleEditSubmitTimer)
      this._vehicleEditSubmitTimer = null
    }
  },
  scheduleVehicleEditNavigation(requestId) {
    this.clearVehicleEditNavigationTimer()
    this._vehicleEditPendingNavigationRequestId = requestId
    this._vehicleEditNavigationTimer = setTimeout(() => {
      this._vehicleEditNavigationTimer = null
      this.continueVehicleEditNavigation(requestId)
    }, 900)
  },
  continueVehicleEditNavigation(requestId) {
    const isCurrent = () => this._vehicleEditSubmitRequestId === requestId
    const canNavigate = () => isCurrent() && isPageCurrent(this)
    const deferNavigation = () => {
      if (isCurrent()) {
        this._vehicleEditPendingNavigationRequestId = requestId
      }
    }
    if (!canNavigate()) {
      deferNavigation()
      return
    }
    this._vehicleEditPendingNavigationRequestId = 0
    wx.navigateBack({
      delta: 1,
      fail: () => {
        if (!canNavigate()) {
          deferNavigation()
          return
        }
        wx.redirectTo({
          url: "/pages-admin/vehicle-manage/vehicle-manage",
          fail: () => {
            if (!canNavigate()) {
              deferNavigation()
              return
            }
            wx.reLaunch({
              url: "/pages-admin/vehicle-manage/vehicle-manage",
              fail: () => {
                if (!isCurrent()) {
                  return
                }
                if (!isPageCurrent(this)) {
                  deferNavigation()
                  return
                }
                this.setData({
                  isSubmitting: false
                })
                wx.showToast({
                  title: "返回车辆管理失败",
                  icon: "none"
                })
              }
            })
          }
        })
      }
    })
  },
  clearVehicleEditNavigationTimer() {
    if (this._vehicleEditNavigationTimer) {
      clearTimeout(this._vehicleEditNavigationTimer)
      this._vehicleEditNavigationTimer = null
    }
  }
})
