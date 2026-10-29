function activatePageNativeActions(page) {
  if (!page || typeof page !== "object") {
    return
  }
  page._nativeActionsUnloaded = false
  page._nativeActionLifecycleSerial = Number(page._nativeActionLifecycleSerial || 0) + 1
  page._nativeActionExclusiveSerials = {}
}

function isPageCurrent(page) {
  if (!page || typeof page !== "object" || typeof getCurrentPages !== "function") {
    return true
  }
  if (typeof getApp === "function") {
    try {
      const app = getApp()
      if (app && app.globalData && app.globalData.nativeActionAppVisible === false) {
        return false
      }
    } catch (error) {}
  }
  const pages = getCurrentPages()
  if (!Array.isArray(pages) || !pages.length) {
    return true
  }
  return pages[pages.length - 1] === page
}

function beginPageNativeAction(page, options) {
  if (!page || typeof page !== "object") {
    return null
  }
  const config = options && typeof options === "object" ? options : {}
  const exclusiveKey = String(config.exclusiveKey || "").trim()
  let exclusiveSerial = 0
  if (exclusiveKey) {
    if (!page._nativeActionExclusiveSerials || typeof page._nativeActionExclusiveSerials !== "object") {
      page._nativeActionExclusiveSerials = {}
    }
    exclusiveSerial = Number(page._nativeActionExclusiveSerials[exclusiveKey] || 0) + 1
    page._nativeActionExclusiveSerials[exclusiveKey] = exclusiveSerial
  }
  return {
    lifecycleSerial: Number(page._nativeActionLifecycleSerial || 0),
    requireCurrent: Boolean(config.requireCurrent),
    exclusiveKey,
    exclusiveSerial
  }
}

function isPageNativeActionActive(page, action) {
  if (!page || !action || page._nativeActionsUnloaded === true) {
    return false
  }
  if (Number(page._nativeActionLifecycleSerial || 0) !== action.lifecycleSerial) {
    return false
  }
  if (
    action.exclusiveKey &&
    Number(
      page._nativeActionExclusiveSerials &&
      page._nativeActionExclusiveSerials[action.exclusiveKey]
    ) !== action.exclusiveSerial
  ) {
    return false
  }
  return !action.requireCurrent || isPageCurrent(page)
}

function cancelPageNativeActions(page) {
  if (!page || typeof page !== "object") {
    return
  }
  page._nativeActionsUnloaded = true
  page._nativeActionLifecycleSerial = Number(page._nativeActionLifecycleSerial || 0) + 1
  page._nativeActionExclusiveSerials = {}
}

module.exports = {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageCurrent,
  isPageNativeActionActive
}
