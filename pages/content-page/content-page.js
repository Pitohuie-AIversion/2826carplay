const CONTENT_MAP = {
  faq: {
    title: "常见问题",
    defaultContent:
      "1. 预约提交后，客服会尽快联系您确认档期与细节。\n2. 车辆价格、押金与取还车规则以最终沟通结果为准。\n3. 如需取消预约，可前往【我的预约】操作。"
  },
  rules: {
    title: "平台规则",
    defaultContent:
      "1. 车辆展示信息仅供参考，具体以客服最终确认为准。\n2. 预约不代表最终成交，需以档期、资质与规则审核结果为准。\n3. 平台保留对异常预约、恶意占用档期等行为的处理权利。"
  }
}

Page({
  data: {
    type: "faq",
    pageTitle: "常见问题",
    content: ""
  },

  onLoad(options) {
    const type = String((options && options.type) || "faq").trim()
    const current = CONTENT_MAP[type] || CONTENT_MAP.faq
    this.setData({
      type,
      pageTitle: current.title,
      content: current.defaultContent
    })

    wx.setNavigationBarTitle({
      title: current.title
    })

    this.loadContent(type)
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

        const field = type === "rules" ? "rulesContent" : "faqContent"
        const nextContent = result.config[field]
        if (!nextContent) {
          return
        }

        this.setData({
          content: nextContent
        })
      },
      fail: () => {}
    })
  }
})
