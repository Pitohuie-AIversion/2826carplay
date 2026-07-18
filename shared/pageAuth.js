function redirectToMine() {
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : []

  if (pages.length > 1) {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.redirectTo({
          url: "/pages/mine/mine",
          fail: () => {
            wx.reLaunch({
              url: "/pages/mine/mine"
            })
          }
        })
      }
    })
    return
  }

  wx.redirectTo({
    url: "/pages/mine/mine",
    fail: () => {
      wx.reLaunch({
        url: "/pages/mine/mine"
      })
    }
  })
}

function resolveAllowed(result, required) {
  if (!result || !result.ok) {
    return false
  }

  if (typeof required === "function") {
    return Boolean(required(result))
  }

  if (typeof required === "string") {
    return Boolean(result[required])
  }

  return false
}

function requirePagePermission(page, options) {
  const config = options && typeof options === "object" ? options : {}
  const required = config.required
  const noPermissionMessage = config.noPermissionMessage || "无权访问该页面"
  const failMessage = config.failMessage || "权限校验失败，请稍后重试"

  if (!page || typeof page.setData !== "function") {
    return
  }

  if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
    wx.showToast({
      title: "云能力未初始化",
      icon: "none"
    })
    setTimeout(redirectToMine, 500)
    return
  }

  page.setData({
    pageAuthorized: false
  })

  wx.cloud.callFunction({
    name: "getMyPermissions",
    success: (res) => {
      const result = res && res.result ? res.result : null
      const allowed = resolveAllowed(result, required)

      if (!allowed) {
        wx.showToast({
          title: noPermissionMessage,
          icon: "none"
        })
        setTimeout(redirectToMine, 700)
        return
      }

      page.setData({
        pageAuthorized: true
      })

      if (typeof config.onAuthorized === "function") {
        config.onAuthorized(result)
      }
    },
    fail: (error) => {
      wx.showToast({
        title: (error && (error.errMsg || error.message)) || failMessage,
        icon: "none"
      })
      setTimeout(redirectToMine, 700)
    }
  })
}

module.exports = {
  requirePagePermission
}
