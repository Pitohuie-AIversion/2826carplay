/**
 * 微信小程序高性能页面状态辅助器 (Performance Helper)
 * 
 * 核心特性：
 * 1. 同步内存更新 (applyPatchToTarget)：杜绝立即读取状态时的时序差 (Timing Bug)
 * 2. 异步合并渲染 (wx.nextTick / 16ms)：高频变更自动批处理合并，极大降低跨线程传输损耗
 * 3. 防抖自动回收机制 (debounce & dispose)：页面卸载时一键释放挂起的定时器，防止内存泄漏
 */

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

function applyPatchToTarget(target, patch) {
  if (!isPlainObject(target) || !isPlainObject(patch)) {
    return target
  }
  const keys = Object.keys(patch)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const value = patch[key]
    if (
      Object.prototype.hasOwnProperty.call(target, key) &&
      isPlainObject(value) &&
      isPlainObject(target[key])
    ) {
      applyPatchToTarget(target[key], value)
    } else {
      target[key] = value
    }
  }
  return target
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
    context.setData(patch)
  }

  const scheduleFlush = () => {
    if (flushTimer !== null || destroyed) {
      return
    }
    if (IN_WX_ENV) {
      wx.nextTick(flushPending)
      return
    }
    flushTimer = setTimeout(flushPending, APPLY_STATE_FLUSH_MS)
    if (flushTimer && typeof flushTimer.unref === "function") {
      flushTimer.unref()
    }
  }

  const applyState = (patch) => {
    if (destroyed || !patch || typeof patch !== "object") {
      return
    }
    if (context && isPlainObject(context.data)) {
      applyPatchToTarget(context.data, patch)
    }
    pendingPatch = deepMergePatch(pendingPatch, patch)
    scheduleFlush()
  }

  const flushStateNow = () => {
    flushPending()
  }

  const debounce = (fn, delayMs = 250, immediate = false) => {
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
  applyPatchToTarget,
  deepMergePatch
}
