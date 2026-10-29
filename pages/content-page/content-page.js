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
    heroDesc: "使用爱迦租车服务前需要了解的约定",
    documentTitle: "服务规则与使用约定"
  },
  privacy: {
    title: "隐私政策",
    heroDesc: "了解我们如何收集、使用与保护您的信息",
    documentTitle: "个人信息处理说明",
    defaultContent: [
      "更新日期：2026年10月25日",
      "1. 预约与服务记录\n提交预约时，我们收集您主动填写的姓名、手机号、取还车日期、城市、取还车地点及备注，并通过微信提供的 OpenID 识别您本人的预约。预约信息、报价沟通和交接核对记录用于预约登记、客服沟通、档期与费用确认、查询和取消，以及必要的安全审计和故障排查。",
      "2. 收藏与本机联系人\n您主动收藏车辆时，我们将 OpenID、车辆编号和收藏时间保存到微信云开发环境，用于在【心仪车库】展示和管理您的收藏。取消收藏会移除对应收藏记录。成功提交预约后，本机还会保存本次联系人的姓名和手机号，供您下次主动点击【使用上次联系人】时填入；不会在打开页面时自动填入。您可在预约页点击【清除本机联系人】删除这份本地记忆；当前已填表单和云端预约不会因此删除。再次成功提交预约会保存新的联系人。",
      "3. 照片、相册与剪切板\n工作人员主动选择车辆或交接照片时，小程序会通过微信选图功能取得所选图片并上传至云存储，用于车辆展示和取还车留证；交接照片与对应预约关联，供有权限的工作人员及该预约用户核对。请勿上传与服务无关的个人照片。您主动点击保存海报时，小程序申请相册写入权限，将海报保存到系统相册，不读取相册中的其他照片。您主动点击复制时，小程序将页面明确展示的车辆编号、预约信息或咨询内容写入剪切板，不主动读取已有剪切板内容。拒绝相关授权不影响浏览车辆和其他无需该权限的功能。",
      "4. 匿名使用统计\n为改进车辆内容与预约流程，我们记录页面行为类型、可选内容 ID、车辆 ID、渠道与场景枚举及发生时间，不包含 OpenID、预约 ID 和表单内容。匿名事件仅用于汇总内容与车辆关注度、分享落地和预约转化趋势，不用于建立用户个人行为画像。",
      "5. 保存与保护\n预约、收藏及交接等服务信息存储在微信云开发环境中，仅本人和授权工作人员可按功能及职责访问；上次联系人记忆保存在当前设备的小程序本地存储中。我们仅在实现服务和履行法定义务所必需的期限内保存信息；目的实现后将依法删除或匿名化，法律法规另有要求的除外。",
      "6. 信息共享\n除提供云开发基础设施所必需的处理、取得您的另行同意或法律法规要求外，我们不会主动向第三方出售或提供您的个人信息。",
      "7. 您的权利与清除方式\n您可以在【我的预约】查看预约，并在支持修改或取消的状态下操作；在【心仪车库】取消收藏，在预约页清除本机联系人。取消预约不等于删除预约记录。如需查询、更正或删除其他个人信息，可通过【我的 → 个人信息申请】提交，工作人员核验后处理，您可查看进度与反馈；提交申请不会立即自动删除云端记录。已保存到系统相册的海报需由您在相册中删除，剪切板内容可通过设备提供的功能管理。",
      "8. 未成年人保护\n未成年人应在监护人同意和指导下使用预约服务。",
      "9. 联系我们\n如对本政策或个人信息处理有疑问，请通过小程序内在线客服或客服电话联系爱迦租车运营方。"
    ].join("\n\n")
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
    if (this._contentHasShown) {
      this.loadContent(this.data.guideMode ? "" : this.data.type)
      if (this.data.guideMode && this._guideContentId) this.loadGuide(this._guideContentId)
    }
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
    this.setData({
      guideLoading: !this.data.guide,
      guideError: "",
      guideNotice: this.data.guide ? "正在更新已保存的内容…" : ""
    })
    try {
      if (!this.data.guide && contentId && typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
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
    } catch (e) { console.error(e) }

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
          try { wx.setStorageSync(`guide_${contentId}`, { guide, vehicles: result.vehicles }) } catch (e) { console.error(e) }
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
      } catch (e) { console.error(e) }
      this.setData({
        guide: null, relatedVehicles: [], guideLoading: false,
        guideError: "内容已下线或尚未发布", guideNotice: "",
        pageTitle: "场景指南", heroDesc: "内容已下线或尚未发布", documentTitle: ""
      })
      this.applyContent("")
      if (isPageCurrent(this) && typeof wx.setNavigationBarTitle === "function") {
        wx.setNavigationBarTitle({ title: "场景指南" })
      }
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
      } catch (e) { console.error(e) }
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
        if (!isPageNativeActionActive(this, action) || String(this.data.servicePhone || "").trim() !== phone) {
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
