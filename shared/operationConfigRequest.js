const { getCached, setCache, invalidateCache } = require("./cloudDataCache")

const OPERATION_CONFIG_TIMEOUT_MS = 10 * 1000
const OPERATION_CONFIG_CACHE_KEY = "operation_config_v1"
const OPERATION_CONFIG_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

let lastWxEnv = null

function clearOperationConfigCache() {
  invalidateCache(OPERATION_CONFIG_CACHE_KEY)
}

function checkWxEnvReset() {
  const currentWx = typeof wx !== "undefined" ? wx : null
  if (currentWx !== lastWxEnv) {
    lastWxEnv = currentWx
    clearOperationConfigCache()
  }
}

function requestOperationConfig(input) {
  checkWxEnvReset()
  const options = input && typeof input === "object" ? input : {}
  const force = Boolean(options.force)

  // 1. 优先读取有效缓存
  const cached = getCached(OPERATION_CONFIG_CACHE_KEY, OPERATION_CONFIG_CACHE_TTL_MS)
  if (cached && !force) {
    let cancelled = false
    const cancel = () => {
      cancelled = true
    }
    const deliver = () => {
      if (!cancelled && typeof options.onSuccess === "function") {
        options.onSuccess(cached)
      }
    }
    if (typeof wx !== "undefined" && typeof wx.nextTick === "function") {
      wx.nextTick(deliver)
    } else {
      setTimeout(deliver, 0)
    }
    return cancel
  }

  let settled = false
  let timeoutId = null

  const finish = (callback) => {
    if (settled) {
      return false
    }
    settled = true
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (typeof callback === "function") {
      callback()
    }
    return true
  }
  const fail = (reason) => {
    finish(() => {
      if (typeof options.onFailure === "function") {
        options.onFailure(reason)
      }
    })
  }
  const cancel = () => {
    finish()
  }

  if (
    typeof wx === "undefined" ||
    !wx.cloud ||
    typeof wx.cloud.callFunction !== "function"
  ) {
    fail({ code: "CLOUD_UNAVAILABLE" })
    return cancel
  }

  timeoutId = setTimeout(() => {
    fail({ code: "TIMEOUT" })
  }, OPERATION_CONFIG_TIMEOUT_MS)

  const requestOptions = {
    name: "operationConfigGet",
    success: (res) => {
      const result = res && res.result ? res.result : null
      if (!result || !result.ok || !result.config) {
        fail({
          code: (result && result.code) || "INVALID_RESULT",
          message: result && result.message
        })
        return
      }
      setCache(OPERATION_CONFIG_CACHE_KEY, result.config)
      finish(() => {
        if (typeof options.onSuccess === "function") {
          options.onSuccess(result.config)
        }
      })
    },
    fail
  }

  try {
    wx.cloud.callFunction(requestOptions)
  } catch (error) {
    fail(error)
  }

  return cancel
}

module.exports = {
  OPERATION_CONFIG_TIMEOUT_MS,
  OPERATION_CONFIG_CACHE_TTL_MS,
  requestOperationConfig,
  clearOperationConfigCache
}
