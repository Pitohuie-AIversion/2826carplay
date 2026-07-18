const { requirePagePermission } = require("../../shared/pageAuth")

const DEFAULT_CONFIG = {
  brandName: "极境车库",
  servicePhone: "15715710090",
  mineUserDesc: "静态展示页，更多个人功能将在后续版本完善",
  garagePageTitle: "极境车库",
  garagePageSubtitle: "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页",
  cityOptions: ["杭州", "上海"],
  faqContent:
    "1. 预约提交后，客服会尽快联系您确认档期与细节。\n2. 车辆价格、押金与取还车规则以最终沟通结果为准。\n3. 如需取消预约，可前往【我的预约】操作。",
  rulesContent:
    "1. 车辆展示信息仅供参考，具体以客服最终确认为准。\n2. 预约不代表最终成交，需以档期、资质与规则审核结果为准。\n3. 平台保留对异常预约、恶意占用档期等行为的处理权利。",
  bookingPrivacyTip:
    "提交预约即表示您同意我们仅将所填信息用于本次车辆预约沟通与联系确认。您可在【我的预约】查看与取消；如需删除预约记录或个人信息，请联系管理员处理。车辆档期、价格、押金及取还车规则以客服最终确认为准。"
}

function buildForm(config) {
  const source = config && typeof config === "object" ? config : DEFAULT_CONFIG
  return {
    brandName: source.brandName || DEFAULT_CONFIG.brandName,
    servicePhone: source.servicePhone || DEFAULT_CONFIG.servicePhone,
    mineUserDesc: source.mineUserDesc || DEFAULT_CONFIG.mineUserDesc,
    garagePageTitle: source.garagePageTitle || DEFAULT_CONFIG.garagePageTitle,
    garagePageSubtitle: source.garagePageSubtitle || DEFAULT_CONFIG.garagePageSubtitle,
    cityOptionsText: Array.isArray(source.cityOptions) ? source.cityOptions.join("\n") : DEFAULT_CONFIG.cityOptions.join("\n"),
    faqContent: source.faqContent || DEFAULT_CONFIG.faqContent,
    rulesContent: source.rulesContent || DEFAULT_CONFIG.rulesContent,
    bookingPrivacyTip: source.bookingPrivacyTip || DEFAULT_CONFIG.bookingPrivacyTip
  }
}

function buildSubmitConfig(form) {
  const source = form && typeof form === "object" ? form : {}
  const cityOptions = String(source.cityOptionsText || "")
    .split(/\r?\n/)
    .map((item) => String(item || "").trim())
    .filter(Boolean)

  return {
    brandName: source.brandName || "",
    servicePhone: source.servicePhone || "",
    mineUserDesc: source.mineUserDesc || "",
    garagePageTitle: source.garagePageTitle || "",
    garagePageSubtitle: source.garagePageSubtitle || "",
    cityOptions,
    faqContent: source.faqContent || "",
    rulesContent: source.rulesContent || "",
    bookingPrivacyTip: source.bookingPrivacyTip || ""
  }
}

Page({
  data: {
    loading: false,
    saving: false,
    pageAuthorized: false,
    hasLoadedConfig: false,
    loadFailed: false,
    loadErrorText: "",
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
          form: buildForm(result.config)
        })
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
      [`form.${field}`]: String((event.detail && event.detail.value) || "")
    })
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
      form: buildForm(DEFAULT_CONFIG)
    })
  },

  handleSubmit() {
    if (this.data.saving) {
      return
    }

    if (!this.data.hasLoadedConfig || this.data.loadFailed) {
      wx.showToast({
        title: "配置未加载成功，暂不允许保存",
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

    this.setData({ saving: true })
    wx.showLoading({
      title: "保存中"
    })

    wx.cloud.callFunction({
      name: "operationConfigUpdate",
      data: {
        config: buildSubmitConfig(this.data.form)
      },
      success: (res) => {
        wx.hideLoading()
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "保存失败",
            icon: "none"
          })
          this.setData({ saving: false })
          return
        }

        wx.showToast({
          title: result.message || "保存成功",
          icon: "success"
        })
        this.setData({
          saving: false,
          form: buildForm(result.config || DEFAULT_CONFIG)
        })
      },
      fail: (error) => {
        wx.hideLoading()
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "保存失败",
          icon: "none"
        })
        this.setData({ saving: false })
      }
    })
  }
})
