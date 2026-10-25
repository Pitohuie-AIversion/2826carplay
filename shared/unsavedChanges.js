const { beginPageNativeAction, isPageCurrent, isPageNativeActionActive } = require("./pageNativeAction")

const DEFAULT_MESSAGE = "当前有未保存的修改，确定离开吗？"

function syncUnsavedChanges(page) {
  if (!page || page._unsavedChangesDisposed || page._nativeActionsUnloaded ||
      typeof wx === "undefined" || !isPageCurrent(page)) {
    return
  }

  const nextDirty = Boolean(page._hasUnsavedChanges)
  const pending = page._unsavedAlertPending
  if (pending && pending.dirty === nextDirty) {
    return
  }
  if (!pending && !page._unsavedAlertNeedsSync && Boolean(page._unsavedAlertEnabled) === nextDirty) {
    return
  }
  const method = nextDirty ? "enableAlertBeforeUnload" : "disableAlertBeforeUnload"
  if (typeof wx[method] !== "function") {
    return
  }

  const action = beginPageNativeAction(page, { requireCurrent: true })
  const request = { dirty: nextDirty }
  page._unsavedAlertPending = request
  const finish = (succeeded) => {
    if (page._unsavedChangesDisposed || page._unsavedAlertPending !== request) return
    page._unsavedAlertPending = null
    if (!isPageNativeActionActive(page, action)) {
      // The result belongs to a hidden page; reconcile only when it is shown again.
      page._unsavedAlertNeedsSync = true
      return
    }
    if (!succeeded) {
      page._unsavedAlertNeedsSync = true
      return
    }
    page._unsavedAlertEnabled = nextDirty
    page._unsavedAlertNeedsSync = false
    if (Boolean(page._hasUnsavedChanges) !== nextDirty) syncUnsavedChanges(page)
  }
  const options = {
    success: () => finish(true),
    fail: () => finish(false)
  }
  if (nextDirty) options.message = page._unsavedAlertMessage || DEFAULT_MESSAGE
  try {
    wx[method](options)
  } catch (error) {
    finish(false)
  }
}

function setUnsavedChanges(page, dirty, message) {
  if (!page || page._unsavedChangesDisposed) return
  page._hasUnsavedChanges = Boolean(dirty)
  if (dirty) page._unsavedAlertMessage = String(message || DEFAULT_MESSAGE)
  syncUnsavedChanges(page)
}

function disposeUnsavedChanges(page) {
  if (!page) return
  // The native page owns its alert. Unload must not disable the next page's alert.
  page._unsavedChangesDisposed = true
  page._hasUnsavedChanges = false
  page._unsavedAlertEnabled = false
  page._unsavedAlertPending = null
  page._unsavedAlertNeedsSync = false
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
  disposeUnsavedChanges,
  markUnsaved,
  setUnsavedChanges,
  syncUnsavedChanges
}
