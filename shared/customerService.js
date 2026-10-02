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
  const isActive = () => !cancelled && (!page || isPageNativeActionActive(page, action))
  cancelCustomerServiceRequest(page)

  trackEvent("kf_chat", vehicleId, { channel: "miniprogram", scene: source || "page", contentId: bookingId || vehicleId || "" })

  const cancelConfig = requestOperationConfig({
    onSuccess: (config) => {
      if (!isActive()) return
      if (hasWxKfConfig(config)) {
        const opened = openWxKfChat(config, { page, vehicleId, bookingId, source,
          onFailure: onLegacyFallback ? () => { if (isActive()) onLegacyFallback(config) } : undefined
        })
        if (opened) return
      }
      if (typeof onLegacyFallback === "function") {
        onLegacyFallback(config)
      }
    },
    onFailure: () => {
      if (!isActive()) return
      if (typeof onLegacyFallback === "function") {
        onLegacyFallback(null)
      }
    }
  })
  const cancel = () => { cancelled = true; cancelConfig() }
  if (page) page._cancelCustomerServiceRequest = cancel
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
