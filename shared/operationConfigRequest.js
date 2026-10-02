const { getCached, setCache, invalidateCache } = require("./cloudDataCache")

const OPERATION_CONFIG_TIMEOUT_MS = 10 * 1000
const OPERATION_CONFIG_CACHE_KEY = "operation_config_v1"
const OPERATION_CONFIG_CACHE_TTL_MS = 10 * 60 * 1000 // 10 minutes

let lastWxEnv = null
let cacheRevision = 0
let latestRequestId = 0
let latestCompletedRequestId = 0
let cachedStoredRevision = null
const invalidationListeners = new Set()

function clearOperationConfigCache() {
  cacheRevision += 1
  latestCompletedRequestId = 0
  invalidateConfigReads()
}

function invalidateConfigReads(upToRequestId) {
  cachedStoredRevision = null
  invalidateCache(OPERATION_CONFIG_CACHE_KEY)
  for (const listener of Array.from(invalidationListeners)) {
    try { listener(upToRequestId) } catch (error) {
      // A consumer callback cannot prevent cancellation of the other reads.
    }
  }
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
  const revision = cacheRevision

  // 1. 优先读取有效缓存
  const cached = getCached(OPERATION_CONFIG_CACHE_KEY, OPERATION_CONFIG_CACHE_TTL_MS)
  if (cached && !force) {
    let cancelled = false
    let deliveryTimer = null
    let cancelRefresh = null
    const cancel = () => {
      cancelled = true
      if (deliveryTimer !== null) clearTimeout(deliveryTimer)
      if (cancelRefresh) cancelRefresh()
      invalidationListeners.delete(invalidate)
    }
    const invalidate = () => {
      if (cancelled) return
      cancel()
      if (typeof options.onInvalidated === "function") options.onInvalidated()
    }
    invalidationListeners.add(invalidate)
    const deliver = () => {
      invalidationListeners.delete(invalidate)
      if (cancelled || revision !== cacheRevision) return
      // Recheck at delivery: a refresh may have replaced the snapshot, or its
      // TTL may have expired while the page was waiting for the next tick.
      const current = getCached(OPERATION_CONFIG_CACHE_KEY, OPERATION_CONFIG_CACHE_TTL_MS)
      if (!current) cancelRefresh = requestOperationConfig(options)
      else if (typeof options.onSuccess === "function") options.onSuccess(current)
    }
    if (typeof wx !== "undefined" && typeof wx.nextTick === "function") {
      wx.nextTick(deliver)
    } else {
      deliveryTimer = setTimeout(deliver, 0)
    }
    return cancel
  }

  let settled = false
  let cancelled = false
  let timeoutId = null
  const requestId = ++latestRequestId

  const finish = (callback) => {
    if (settled) {
      return false
    }
    settled = true
    invalidationListeners.delete(invalidate)
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
    if (settled) return
    if (revision !== cacheRevision) {
      finish()
      return
    }
    const current = getCached(OPERATION_CONFIG_CACHE_KEY, OPERATION_CONFIG_CACHE_TTL_MS)
    if (requestId < latestCompletedRequestId && current) {
      finish(() => {
        if (typeof options.onSuccess === "function") options.onSuccess(current)
      })
      return
    }
    finish(() => {
      // A failed explicit refresh must not make old contact details or terms
      // appear valid again on the next page visit.
      if (force && requestId >= latestCompletedRequestId) invalidateConfigReads(requestId)
      if (!cancelled && typeof options.onFailure === "function") {
        options.onFailure(reason)
      }
    })
  }
  const cancel = () => {
    cancelled = true
    finish()
  }
  const invalidate = (upToRequestId) => {
    if (upToRequestId === undefined || requestId <= upToRequestId) finish(options.onInvalidated)
  }
  invalidationListeners.add(invalidate)

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
    data: { requireStoredConfig: true },
    success: (res) => {
      if (settled) return
      if (revision !== cacheRevision) {
        cancel()
        return
      }
      const result = res && res.result ? res.result : null
      if (!result || !result.ok || !result.config || typeof result.config !== "object" || Array.isArray(result.config)) {
        fail({
          code: (result && result.code) || "INVALID_RESULT",
          message: result && result.message
        })
        return
      }
      finish(() => {
        const current = getCached(OPERATION_CONFIG_CACHE_KEY, OPERATION_CONFIG_CACHE_TTL_MS)
        const storedRevision = Number.isSafeInteger(result.revision) && result.revision >= 0 ? result.revision : null
        const olderVersion = storedRevision !== null && cachedStoredRevision !== null && storedRevision < cachedStoredRevision
        const newerVersion = storedRevision !== null && cachedStoredRevision !== null && storedRevision > cachedStoredRevision
        const useCurrent = current && (olderVersion || (!newerVersion && requestId < latestCompletedRequestId))
        if (!useCurrent) {
          latestCompletedRequestId = Math.max(latestCompletedRequestId, requestId)
          cachedStoredRevision = storedRevision
          setCache(OPERATION_CONFIG_CACHE_KEY, result.config)
        }
        if (typeof options.onSuccess === "function") {
          options.onSuccess(useCurrent ? current : result.config)
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
