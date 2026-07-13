function mapStatusText(status) {
  const value = String(status || "").trim()
  if (value === "contacted") {
    return "已联系"
  }
  if (value === "completed") {
    return "已完成"
  }
  if (value === "cancelled") {
    return "已取消"
  }
  return "待联系"
}

Page({
  data: {
    loading: false,
    list: []
  },

  onLoad() {
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
  },

  onShow() {
    this.loadList()
  },

  loadList() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        list: []
      })
      return
    }

    this.setData({
      loading: true
    })

    wx.cloud.callFunction({
      name: "bookingMyList",
      data: { limit: 30 },
      success: (res) => {
        const result = res && res.result ? res.result : null
        const rawList = result && result.ok && Array.isArray(result.list) ? result.list : []
        const list = rawList.map((item) => ({
          ...item,
          statusText: mapStatusText(item.status)
        }))
        this.setData({
          loading: false,
          list
        })
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "加载失败",
          icon: "none"
        })
        this.setData({
          loading: false,
          list: []
        })
      }
    })
  },

  handleBackGarage() {
    wx.redirectTo({
      url: "/pages/garage/garage",
      fail: () => {
        wx.reLaunch({
          url: "/pages/garage/garage"
        })
      }
    })
  }
})

