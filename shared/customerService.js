const { trackEvent } = require("./analytics")
const { requestOperationConfig } = require("./operationConfigRequest")
const { beginPageNativeAction, isPageNativeActionActive } = require("./pageNativeAction")

function hasWxKfConfig(config) {
  const cfg = config && typeof config === "object" ? config : {}
  const corpId = String(cfg.wxKfCorpId || "").trim()
  const extInfo = String(cfg.wxKfExtInfo || "").trim()
  return Boolean(corpId && extInfo)
}

function openWxKfChat(config, context) {
  if (typeof wx !== "undefined" && typeof wx.openCustomerServiceChat === "function") {
    const corpId = String(config.wxKfCorpId || "").trim()
    const extInfo = String(config.wxKfExtInfo || "").trim()
    if (!corpId || !extInfo) {
      return false
    }
    const ctx = context && typeof context === "object" ? context : {}
    const page = ctx.page || null
    const action = page ? beginPageNativeAction(page, { requireCurrent: true }) : null
    const extraInfo = (() => {
      try {
        const raw = {}
        if (ctx.vehicleId) raw.vehicle_id = String(ctx.vehicleId).slice(0, 64)
        if (ctx.bookingId) raw.booking_id = String(ctx.bookingId).slice(0, 64)
        if (ctx.source) raw.source = String(ctx.source).slice(0, 32)
        const keys = Object.keys(raw)
        if (!keys.length) return extInfo
        const merged = Object.assign({}, parseExtInfoPayload(extInfo), raw)
        return safeBase64Encode(JSON.stringify(merged))
      } catch (error) {
        return extInfo
      }
    })()
    const openArgs = {
      corpId,
      extInfo: extraInfo,
      fail: (error) => {
        const message = error && (error.errMsg || error.message)
        if (message && String(message).includes("cancel")) return
        if (action && page && !isPageNativeActionActive(page, action)) return
        if (typeof wx.showToast === "function") {
          wx.showToast({ title: "暂时无法打开客服会话", icon: "none" })
        }
      }
    }
    if (typeof openArgs.showMessageCard === "undefined") {
      openArgs.showMessageCard = true
    }
    wx.openCustomerServiceChat(openArgs)
    return true
  }
  return false
}

function parseExtInfoPayload(extInfo) {
  try {
    const decoded = safeBase64Decode(String(extInfo || ""))
    if (!decoded) return {}
    const parsed = JSON.parse(decoded)
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch (error) {
    return {}
  }
}

function safeBase64Encode(text) {
  try {
    if (typeof wx !== "undefined" && typeof wx.arrayBufferToBase64 === "function") {
      const bytes = unescape(encodeURIComponent(String(text || "")))
      const buffer = new Uint8Array(bytes.length)
      for (let i = 0; i < bytes.length; i += 1) buffer[i] = bytes.charCodeAt(i)
      return wx.arrayBufferToBase64(buffer.buffer)
    }
  } catch (error) {}
  return String(text || "")
}

function safeBase64Decode(encoded) {
  try {
    if (typeof wx !== "undefined" && typeof wx.base64ToArrayBuffer === "function") {
      const buffer = wx.base64ToArrayBuffer(String(encoded || ""))
      const bytes = new Uint8Array(buffer)
      let result = ""
      for (let i = 0; i < bytes.length; i += 1) result += String.fromCharCode(bytes[i])
      return decodeURIComponent(escape(result))
    }
  } catch (error) {}
  return ""
}

function openCustomerService(context) {
  const ctx = context && typeof context === "object" ? context : {}
  const page = ctx.page || null
  const vehicleId = ctx.vehicleId || ""
  const bookingId = ctx.bookingId || ""
  const source = ctx.source || ""
  const onLegacyFallback = typeof ctx.onLegacyFallback === "function" ? ctx.onLegacyFallback : null

  trackEvent("kf_chat", vehicleId, { channel: "miniprogram", scene: source || "page", contentId: bookingId || vehicleId || "" })

  requestOperationConfig({
    onSuccess: (config) => {
      if (hasWxKfConfig(config)) {
        const opened = openWxKfChat(config, { page, vehicleId, bookingId, source })
        if (opened) return
      }
      if (typeof onLegacyFallback === "function") {
        onLegacyFallback(config)
      }
    },
    onFailure: () => {
      if (typeof onLegacyFallback === "function") {
        onLegacyFallback(null)
      }
    }
  })
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
  openCustomerService,
  openWxKfChat,
  resolveCustomerServiceAvailability
}
