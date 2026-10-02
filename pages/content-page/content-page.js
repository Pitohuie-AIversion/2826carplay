const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const { requestCloudRead } = require("../../shared/cloudReadRequest")
const { trackEvent } = require("../../shared/analytics")
const { sanitizeAttribution, buildQuery, hasAttribution, isShareLanding } = require("../../shared/contentAttribution")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive,
  isPageCurrent
} = require("../../shared/pageNativeAction")
const { openCustomerService, hasWxKfConfig, cancelCustomerServiceRequest } = require("../../shared/customerService")
const { getClientVehicleStatusText } = require("../../shared/vehicleLabels")

const CONTENT_MAP = {
  faq: {
    title: "常见问题",
    heroDesc: "关于预约、档期与服务流程的常见解答",
    documentTitle: "快速了解服务问题"
  },
  rules: {
    title: "平台规则",
    heroDesc: "使用极境车库服务前需要了解的约定",
    documentTitle: "服务规则与使用约定"
  },
  privacy: {
    title: "隐私政策",
    heroDesc: "了解我们如何收集、使用与保护您的信息",
    documentTitle: "个人信息处理说明",
    defaultContent:
      "更新日期：2026年8月21日\n\n1. 信息收集\n当您提交车辆预约时，我们会收集您主动填写的姓名、手机号、取还车日期、城市及备注，并通过微信提供的 OpenID 识别和展示您本人的预约记录。为改进车辆内容与预约流程，我们还会记录不包含 OpenID、预约 ID 和表单内容的页面行为类型、可选内容 ID、车辆 ID、渠道与场景枚举及发生时间。\n\n2. 使用目的\n预约信息仅用于车辆预约登记、客服沟通、档期确认、预约查询与取消，以及必要的安全审计和故障排查。匿名行为事件仅用于汇总内容与车辆关注度、分享落地和预约转化趋势，不用于建立用户个人行为画像。\n\n3. 保存与保护\n信息存储在微信云开发环境中，仅授权工作人员可按职责访问。我们仅在实现预约服务和履行法定义务所必需的期限内保存；目的实现后将依法删除或匿名化，法律法规另有要求的除外。\n\n4. 信息共享\n除提供云开发基础设施所必需的处理、取得您的另行同意或法律法规要求外，我们不会主动向第三方出售或提供您的个人信息。\n\n5. 您的权利\n您可以在【我的预约】查看和取消预约。如需查询、更正或删除个人信息，可通过【我的 → 个人信息申请】在线提交，并查看处理进度与反馈。\n\n6. 未成年人保护\n未成年人应在监护人同意和指导下使用预约服务。\n\n7. 联系我们\n如对本政策或个人信息处理有疑问，请通过小程序内在线客服或客服电话联系极境车库运营方。"
  }
}

const CONTENT_TABS = [
  { type: "faq", title: "常见问题", kicker: "FAQ" },
  { type: "rules", title: "平台规则", kicker: "RULES" },
  { type: "privacy", title: "隐私政策", kicker: "PRIVACY" }
]

function buildDocumentSections(content) {
  const lines = String(content || "").split(/\r?\n/)
  const introLines = []
  const sections = []
  let current = null

  lines.forEach((line) => {
    const text = String(line || "").trim()
    if (!text) {
      return
    }

    const match = text.match(/^(\d+)[.、]\s*(.+)$/)
    if (match) {
      current = {
        key: `section-${sections.length + 1}`,
        number: match[1].padStart(2, "0"),
        title: match[2],
        bodyLines: []
      }
      sections.push(current)
      return
    }

    if (current) {
      current.bodyLines.push(text)
      return
    }

    introLines.push(text)
  })

  return {
    intro: introLines.join("\n"),
    sections: sections.map((item) => ({
      key: item.key,
      number: item.number,
      title: item.title,
      body: item.bodyLines.join("\n")
    }))
  }
}

Page({
  data: {
    type: "faq",
    pageTitle: "常见问题",
    heroDesc: CONTENT_MAP.faq.heroDesc,
    documentTitle: CONTENT_MAP.faq.documentTitle,
    content: "",
    contentLoading: false,
    contentError: "",
    intro: "",
    sections: [],
    contentTabs: CONTENT_TABS,
    activeSectionKey: "",
    servicePhone: "",
    wxKfReady: false,
    guideMode: false,
    guide: null,
    relatedVehicles: [],
    guideLoading: false,
    guideError: "",
    guideNotice: "",
    attribution: { channel: "", scene: "", contentId: "", vehicleId: "" }
  },

  onLoad(options) {
    activatePageNativeActions(this)
    this._contentHasShown = false
    const attribution = sanitizeAttribution(options)
    if (attribution.contentId) {
      this.setData({
        guideMode: true,
        guideLoading: true,
        attribution,
        pageTitle: "场景指南",
        heroDesc: "正在加载真实用车场景内容"
      })
      this.loadGuide(attribution.contentId)
      this.loadContent("")
      if (hasAttribution(attribution) && attribution.channel && attribution.channel !== "direct" && isShareLanding()) {
        trackEvent("share_open", attribution.vehicleId, attribution)
      }
      return
    }
    const requestedType = String((options && options.type) || "faq").trim()
    const type = Object.prototype.hasOwnProperty.call(CONTENT_MAP, requestedType)
      ? requestedType
      : "faq"
    const current = CONTENT_MAP[type]
    this.setData({
      type,
      pageTitle: current.title,
      heroDesc: current.heroDesc,
      documentTitle: current.documentTitle
    })
    this.applyContent(current.defaultContent)

    wx.setNavigationBarTitle({
      title: current.title
    })

    this.loadContent(type)
  },

  onShow() {
    if (isPageCurrent(this) && typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({ title: this.data.pageTitle || "服务指南" })
    }
    if (this._contentHasShown) this.loadContent(this.data.guideMode ? "" : this.data.type)
    this._contentHasShown = true
  },

  onUnload() {
    if (this._cancelGuideRequest) this._cancelGuideRequest()
    cancelCustomerServiceRequest(this)
    cancelPageNativeActions(this)
    this.cancelContentConfigRequest()
  },

  loadGuide(contentId) {
    if (this._cancelGuideRequest) this._cancelGuideRequest()
    if (this._guideContentId !== contentId) {
      this.setData({ guide: null, relatedVehicles: [], guideLoading: true, guideError: "", guideNotice: "" })
      this.applyContent("")
    }
    this._guideContentId = contentId
    try {
      if (contentId && typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
        const cached = wx.getStorageSync(`guide_${contentId}`)
        if (cached && cached.guide) {
          const guide = cached.guide
          this.setData({
            guide,
            guideLoading: false,
            guideError: "",
            pageTitle: guide.title,
            heroDesc: guide.summary,
            documentTitle: guide.title,
            relatedVehicles: this.buildGuideVehicles(cached.vehicles),
            guideNotice: "正在更新已保存的内容…"
          })
          this.applyContent(guide.body)
          if (isPageCurrent(this) && typeof wx.setNavigationBarTitle === "function") {
            wx.setNavigationBarTitle({ title: guide.title })
          }
        }
      }
    } catch (e) {}

    this._cancelGuideRequest = requestCloudRead({
      name: "contentGuideDetail",
      data: { contentId },
      onSuccess: (result) => {
        if (!result.guide) {
          this.handleGuideReadFailure({ code: "INVALID_RESULT" })
          return
        }
        const guide = result.guide
        if (contentId && typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
          try { wx.setStorageSync(`guide_${contentId}`, { guide, vehicles: result.vehicles }) } catch (e) {}
        }
        const attribution = sanitizeAttribution({
          ...this.data.attribution,
          contentId: guide.slug || guide.id,
          scene: guide.scenario || this.data.attribution.scene
        })
        this.setData({
          guide,
          guideLoading: false,
          guideError: "",
          guideNotice: "",
          pageTitle: guide.title,
          heroDesc: guide.summary,
          documentTitle: guide.title,
          relatedVehicles: this.buildGuideVehicles(result.vehicles),
          attribution
        })
        this.applyContent(guide.body)
        if (isPageCurrent(this) && typeof wx.setNavigationBarTitle === "function") {
          wx.setNavigationBarTitle({ title: guide.title })
        }
        trackEvent("content_view", attribution.vehicleId, attribution)
      },
      onFailure: (error) => {
        this.handleGuideReadFailure(error)
      }
    })
  },

  buildGuideVehicles(vehicles) {
    return (Array.isArray(vehicles) ? vehicles : []).map((vehicle) => ({
      ...vehicle,
      statusText: getClientVehicleStatusText(vehicle.status, "状态待确认")
    }))
  },

  handleGuideReadFailure(error) {
    if (error && ["NOT_FOUND", "VALIDATION_ERROR"].includes(error.code)) {
      try {
        if (typeof wx.removeStorageSync === "function") wx.removeStorageSync(`guide_${this._guideContentId}`)
      } catch (e) {}
      this.setData({ guide: null, relatedVehicles: [], guideLoading: false, guideError: "内容已下线或尚未发布", guideNotice: "" })
      this.applyContent("")
      return
    }
    this.setData({
      guideLoading: false,
      guideError: this.data.guide ? "" : "内容加载失败，请重试",
      guideNotice: this.data.guide ? "更新失败，当前为上次保存的内容。" : ""
    })
  },

  handleGuideRetry() {
    if (!this.data.guideLoading && this.data.attribution.contentId) {
      this.setData({ guideLoading: !this.data.guide, guideError: "", guideNotice: "" })
      this.loadGuide(this.data.attribution.contentId)
    }
  },

  handleGuideVehicleTap(event) {
    const vehicleId = String(event.currentTarget.dataset.id || "").trim()
    if (!vehicleId) return
    const targetVehicle = (this.data.relatedVehicles || []).find((item) => String(item.id || "") === vehicleId)
    if (targetVehicle) {
      try {
        const app = typeof getApp === "function" ? getApp() : null
        if (app && app.globalData) {
          app.globalData._tempCarDetailPreview = targetVehicle
        }
      } catch (e) {}
    }
    const attribution = sanitizeAttribution({ ...this.data.attribution, vehicleId })
    trackEvent("content_vehicle_click", vehicleId, attribution)
    const query = buildQuery(attribution)
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.navigateTo({
      url: `/pages/car-detail/car-detail?${query}`,
      fail: () => {
        if (isPageNativeActionActive(this, action)) wx.showToast({ title: "车辆详情打开失败", icon: "none" })
      }
    })
  },

  handleGuideBookingTap(event) {
    const vehicleId = String(event.currentTarget.dataset.id || this.data.attribution.vehicleId || "").trim()
    if (!vehicleId) return
    const attribution = sanitizeAttribution({ ...this.data.attribution, vehicleId })
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.navigateTo({
      url: `/pages/booking/booking?${buildQuery(attribution)}`,
      fail: () => {
        if (isPageNativeActionActive(this, action)) wx.showToast({ title: "预约页面打开失败", icon: "none" })
      }
    })
  },

  handleGuideVehicleImageError(event) {
    const vehicleId = String(event.currentTarget.dataset.id || "")
    this.setData({
      relatedVehicles: this.data.relatedVehicles.map((item) => item.id === vehicleId ? { ...item, cover: "" } : item)
    })
  },

  applyContent(content) {
    const document = buildDocumentSections(content)
    this.setData({
      content: String(content || ""),
      intro: document.intro,
      sections: document.sections,
      activeSectionKey: document.sections.length ? document.sections[0].key : ""
    })
  },

  handleContentTabTap(event) {
    const type = String(event.currentTarget.dataset.type || "").trim()
    if (!Object.prototype.hasOwnProperty.call(CONTENT_MAP, type) || type === this.data.type) {
      return
    }

    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.redirectTo({
      url: `/pages/content-page/content-page?type=${type}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "内容页切换失败",
          icon: "none"
        })
      }
    })
  },

  handleSectionTap(event) {
    const key = String(event.currentTarget.dataset.key || "").trim()
    if (!key || !this.data.sections.some((item) => item.key === key)) {
      return
    }

    this.setData({
      activeSectionKey: key
    })
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.pageScrollTo({
      selector: `#${key}`,
      duration: 280,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "章节定位失败",
          icon: "none"
        })
      }
    })
  },

  loadContent(type, options) {
    const contentType = String(type || "").trim()
    const field = contentType === "rules" ? "rulesContent" : contentType === "faq" ? "faqContent" : ""
    this.cancelContentConfigRequest()
    this.setData({ contentLoading: Boolean(field), contentError: "" })
    if (field) this.applyContent("")
    const handleFailure = () => {
      this.setData({
        servicePhone: "", wxKfReady: false, contentLoading: false,
        contentError: field ? "内容加载失败，请重试" : ""
      })
    }
    this._cancelContentConfigRequest = requestOperationConfig({
      force: Boolean(options && options.force),
      onSuccess: (config) => {
        this.setData({
          contentLoading: false,
          contentError: "",
          servicePhone: String(config.servicePhone || "").trim(),
          wxKfReady: hasWxKfConfig(config)
        })
        if (field) this.applyContent(String(config[field] || "").trim())
      },
      onFailure: handleFailure,
      onInvalidated: handleFailure
    })
  },

  handleContentRetry() {
    if (!this.data.guideMode && !this.data.contentLoading) this.loadContent(this.data.type, { force: true })
  },

  cancelContentConfigRequest() {
    if (typeof this._cancelContentConfigRequest === "function") {
      this._cancelContentConfigRequest()
      this._cancelContentConfigRequest = null
    }
  },

  handleOpenCustomerService() {
    const contentKey = this.data.contentKey || ""
    const pageAction = beginPageNativeAction(this, { requireCurrent: true })
    openCustomerService({
      page: this,
      source: "content:" + (contentKey || "unknown"),
      onLegacyFallback: (config) => {
        if (!isPageNativeActionActive(this, pageAction)) {
          return
        }
        this.setData({ wxKfReady: false, servicePhone: String(config && config.servicePhone || "").trim() })
        wx.showModal({
          title: "在线客服暂不可用",
          content: this.data.servicePhone ? "您可以先通过电话联系我们。" : "客服联系方式暂未提供，请稍后重试。",
          showCancel: Boolean(this.data.servicePhone),
          confirmText: this.data.servicePhone ? "电话咨询" : "知道了",
          cancelText: "知道了",
          confirmColor: "#528fff",
          success: (res) => {
            if (!isPageNativeActionActive(this, pageAction)) {
              return
            }
            if (res && res.confirm && this.data.servicePhone) {
              this.handlePhoneCall()
            }
          }
        })
      }
    })
  },

  handlePhoneCall() {
    const phone = String(this.data.servicePhone || "").trim()
    if (!phone) {
      wx.showToast({
        title: "客服电话暂不可用",
        icon: "none"
      })
      return
    }

    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: (error) => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        const message = error && (error.errMsg || error.message)
        if (message && String(message).includes("cancel")) {
          return
        }
        wx.showModal({
          title: "拨号失败",
          content: `请联系客服：${phone}`,
          confirmText: "知道了",
          confirmColor: "#528fff",
          showCancel: false
        })
      }
    })
  },

  handlePrivacyRequest() {
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.navigateTo({
      url: "/pages/privacy-request/privacy-request",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "个人信息申请打开失败",
          icon: "none"
        })
      }
    })
  },

  onShareAppMessage() {
    if (!this.data.guideMode || !this.data.guide) {
      return { title: this.data.pageTitle, path: `/pages/content-page/content-page?type=${this.data.type}` }
    }
    const attribution = sanitizeAttribution({
      ...this.data.attribution,
      channel: "wechat_share",
      scene: this.data.attribution.scene || this.data.guide.scenario || "",
      contentId: this.data.guide.slug || this.data.guide.id
    })
    return {
      title: this.data.guide.shareTitle || this.data.guide.title,
      path: `/pages/content-page/content-page?${buildQuery(attribution)}`
    }
  }
})
