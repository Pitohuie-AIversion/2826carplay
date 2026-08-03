const ROUTES = {
  garage: "/pages/garage/garage",
  favorites: "/pages/favorites/favorites",
  bookings: "/pages/bookings/bookings",
  mine: "/pages/mine/mine"
}

Component({
  properties: {
    activeKey: {
      type: String,
      value: "garage"
    }
  },

  methods: {
    handleNavigate(event) {
      const key = String(event.currentTarget.dataset.key || "")
      const url = ROUTES[key]
      if (!url || key === this.data.activeKey) {
        return
      }

      wx.redirectTo({
        url,
        fail: () => {
          wx.reLaunch({
            url,
            fail: () => {
              wx.showToast({
                title: "页面切换失败",
                icon: "none"
              })
            }
          })
        }
      })
    }
  }
})
