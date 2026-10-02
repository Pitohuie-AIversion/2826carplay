const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { clearUnsaved, markUnsaved } = require("../../shared/unsavedChanges")
const { isPageCurrent } = require("../../shared/pageNativeAction")
const { clearOperationConfigCache } = require("../../shared/operationConfigRequest")
const { normalizeServiceConfig, validateServiceConfig, validateCityOptions, MAX_SERVICE_HUBS, HUB_TYPES } = require("../../shared/serviceConfig")
const CONFIG_LOAD_TIMEOUT_MS = 15 * 1000
const CONFIG_SAVE_TIMEOUT_MS = 20 * 1000
const DEFAULT_RENTAL_TERMS = {
  includedText: "",
  protectionText: "",
  serviceFeeText: "",
  deliveryFeeText: "",
  depositText: "",
  cancellationText: "",
  overtimeText: "",
  energyText: "",
  estimateDisclaimer: ""
}
const DEFAULT_CONFIG = {
  ...normalizeServiceConfig({}),
  brandName: "极境车库",
  servicePhone: "",
  wxKfCorpId: "",
  wxKfExtInfo: "",
  mineUserDesc: "查看预约、个人信息申请与车库服务",
  garagePageTitle: "极境车库",
  garagePageSubtitle: "甄选座驾，为每一次出发预留专属席位",
  cityOptions: ["杭州", "上海"],
  faqContent: "",
  rulesContent: "",
  bookingStatusTemplateId: "",
  rentalTerms: DEFAULT_RENTAL_TERMS,
  bookingPrivacyTip:
    "提交预约即表示您同意我们仅将所填信息用于本次车辆预约沟通与联系确认。您可在【我的预约】查看、修改联系信息与取消；如需查询、更正或删除其他个人信息，请前往【个人信息申请】。车辆档期、价格、押金及取还车规则以客服最终确认为准。"
}
function isValidServicePhone(value) {
  const phone = String(value || "").trim()
  const digitCount = phone.replace(/\D/g, "").length
  return /^\+?[0-9-]{6,20}$/.test(phone) && digitCount >= 6 && digitCount <= 15
}
function normalizeGarageSubtitle(value) {
  const subtitle = String(value || "").trim()
  return !subtitle ? DEFAULT_CONFIG.garagePageSubtitle : subtitle
}
function buildForm(config) {
  const source = config && typeof config === "object" ? config : DEFAULT_CONFIG
  const serviceConfig = normalizeServiceConfig(source)
  const rentalTerms = source.rentalTerms && typeof source.rentalTerms === "object"
    ? source.rentalTerms
    : DEFAULT_RENTAL_TERMS
  return {
    ...serviceConfig,
    serviceHubs: serviceConfig.serviceHubs.map((hub) => ({
      ...hub,
      latitude: hub.latitude === null ? "" : String(hub.latitude),
      longitude: hub.longitude === null ? "" : String(hub.longitude)
    })),
    brandName: source.brandName || DEFAULT_CONFIG.brandName,
    servicePhone: source.servicePhone || "",
    wxKfCorpId: source.wxKfCorpId || DEFAULT_CONFIG.wxKfCorpId,
    wxKfExtInfo: source.wxKfExtInfo || DEFAULT_CONFIG.wxKfExtInfo,
    mineUserDesc: source.mineUserDesc || DEFAULT_CONFIG.mineUserDesc,
    garagePageTitle: source.garagePageTitle || DEFAULT_CONFIG.garagePageTitle,
    garagePageSubtitle: normalizeGarageSubtitle(source.garagePageSubtitle),
    cityOptionsText: Array.isArray(source.cityOptions) ? source.cityOptions.join("\n") : DEFAULT_CONFIG.cityOptions.join("\n"),
    faqContent: source.faqContent || DEFAULT_CONFIG.faqContent,
    rulesContent: source.rulesContent || DEFAULT_CONFIG.rulesContent,
    bookingStatusTemplateId: source.bookingStatusTemplateId || "",
    bookingPrivacyTip: source.bookingPrivacyTip || DEFAULT_CONFIG.bookingPrivacyTip,
    rentalIncludedText: rentalTerms.includedText || DEFAULT_RENTAL_TERMS.includedText,
    rentalProtectionText: rentalTerms.protectionText || DEFAULT_RENTAL_TERMS.protectionText,
    rentalServiceFeeText: rentalTerms.serviceFeeText || DEFAULT_RENTAL_TERMS.serviceFeeText,
    rentalDeliveryFeeText: rentalTerms.deliveryFeeText || DEFAULT_RENTAL_TERMS.deliveryFeeText,
    rentalDepositText: rentalTerms.depositText || DEFAULT_RENTAL_TERMS.depositText,
    rentalCancellationText: rentalTerms.cancellationText || DEFAULT_RENTAL_TERMS.cancellationText,
    rentalOvertimeText: rentalTerms.overtimeText || DEFAULT_RENTAL_TERMS.overtimeText,
    rentalEnergyText: rentalTerms.energyText || DEFAULT_RENTAL_TERMS.energyText,
    rentalEstimateDisclaimer:
      rentalTerms.estimateDisclaimer || DEFAULT_RENTAL_TERMS.estimateDisclaimer
  }
}
function buildSubmitConfig(form) {
  const source = form && typeof form === "object" ? form : {}
  const cityOptions = String(source.cityOptionsText || "")
    .split(/\r?\n/)
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .filter((item, index, list) => list.indexOf(item) === index)
  return {
    serviceHoursText: String(source.serviceHoursText || "").trim(),
    emergencyPhone: String(source.emergencyPhone || "").trim(),
    serviceHubs: (source.serviceHubs || []).map((hub) => ({ ...hub })),
    brandName: source.brandName || "",
    servicePhone: String(source.servicePhone || "").trim(),
    wxKfCorpId: String(source.wxKfCorpId || "").trim(),
    wxKfExtInfo: String(source.wxKfExtInfo || "").trim(),
    mineUserDesc: source.mineUserDesc || "",
    garagePageTitle: source.garagePageTitle || "",
    garagePageSubtitle: source.garagePageSubtitle || "",
    cityOptions,
    faqContent: source.faqContent || "",
    rulesContent: source.rulesContent || "",
    bookingStatusTemplateId: String(source.bookingStatusTemplateId || "").trim(),
    bookingPrivacyTip: source.bookingPrivacyTip || "",
    rentalTerms: {
      includedText: source.rentalIncludedText || "",
      protectionText: source.rentalProtectionText || "",
      serviceFeeText: source.rentalServiceFeeText || "",
      deliveryFeeText: source.rentalDeliveryFeeText || "",
      depositText: source.rentalDepositText || "",
      cancellationText: source.rentalCancellationText || "",
      overtimeText: source.rentalOvertimeText || "",
      energyText: source.rentalEnergyText || "",
      estimateDisclaimer: source.rentalEstimateDisclaimer || ""
    }
  }
}
Page({
  data: {
    loading: true,
    saving: false,
    pageAuthorized: false,
    hasLoadedConfig: false,
    loadFailed: false,
    loadErrorText: "",
    isDirty: false,
    configRevision: 0,
    saveConflict: false,
    hubTypeOptions: ["门店", "接送网点", "送车地点"],
    form: buildForm(DEFAULT_CONFIG)
  },
  onLoad() {
    requirePagePermission(this, {
      required: "canManageConfig",
      noPermissionMessage: "无权访问运营配置",
      onAuthorized: () => {
        this.fetchConfig()
      }
    })
  },
  onPullDownRefresh() {
    if (!this.data.pageAuthorized) {
      wx.stopPullDownRefresh()
      return
    }
    if (this.data.isDirty || this.data.saving) {
      wx.stopPullDownRefresh()
      wx.showToast({
        title: this.data.saving ? "正在保存配置" : "请先保存或重置修改",
        icon: "none"
      })
      return
    }
    if (this.data.loading) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchConfig(() => {
      wx.stopPullDownRefresh()
    })
  },
  onHide() {
    this.hideConfigSaveLoading()
  },
  onUnload() {
    cancelPagePermissionCheck(this)
    clearUnsaved(this)
    this._configLoadRequestId = Number(this._configLoadRequestId || 0) + 1
    this._configSaveRequestId = Number(this._configSaveRequestId || 0) + 1
    this.finishConfigLoadRequestEffects()
    this.finishConfigSaveRequestEffects()
  },
  fetchConfig(done, options) {
    const replaceConflict = Boolean(options && options.replaceConflict && this.data.saveConflict)
    if (this.data.saving || (this.data.isDirty && !replaceConflict)) {
      if (typeof done === "function") {
        done()
      }
      return
    }
    const requestId = Number(this._configLoadRequestId || 0) + 1
    this._configLoadRequestId = requestId
    this.finishConfigLoadRequestEffects()
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        hasLoadedConfig: false,
        loadFailed: true,
        loadErrorText: "云能力未初始化，请稍后重试"
      })
      if (typeof done === "function") {
        done()
      }
      return
    }
    this._configLoadRequestDone = typeof done === "function" ? done : null
    this.setData({
      loading: true,
      loadFailed: false,
      loadErrorText: ""
    })
    let settled = false
    const finishRequest = () => {
      if (settled || this._configLoadRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishConfigLoadRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        loading: false,
        loadFailed: true,
        loadErrorText: String(message || "配置加载失败，请刷新后重试")
      })
    }
    this._configLoadRequestTimer = setTimeout(() => {
      handleFailure("配置加载超时，请检查网络后重试")
    }, CONFIG_LOAD_TIMEOUT_MS)
    const requestOptions = {
      name: "operationConfigGet",
      data: { requireStoredConfig: true },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.config) {
          this.setData({
            loading: false,
            loadFailed: true,
            loadErrorText: (result && result.message) || "配置加载失败，请刷新后重试"
          })
          return
        }
        this.setData({
          loading: false,
          hasLoadedConfig: true,
          loadFailed: false,
          loadErrorText: "",
          isDirty: false,
          saveConflict: false,
          configRevision: Number.isSafeInteger(result.revision) ? result.revision : 0,
          form: buildForm(result.config)
        })
        clearUnsaved(this)
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      },
      complete: () => {}
    }
    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },
  handleInput(event) {
    if (!this.canEditServiceHubs()) {
      return
    }
    const field = String(event.currentTarget.dataset.field || "").trim()
    if (!field) {
      return
    }
    this.setData({
      [`form.${field}`]: String((event.detail && event.detail.value) || ""),
      isDirty: true
    })
    markUnsaved(this, "运营配置尚未保存，确定离开吗？")
  },
  canEditServiceHubs() {
    return !this.data.loading && !this.data.saving && this.data.hasLoadedConfig && !this.data.loadFailed
  },
  updateServiceHubs(serviceHubs) {
    this.setData({ "form.serviceHubs": serviceHubs, isDirty: true })
    markUnsaved(this, "运营配置尚未保存，确定离开吗？")
  },
  handleAddServiceHub() {
    if (!this.canEditServiceHubs()) return
    const hubs = this.data.form.serviceHubs || []
    if (hubs.length >= MAX_SERVICE_HUBS) {
      wx.showToast({ title: "服务网点最多30个", icon: "none" })
      return
    }
    let id
    do {
      this._serviceHubSequence = Number(this._serviceHubSequence || 0) + 1
      id = `hub_${Date.now().toString(36)}_${this._serviceHubSequence}`
    } while (hubs.some((hub) => hub.id === id))
    this.updateServiceHubs([...hubs, { id, city: "", name: "", address: "", feeText: "", type: "store", latitude: "", longitude: "" }])
  },
  handleRemoveServiceHub(event) {
    if (!this.canEditServiceHubs()) return
    const id = String(event.currentTarget.dataset.id || "")
    const hubs = this.data.form.serviceHubs || []
    if (!hubs.some((hub) => hub.id === id)) return
    this.updateServiceHubs(hubs.filter((hub) => hub.id !== id))
  },
  handleServiceHubInput(event) {
    if (!this.canEditServiceHubs()) return
    const { id, field } = event.currentTarget.dataset
    if (!["city", "name", "address", "feeText", "latitude", "longitude"].includes(field)) return
    const hubs = this.data.form.serviceHubs || []
    if (!hubs.some((hub) => hub.id === id)) return
    const value = String(event.detail && event.detail.value !== undefined ? event.detail.value : "")
    this.updateServiceHubs(hubs.map((hub) => hub.id === id ? { ...hub, [field]: value } : hub))
  },
  handleServiceHubTypeChange(event) {
    if (!this.canEditServiceHubs()) return
    const id = String(event.currentTarget.dataset.id || "")
    const type = HUB_TYPES[Number(event.detail && event.detail.value)]
    const hubs = this.data.form.serviceHubs || []
    if (!type || !hubs.some((hub) => hub.id === id)) return
    this.updateServiceHubs(hubs.map((hub) => hub.id === id ? { ...hub, type } : hub))
  },
  handleReset() {
    if (this.data.loading || this.data.saving) {
      return
    }
    if (!this.data.hasLoadedConfig || this.data.loadFailed) {
      wx.showToast({
        title: "请先成功加载线上配置",
        icon: "none"
      })
      return
    }
    this.setData({
      form: buildForm(DEFAULT_CONFIG),
      isDirty: true
    })
    markUnsaved(this, "运营配置尚未保存，确定离开吗？")
  },
  handleRetryLoad() {
    if (this.data.loading || this.data.saving || (this.data.isDirty && !this.data.saveConflict)) {
      return
    }
    // Keep the draft and unload warning until the replacement is actually read.
    this.fetchConfig(undefined, { replaceConflict: this.data.saveConflict })
  },
  handleSubmit() {
    if (this.data.loading || this.data.saving) {
      return
    }
    if (!this.data.hasLoadedConfig || this.data.loadFailed) {
      wx.showToast({
        title: "配置未就绪",
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
    const submitConfig = buildSubmitConfig(this.data.form)
    if (submitConfig.servicePhone && !isValidServicePhone(submitConfig.servicePhone)) {
      wx.showToast({
        title: "客服电话格式不正确",
        icon: "none"
      })
      return
    }
    const serviceError = validateServiceConfig(submitConfig) || validateCityOptions(submitConfig.cityOptions)
    if (serviceError) {
      wx.showToast({ title: formatToastTitle(serviceError.message, "服务配置有误"), icon: "none" })
      return
    }
    if (
      submitConfig.bookingStatusTemplateId &&
      !/^[A-Za-z0-9_-]{10,128}$/.test(submitConfig.bookingStatusTemplateId)
    ) {
      wx.showToast({
        title: "模板编号有误",
        icon: "none"
      })
      return
    }
    if (submitConfig.wxKfCorpId && !/^[A-Za-z0-9_-]{6,64}$/.test(submitConfig.wxKfCorpId)) {
      wx.showToast({
        title: "企业ID格式错误",
        icon: "none"
      })
      return
    }
    if (submitConfig.wxKfExtInfo && submitConfig.wxKfExtInfo.length > 512) {
      wx.showToast({
        title: "客服链接参数过长",
        icon: "none"
      })
      return
    }
    if (
      (submitConfig.wxKfCorpId && !submitConfig.wxKfExtInfo) ||
      (!submitConfig.wxKfCorpId && submitConfig.wxKfExtInfo)
    ) {
      wx.showToast({
        title: "企业ID与链接需同填",
        icon: "none"
      })
      return
    }
    this.setData({ saving: true })
    // The write may commit even if this page times out or is unloaded before its response.
    clearOperationConfigCache()
    const requestId = Number(this._configSaveRequestId || 0) + 1
    this._configSaveRequestId = requestId
    this.finishConfigSaveRequestEffects()
    wx.showLoading({
      title: "保存中…",
      mask: true
    })
    this._configSaveLoadingVisible = true
    const showSaveToast = (options) => {
      if (isPageCurrent(this)) wx.showToast(options)
    }
    let settled = false
    const finishRequest = () => {
      if (settled || this._configSaveRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishConfigSaveRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      showSaveToast({
        title: formatToastTitle(message, "保存失败"),
        icon: "none"
      })
      this.setData({ saving: false })
    }
    this._configSaveRequestTimer = setTimeout(() => {
      handleFailure("保存超时，请重试")
    }, CONFIG_SAVE_TIMEOUT_MS)
    const requestOptions = {
      name: "operationConfigUpdate",
      data: {
        config: submitConfig,
        expectedRevision: this.data.configRevision
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (result && result.ok) clearOperationConfigCache()
        if (!finishRequest()) {
          return
        }
        if (!result || !result.ok || !result.config) {
          showSaveToast({
            title: formatToastTitle(result && result.message, "保存失败"),
            icon: "none"
          })
          this.setData({ saving: false, saveConflict: Boolean(result && ["CONFIG_CONFLICT", "CONFIG_VERSION_REQUIRED"].includes(result.code)) })
          return
        }
        showSaveToast({
          title: formatToastTitle(result.message, "保存成功"),
          icon: "success"
        })
        this.setData({
          saving: false,
          isDirty: false,
          saveConflict: false,
          configRevision: Number.isSafeInteger(result.revision) ? result.revision : this.data.configRevision,
          form: buildForm(result.config)
        })
        clearUnsaved(this)
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      },
      complete: () => {}
    }
    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },
  finishConfigLoadRequestEffects() {
    if (this._configLoadRequestTimer) {
      clearTimeout(this._configLoadRequestTimer)
      this._configLoadRequestTimer = null
    }
    const done = this._configLoadRequestDone
    this._configLoadRequestDone = null
    if (typeof done === "function") {
      done()
    }
  },
  finishConfigSaveRequestEffects() {
    if (this._configSaveRequestTimer) {
      clearTimeout(this._configSaveRequestTimer)
      this._configSaveRequestTimer = null
    }
    this.hideConfigSaveLoading()
  },
  hideConfigSaveLoading() {
    if (this._configSaveLoadingVisible) {
      this._configSaveLoadingVisible = false
      wx.hideLoading()
    }
  }
})
