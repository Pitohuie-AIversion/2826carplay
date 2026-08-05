const { requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { clearUnsaved, markUnsaved } = require("../../shared/unsavedChanges")

const LEGACY_GARAGE_SUBTITLE = "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页"

const DEFAULT_CONFIG = {
  brandName: "极境车库",
  servicePhone: "15715710090",
  mineUserDesc: "查看预约、个人信息申请与车库服务",
  garagePageTitle: "极境车库",
  garagePageSubtitle: "甄选座驾，为每一次出发预留专属席位",
  cityOptions: ["杭州", "上海"],
  faqContent:
    "1. 预约提交后，客服会尽快联系您确认档期与细节。\n2. 车辆价格、押金与取还车规则以最终沟通结果为准。\n3. 如需取消预约，可前往【我的预约】操作。",
  rulesContent:
    "1. 车辆展示信息仅供参考，具体以客服最终确认为准。\n2. 预约不代表最终成交，需以档期、资质与规则审核结果为准。\n3. 平台保留对异常预约、恶意占用档期等行为的处理权利。",
  bookingStatusTemplateId: "",
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
  return {
    brandName: source.brandName || DEFAULT_CONFIG.brandName,
    servicePhone: source.servicePhone || DEFAULT_CONFIG.servicePhone,
    mineUserDesc: source.mineUserDesc || DEFAULT_CONFIG.mineUserDesc,
    garagePageTitle: source.garagePageTitle || DEFAULT_CONFIG.garagePageTitle,
    garagePageSubtitle: normalizeGarageSubtitle(source.garagePageSubtitle),
    cityOptionsText: Array.isArray(source.cityOptions) ? source.cityOptions.join("\n") : DEFAULT_CONFIG.cityOptions.join("\n"),
    faqContent: source.faqContent || DEFAULT_CONFIG.faqContent,
    rulesContent: source.rulesContent || DEFAULT_CONFIG.rulesContent,
    bookingStatusTemplateId: source.bookingStatusTemplateId || "",
    bookingPrivacyTip: source.bookingPrivacyTip || DEFAULT_CONFIG.bookingPrivacyTip
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
    mineUserDesc: source.mineUserDesc || "",
    garagePageTitle: source.garagePageTitle || "",
    garagePageSubtitle: source.garagePageSubtitle || "",
    cityOptions,
    faqContent: source.faqContent || "",
    rulesContent: source.rulesContent || "",
    bookingStatusTemplateId: String(source.bookingStatusTemplateId || "").trim(),
    bookingPrivacyTip: source.bookingPrivacyTip || ""
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
    this.fetchConfig(() => {
      wx.stopPullDownRefresh()
    })
  },

  fetchConfig(done) {
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

    this.setData({
      loading: true,
      loadFailed: false,
      loadErrorText: ""
    })
    wx.cloud.callFunction({
      name: "operationConfigGet",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.config) {
          this.setData({
            loading: false,
            loadFailed: true,
            loadErrorText: (result && result.message) || "配置加载失败，请刷新后重试"
          })
          if (typeof done === "function") {
            done()
          }
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
        if (typeof done === "function") {
          done()
        }
      },
      fail: (error) => {
        this.setData({
          loading: false,
          loadFailed: true,
          loadErrorText: (error && (error.errMsg || error.message)) || "配置加载失败，请刷新后重试"
        })
        if (typeof done === "function") {
          done()
        }
      }
    })
  },

  handleInput(event) {
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
    this.fetchConfig()
  },

  handleSubmit() {
    if (this.data.saving) {
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

    this.setData({ saving: true })
    wx.showLoading({
      title: "保存中…",
      mask: true
    })

    wx.cloud.callFunction({
      name: "operationConfigUpdate",
      data: {
        config: submitConfig
      },
      success: (res) => {
        wx.hideLoading()
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
        wx.hideLoading()
        wx.showToast({
          title: "保存失败",
          icon: "none"
        })
        this.setData({ saving: false })
      }
    })
  }
})
