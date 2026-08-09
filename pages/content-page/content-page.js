const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

const CONTENT_MAP = {
  faq: {
    title: "常见问题",
    heroDesc: "关于预约、档期与服务流程的常见解答",
    documentTitle: "快速了解服务问题",
    defaultContent:
      "1. 提交预约后多久会联系？\n客服会尽快与您确认车辆档期、价格和取还车细节，预约提交不代表最终成交。\n\n2. 页面价格是最终价格吗？\n页面展示信息用于初步了解，实际价格、押金和服务规则以顾问最终确认结果为准。\n\n3. 如何查看或取消预约？\n前往【我的 → 我的预约】即可查看处理进度；符合条件的进行中预约可在线取消。\n\n4. 收藏车辆有什么作用？\n进入车辆详情点击收藏后，可在【我的 → 我的收藏】集中查看，并快速筛选当前可预约车辆。"
  },
  rules: {
    title: "平台规则",
    heroDesc: "使用极境车库服务前需要了解的约定",
    documentTitle: "服务规则与使用约定",
    defaultContent:
      "1. 车辆展示\n车辆图片、配置、价格和状态用于服务介绍，具体情况以客服最终确认为准。\n\n2. 预约确认\n提交预约仅代表表达用车意向，不代表最终成交；档期、资质与规则仍需进一步确认。\n\n3. 档期与价格\n车辆档期、押金、取还车方式及最终费用以双方确认结果为准。\n\n4. 合理使用\n平台可对异常预约、重复占用档期或影响正常服务的行为进行必要处理。"
  },
  privacy: {
    title: "隐私政策",
    heroDesc: "了解我们如何收集、使用与保护您的信息",
    documentTitle: "个人信息处理说明",
    defaultContent:
      "更新日期：2026年7月29日\n\n1. 信息收集\n当您提交车辆预约时，我们会收集您主动填写的姓名、手机号、取还车日期、城市及备注，并通过微信提供的 OpenID 识别和展示您本人的预约记录。为改进车辆内容与预约流程，我们还会记录不包含 OpenID 和表单内容的页面行为类型、车辆 ID 与发生时间。\n\n2. 使用目的\n预约信息仅用于车辆预约登记、客服沟通、档期确认、预约查询与取消，以及必要的安全审计和故障排查。匿名行为事件仅用于汇总车辆关注度和预约转化趋势，不用于建立用户个人行为画像。\n\n3. 保存与保护\n信息存储在微信云开发环境中，仅授权工作人员可按职责访问。我们仅在实现预约服务和履行法定义务所必需的期限内保存；目的实现后将依法删除或匿名化，法律法规另有要求的除外。\n\n4. 信息共享\n除提供云开发基础设施所必需的处理、取得您的另行同意或法律法规要求外，我们不会主动向第三方出售或提供您的个人信息。\n\n5. 您的权利\n您可以在【我的预约】查看和取消预约。如需查询、更正或删除个人信息，可通过【我的 → 个人信息申请】在线提交，并查看处理进度与反馈。\n\n6. 未成年人保护\n未成年人应在监护人同意和指导下使用预约服务。\n\n7. 联系我们\n如对本政策或个人信息处理有疑问，请通过小程序内在线客服或客服电话联系极境车库运营方。"
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
    intro: "",
    sections: [],
    contentTabs: CONTENT_TABS,
    activeSectionKey: "",
    servicePhone: "15715710090"
  },

  onLoad(options) {
    activatePageNativeActions(this)
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

  onUnload() {
    cancelPageNativeActions(this)
    this.cancelContentConfigRequest()
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

    const action = beginPageNativeAction(this)
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

  loadContent(type) {
    const contentType = String(type || "").trim()
    this.cancelContentConfigRequest()
    this._cancelContentConfigRequest = requestOperationConfig({
      onSuccess: (config) => {
        this.setData({
          servicePhone: config.servicePhone || this.data.servicePhone
        })

        const field =
          contentType === "rules"
            ? "rulesContent"
            : contentType === "faq"
              ? "faqContent"
              : ""
        if (!field) {
          return
        }
        const nextContent = config[field]
        if (!nextContent) {
          return
        }

        this.applyContent(nextContent)
      }
    })
  },

  cancelContentConfigRequest() {
    if (typeof this._cancelContentConfigRequest === "function") {
      this._cancelContentConfigRequest()
      this._cancelContentConfigRequest = null
    }
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
    const action = beginPageNativeAction(this)
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
  }
})
