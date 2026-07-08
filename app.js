App({
  onLaunch() {
    if (!wx.cloud || typeof wx.cloud.init !== "function") {
      return
    }

    try {
      wx.cloud.init({
        env: this.globalData.cloudEnvId,
        traceUser: true
      })
    } catch (error) {}
  },

  globalData: {
    cloudEnvId: "cloud1-d8gtmns36320e045e"
  }
})
