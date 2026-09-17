const APPLY_STATE_FLUSH_MS = 16
const IN_WX_ENV = typeof wx === "object" && wx !== null && typeof wx.nextTick === "function"

function isPlainObject(value) {
  if (value === null || typeof value !== "object") {
    return false
  }
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function deepMergePatch(target, patch) {
  if (!isPlainObject(patch)) {
    return patch
  }
  const result = isPlainObject(target) ? Object.assign({}, target) : {}
  const keys = Object.keys(patch)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = patch[key]
    if (
      Object.prototype.hasOwnProperty.call(result, key) &&
      isPlainObject(value) &&
      isPlainObject(result[key])
    ) {
      result[key] = deepMergePatch(result[key], value)
    } else {
      result[key] = value
    }
  }
  return result
}

function createPerformanceHelpers(context) {
  let pendingPatch = null
  let flushTimer = null
  let destroyed = false
  const debounceHandles = []

  const cancelScheduledFlush = () => {
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }

  const flushPending = () => {
    if (destroyed || pendingPatch === null) {
      cancelScheduledFlush()
      return
    }
    const patch = pendingPatch
    pendingPatch = null
    cancelScheduledFlush()
    if (!context || typeof context.setData !== "function") {
      return
    }
    try {
      context.setData(patch)
    } catch (e) {
      // Ignore errors from stale context; callers can catch via try/catch if needed.
    }
  }

  const scheduleFlush = () => {
    if (destroyed) return
    if (!IN_WX_ENV) {
      flushPending()
      return
    }
    if (flushTimer !== null) {
      return
    }
    try {
      wx.nextTick(() => {
        if (flushTimer !== null) {
          clearTimeout(flushTimer)
          flushTimer = null
        }
        flushPending()
      })
    } catch (e) {
      // Fall through to setTimeout
    }
    if (flushTimer === null) {
      flushTimer = setTimeout(() => {
        flushTimer = null
        flushPending()
      }, APPLY_STATE_FLUSH_MS)
      if (flushTimer && typeof flushTimer.unref === "function") {
        flushTimer.unref()
      }
    }
  }

  const applyState = (patch) => {
    if (destroyed || !isPlainObject(patch)) {
      return
    }
    if (pendingPatch === null) {
      pendingPatch = Object.assign({}, patch)
    } else {
      pendingPatch = deepMergePatch(pendingPatch, patch)
    }
    scheduleFlush()
  }

  const flushStateNow = () => {
    flushPending()
  }

  const debounce = (fn, delayMs, immediate) => {
    if (typeof fn !== "function") {
      return fn
    }
    const ms = Math.max(0, Number(delayMs) || 0)
    let timer = null
    let lastResult
    const wrapped = function () {
      const self = this
      const args = new Array(arguments.length)
      for (let i = 0; i < args.length; i++) args[i] = arguments[i]
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (immediate) {
        const shouldCallNow = timer === null
        timer = setTimeout(() => {
          timer = null
        }, ms)
        if (timer && typeof timer.unref === "function") {
          timer.unref()
        }
        if (shouldCallNow) {
          lastResult = fn.apply(self, args)
        }
        return lastResult
      }
      timer = setTimeout(() => {
        timer = null
        lastResult = fn.apply(self, args)
      }, ms)
      if (timer && typeof timer.unref === "function") {
        timer.unref()
      }
      return lastResult
    }
    wrapped.cancel = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }
    debounceHandles.push(wrapped)
    return wrapped
  }

  const dispose = () => {
    if (destroyed) return
    destroyed = true
    for (let i = 0; i < debounceHandles.length; i++) {
      const h = debounceHandles[i]
      if (h && typeof h.cancel === "function") {
        try { h.cancel() } catch (e) {}
      }
    }
    debounceHandles.length = 0
    pendingPatch = null
    cancelScheduledFlush()
  }

  return {
    applyState,
    flushStateNow,
    debounce,
    dispose
  }
}

module.exports = {
  createPerformanceHelpers,
  deepMergePatch
}
