const ROUTES = {
  garage: "/pages/garage/garage",
  favorites: "/pages/favorites/favorites",
  bookings: "/pages/bookings/bookings",
  mine: "/pages/mine/mine"
}
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

function getRoutePath(page) {
  return String((page && (page.route || page.__route__)) || "").replace(/^\//, "")
}

Component({
  lifetimes: {
    attached() {
      activatePageNativeActions(this)
    },
    detached() {
      cancelPageNativeActions(this)
    }
  },

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
      const action = beginPageNativeAction(this)

      const targetRoute = url.replace(/^\//, "")
      const pages = typeof getCurrentPages === "function" ? getCurrentPages() : []
      let existingIndex = -1
      for (let index = pages.length - 2; index >= 0; index -= 1) {
        if (getRoutePath(pages[index]) === targetRoute) {
          existingIndex = index
          break
        }
      }

      const fallback = () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.redirectTo({
          url,
          fail: () => {
            if (!isPageNativeActionActive(this, action)) {
              return
            }
            wx.reLaunch({
              url,
              fail: () => {
                if (!isPageNativeActionActive(this, action)) {
                  return
                }
                wx.showToast({
                  title: "页面切换失败",
                  icon: "none"
                })
              }
            })
          }
        })
      }

      if (existingIndex >= 0 && typeof wx.navigateBack === "function") {
        wx.navigateBack({
          delta: pages.length - 1 - existingIndex,
          fail: fallback
        })
        return
      }

      if (typeof wx.navigateTo === "function") {
        wx.navigateTo({
          url,
          fail: fallback
        })
        return
      }

      fallback()
    }
  }
})
