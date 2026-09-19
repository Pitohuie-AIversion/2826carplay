const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { clearUnsaved, markUnsaved } = require("../../shared/unsavedChanges")

const CONFIG_LOAD_TIMEOUT_MS = 15 * 1000
const CONFIG_SAVE_TIMEOUT_MS = 20 * 1000

const LEGACY_GARAGE_SUBTITLE = "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页"
const DEFAULT_RENTAL_TERMS = {
  includedText: "基础日租仅包含车辆使用费，其他项目会在正式报价前单独列明。",
  protectionText: "基础保障内容根据车型与租期确认，不默认包含额外保障服务。",
  serviceFeeText: "如有车辆整备或门店服务费，将在报价明细中单独列示。",
  deliveryFeeText: "取送车服务及费用按城市、距离和时段确认，无该服务时不收费。",
  depositText: "车辆押金与违章押金的金额、支付方式和退还时间会在确认前明确告知。",
  cancellationText: "预约提交后可取消；顾问确认后的取消或改期规则以有效报价说明为准。",
  overtimeText: "超时用车费用按最终确认的计费规则执行，产生前由顾问说明。",
  energyText: "取还车油量或电量标准会在交付前确认，并以交接记录为准。",
  estimateDisclaimer: "页面价格为基础日租参考，不是正式报价，提交预约也不会自动锁定车辆。"
}

const DEFAULT_CONFIG = {
  brandName: "极境车库",
  servicePhone: "15715710090",
  wxKfCorpId: "",
  wxKfExtInfo: "",
  mineUserDesc: "查看预约、个人信息申请与车库服务",
  garagePageTitle: "极境车库",
  garagePageSubtitle: "甄选座驾，为每一次出发预留专属席位",
  cityOptions: ["杭州", "上海"],
  faqContent:
    "1. 预约提交后，客服会尽快联系您确认档期与细节。\n2. 车辆价格、押金与取还车规则以最终沟通结果为准。\n3. 如需取消预约，可前往【我的预约】操作。",
  rulesContent:
    "1. 车辆展示信息仅供参考，具体以客服最终确认为准。\n2. 预约不代表最终成交，需以档期、资质与规则审核结果为准。\n3. 平台保留对异常预约、恶意占用档期等行为的处理权利。",
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
  return !subtitle || subtitle === LEGACY_GARAGE_SUBTITLE ? DEFAULT_CONFIG.garagePageSubtitle : subtitle
}

function buildForm(config) {
  const source = config && typeof config === "object" ? config : DEFAULT_CONFIG
  const rentalTerms = source.rentalTerms && typeof source.rentalTerms === "object"
    ? source.rentalTerms
    : DEFAULT_RENTAL_TERMS
  return {
    brandName: source.brandName || DEFAULT_CONFIG.brandName,
    servicePhone: source.servicePhone || DEFAULT_CONFIG.servicePhone,
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
    brandName: source.brandName || "",
    servicePhone: source.servicePhone || "",
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

  onUnload() {
    cancelPagePermissionCheck(this)
    this._configLoadRequestId = Number(this._configLoadRequestId || 0) + 1
    this._configSaveRequestId = Number(this._configSaveRequestId || 0) + 1
    this.finishConfigLoadRequestEffects()
    this.finishConfigSaveRequestEffects()
  },

  fetchConfig(done) {
    if (this.data.saving || this.data.isDirty) {
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
    if (this.data.loading || this.data.saving) {
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
    if (this.data.loading || this.data.saving || this.data.isDirty) {
      return
    }
    this.fetchConfig()
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
    if (!isValidServicePhone(submitConfig.servicePhone)) {
      wx.showToast({
        title: "客服电话格式不正确",
        icon: "none"
      })
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
    const requestId = Number(this._configSaveRequestId || 0) + 1
    this._configSaveRequestId = requestId
    this.finishConfigSaveRequestEffects()
    wx.showLoading({
      title: "保存中…",
      mask: true
    })
    this._configSaveLoadingVisible = true

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
      wx.showToast({
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
        config: submitConfig
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "保存失败"),
            icon: "none"
          })
          this.setData({ saving: false })
          return
        }

        wx.showToast({
        title: formatToastTitle(result.message, "保存成功"),
          icon: "success"
        })
        this.setData({
          saving: false,
          isDirty: false,
          form: buildForm(result.config || DEFAULT_CONFIG)
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
    if (this._configSaveLoadingVisible) {
      this._configSaveLoadingVisible = false
      wx.hideLoading()
    }
  }
})
