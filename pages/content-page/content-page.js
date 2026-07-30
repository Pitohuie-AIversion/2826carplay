const CONTENT_MAP = {
  faq: {
    title: "常见问题",
    heroDesc: "关于预约、档期与服务流程的常见解答",
    documentTitle: "快速了解服务问题",
    defaultContent:
      "1. 预约提交后，客服会尽快联系您确认档期与细节。\n2. 车辆价格、押金与取还车规则以最终沟通结果为准。\n3. 如需取消预约，可前往【我的预约】操作。"
  },
  rules: {
    title: "平台规则",
    heroDesc: "使用极境车库服务前需要了解的约定",
    documentTitle: "服务规则与使用约定",
    defaultContent:
      "1. 车辆展示信息仅供参考，具体以客服最终确认为准。\n2. 预约不代表最终成交，需以档期、资质与规则审核结果为准。\n3. 平台保留对异常预约、恶意占用档期等行为的处理权利。"
  },
  privacy: {
    title: "隐私政策",
    heroDesc: "了解我们如何收集、使用与保护您的信息",
    documentTitle: "个人信息处理说明",
    defaultContent:
      "更新日期：2026年7月29日\n\n1. 信息收集\n当您提交车辆预约时，我们会收集您主动填写的姓名、手机号、取还车日期、城市及备注，并通过微信提供的 OpenID 识别和展示您本人的预约记录。为改进车辆内容与预约流程，我们还会记录不包含 OpenID 和表单内容的页面行为类型、车辆 ID 与发生时间。\n\n2. 使用目的\n预约信息仅用于车辆预约登记、客服沟通、档期确认、预约查询与取消，以及必要的安全审计和故障排查。匿名行为事件仅用于汇总车辆关注度和预约转化趋势，不用于建立用户个人行为画像。\n\n3. 保存与保护\n信息存储在微信云开发环境中，仅授权工作人员可按职责访问。我们仅在实现预约服务和履行法定义务所必需的期限内保存；目的实现后将依法删除或匿名化，法律法规另有要求的除外。\n\n4. 信息共享\n除提供云开发基础设施所必需的处理、取得您的另行同意或法律法规要求外，我们不会主动向第三方出售或提供您的个人信息。\n\n5. 您的权利\n您可以在【我的预约】查看和取消预约。如需查询、更正或删除个人信息，可通过【我的 → 个人信息申请】在线提交，并查看处理进度与反馈。\n\n6. 未成年人保护\n未成年人应在监护人同意和指导下使用预约服务。\n\n7. 联系我们\n如对本政策或个人信息处理有疑问，请通过小程序内在线客服或客服电话联系极境车库运营方。"
  }
}

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
    servicePhone: "15715710090"
  },

  onLoad(options) {
    const type = String((options && options.type) || "faq").trim()
    const current = CONTENT_MAP[type] || CONTENT_MAP.faq
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

  applyContent(content) {
    const document = buildDocumentSections(content)
    this.setData({
      content: String(content || ""),
      intro: document.intro,
      sections: document.sections
    })
  },

  loadContent(type) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return
    }

    wx.cloud.callFunction({
      name: "operationConfigGet",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.config) {
          return
        }

        this.setData({
          servicePhone: result.config.servicePhone || this.data.servicePhone
        })

        const field =
          type === "rules"
            ? "rulesContent"
            : type === "faq"
              ? "faqContent"
              : ""
        if (!field) {
          return
        }
        const nextContent = result.config[field]
        if (!nextContent) {
          return
        }

        this.applyContent(nextContent)
      },
      fail: () => {}
    })
  },

  handlePhoneCall() {
    wx.makePhoneCall({
      phoneNumber: this.data.servicePhone,
      fail: () => {
        wx.showToast({
          title: `请联系客服：${this.data.servicePhone}`,
          icon: "none"
        })
      }
    })
  },

  handlePrivacyRequest() {
    wx.navigateTo({
      url: "/pages/privacy-request/privacy-request",
      fail: () => {
        wx.showToast({
          title: "个人信息申请打开失败",
          icon: "none"
        })
      }
    })
  }
})
