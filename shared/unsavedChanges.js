const DEFAULT_MESSAGE = "当前有未保存的修改，确定离开吗？"

function setUnsavedChanges(page, dirty, message) {
  if (!page) {
    return
  }

  const nextDirty = Boolean(dirty)
  page._hasUnsavedChanges = nextDirty

  if (typeof wx === "undefined") {
    return
  }

  if (nextDirty) {
    if (page._unsavedAlertEnabled || typeof wx.enableAlertBeforeUnload !== "function") {
      return
    }
    try {
      wx.enableAlertBeforeUnload({
        message: String(message || DEFAULT_MESSAGE)
      })
      page._unsavedAlertEnabled = true
    } catch (error) {}
    return
  }

  if (!page._unsavedAlertEnabled || typeof wx.disableAlertBeforeUnload !== "function") {
    page._unsavedAlertEnabled = false
    return
  }
  try {
    wx.disableAlertBeforeUnload()
  } catch (error) {}
  page._unsavedAlertEnabled = false
}

function markUnsaved(page, message) {
  setUnsavedChanges(page, true, message)
}

function clearUnsaved(page) {
  setUnsavedChanges(page, false)
}

module.exports = {
  DEFAULT_MESSAGE,
  clearUnsaved,
  markUnsaved,
  setUnsavedChanges
}
