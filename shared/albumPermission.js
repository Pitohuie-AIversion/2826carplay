const { beginPageNativeAction, isPageNativeActionActive } = require("./pageNativeAction")

function handleAlbumSaveError(page, error, isSaveActive) {
  const action = beginPageNativeAction(page, { requireCurrent: true, exclusiveKey: "album-permission" })
  const isActive = () => isPageNativeActionActive(page, action) &&
    (typeof isSaveActive !== "function" || isSaveActive())
  const toast = (title) => {
    if (isActive() && typeof wx.showToast === "function") wx.showToast({ title, icon: "none" })
  }
  if (!isActive()) return
  const message = String(error && (error.errMsg || error.message) || "").toLowerCase()
  const errno = Number(error && (error.errno === undefined ? error.errCode : error.errno))
  if (message.includes("cancel")) return
  if (errno === 112 || /appid privacy api banned|privacy.*(?:not declared|not configured)/.test(message)) {
    toast("相册功能暂不可用")
    return
  }
  if (errno === 104 || message.includes("privacy")) {
    toast("请先同意隐私指引")
    return
  }
  if (errno !== 103 && !/auth|denied|deny/.test(message)) {
    toast("保存未完成，请重试")
    return
  }

  let prompted = false
  const offerSettings = () => {
    if (!isActive() || prompted) return
    prompted = true
    if (typeof wx.showModal !== "function" || typeof wx.openSetting !== "function") {
      toast("请在设置开启相册权限")
      return
    }
    try {
      wx.showModal({
        title: "开启相册保存权限",
        content: "保存海报需要相册写入权限。您可以前往设置开启，返回后再次点击保存。",
        confirmText: "去设置",
        cancelText: "暂不开启",
        success: (choice) => {
          if (!isActive() || !choice || !choice.confirm) return
          try {
            wx.openSetting({
              success: (result) => {
                if (!isActive()) return
                toast(result && result.authSetting && result.authSetting["scope.writePhotosAlbum"] === true
                  ? "已授权，请再次保存"
                  : "未授权，海报未保存")
              },
              fail: () => toast("设置未打开，请重试")
            })
          } catch (error) { toast("设置未打开，请重试") }
        }
      })
    } catch (error) { toast("请在设置开启相册权限") }
  }
  const checkAlbumPermission = () => {
    if (!isActive()) return
    if (typeof wx.getSetting !== "function") {
      toast("相册权限读取失败")
      return
    }
    try {
      wx.getSetting({
        success: (result) => {
          if (!isActive()) return
          const granted = result && result.authSetting && result.authSetting["scope.writePhotosAlbum"]
          if (granted === false) offerSettings()
          else toast(granted === true ? "请检查微信相册权限" : "请再次保存并授权")
        },
        fail: () => toast("相册权限读取失败")
      })
    } catch (error) { toast("相册权限读取失败") }
  }
  // An authorization rejection can come from either the privacy prompt or the album scope.
  if (typeof wx.getPrivacySetting === "function") {
    try {
      wx.getPrivacySetting({
        success: (result) => {
          if (!isActive()) return
          if (result && result.needAuthorization) toast("请先同意隐私指引")
          else checkAlbumPermission()
        },
        fail: () => toast("授权状态读取失败")
      })
    } catch (error) { toast("授权状态读取失败") }
  } else {
    checkAlbumPermission()
  }
}

module.exports = { handleAlbumSaveError }
