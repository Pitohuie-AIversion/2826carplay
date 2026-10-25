const { trackEvent } = require("./analytics")
const { requestOperationConfig } = require("./operationConfigRequest")
const { beginPageNativeAction, isPageNativeActionActive } = require("./pageNativeAction")
const { isCustomerServiceCorpId, isCustomerServiceUrl } = require("./serviceConfig")

function hasWxKfConfig(config) {
  const cfg = config && typeof config === "object" ? config : {}
  const corpId = String(cfg.wxKfCorpId || "").trim()
  const extInfo = String(cfg.wxKfExtInfo || "").trim()
  return isCustomerServiceCorpId(corpId) && isCustomerServiceUrl(extInfo)
}

function openWxKfChat(config, context) {
  if (typeof wx !== "undefined" && typeof wx.openCustomerServiceChat === "function") {
    const corpId = String(config.wxKfCorpId || "").trim()
    const extInfo = String(config.wxKfExtInfo || "").trim()
    if (!hasWxKfConfig(config)) {
      return false
    }
    const ctx = context && typeof context === "object" ? context : {}
    const page = ctx.page || null
    const action = page ? beginPageNativeAction(page, { requireCurrent: true }) : null
    let settled = false
    const openArgs = {
      corpId,
      extInfo: { url: extInfo },
      success: () => { settled = true },
      fail: (error) => {
        if (settled) return
        settled = true
        const message = error && (error.errMsg || error.message)
        if (message && /cancel/i.test(String(message))) return
        if (action && page && !isPageNativeActionActive(page, action)) return
        if (typeof ctx.onFailure === "function") {
          ctx.onFailure(error)
          return
        }
        if (typeof wx.showToast === "function") {
          wx.showToast({ title: "暂时无法打开客服会话", icon: "none" })
        }
      }
    }
    try {
      wx.openCustomerServiceChat(openArgs)
    } catch (error) {
      openArgs.fail(error)
    }
    return true
  }
  return false
}

function openCustomerService(context) {
  const ctx = context && typeof context === "object" ? context : {}
  const page = ctx.page || null
  const vehicleId = ctx.vehicleId || ""
  const bookingId = ctx.bookingId || ""
  const source = ctx.source || ""
  const onLegacyFallback = typeof ctx.onLegacyFallback === "function" ? ctx.onLegacyFallback : null
  const action = page ? beginPageNativeAction(page, { requireCurrent: true, exclusiveKey: "customerService" }) : null
  let cancelled = false
  let cancelConfig = null
  let cancelFallbackConfig = null
  const isActive = () => !cancelled && (!page || isPageNativeActionActive(page, action))
  cancelCustomerServiceRequest(page)
  const cancel = () => {
    cancelled = true
    if (cancelConfig) cancelConfig()
    if (cancelFallbackConfig) cancelFallbackConfig()
  }
  if (page) page._cancelCustomerServiceRequest = cancel
  const fallback = (config) => {
    if (isActive() && onLegacyFallback) onLegacyFallback(config)
  }
  const refreshFallback = () => {
    if (!isActive()) return
    // Native chat can fail after a newer configuration has cleared the phone.
    // Read the current snapshot instead of restoring the one used to open chat.
    cancelFallbackConfig = requestOperationConfig({
      onSuccess: fallback,
      onFailure: () => fallback(null),
      onInvalidated: () => fallback(null)
    })
    if (cancelled) cancelFallbackConfig()
  }

  trackEvent("kf_chat", vehicleId, { channel: "miniprogram", scene: source || "page", contentId: bookingId || vehicleId || "" })

  cancelConfig = requestOperationConfig({
    onSuccess: (config) => {
      if (!isActive()) return
      if (hasWxKfConfig(config)) {
        const opened = openWxKfChat(config, { page, vehicleId, bookingId, source,
          onFailure: onLegacyFallback ? refreshFallback : undefined
        })
        if (opened) return
      }
      fallback(config)
    },
    onFailure: () => fallback(null),
    onInvalidated: () => fallback(null)
  })
  if (cancelled) cancelConfig()
  return cancel
}

function cancelCustomerServiceRequest(page) {
  if (page && typeof page._cancelCustomerServiceRequest === "function") {
    page._cancelCustomerServiceRequest()
    page._cancelCustomerServiceRequest = null
  }
}

function resolveCustomerServiceAvailability(config, callback) {
  const done = (result) => {
    if (typeof callback === "function") callback(result)
  }
  if (config && typeof config === "object") {
    done({
      hasWxKf: hasWxKfConfig(config),
      config
    })
    return
  }
  requestOperationConfig({
    onSuccess: (latest) => {
      done({
        hasWxKf: hasWxKfConfig(latest),
        config: latest
      })
    },
    onFailure: () => {
      done({ hasWxKf: false, config: null })
    }
  })
}

module.exports = {
  hasWxKfConfig,
  cancelCustomerServiceRequest,
  openCustomerService,
  openWxKfChat,
  resolveCustomerServiceAvailability
}
