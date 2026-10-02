const APPLY_STATE_FLUSH_MS = 16

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
  if (!target || typeof target !== "object" || !isPlainObject(patch)) {
    return
  }
  const keys = Object.keys(patch)
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    const parts = statePath(key)
    if (!parts.length || patch[key] === undefined) continue
    let current = target
    for (let j = 0; j < parts.length - 1; j++) {
      const part = parts[j]
      if (!current[part] || typeof current[part] !== "object") {
        current[part] = /^\d+$/.test(parts[j + 1]) ? [] : {}
      }
      current = current[part]
    }
    current[parts[parts.length - 1]] = patch[key]
  }
}

function statePath(key) {
  const parts = String(key).replace(/\[(\d+)\]/g, ".$1").split(".")
  return parts.some((part) => !part || ["__proto__", "prototype", "constructor"].includes(part)) ? [] : parts
}

function isAncestorPath(parent, child) {
  return parent.length <= child.length && parent.every((part, index) => part === child[index])
}

function createPerformanceHelpers(context) {
  let pendingPatch = null
  let flushTimer = null
  let destroyed = false
  let flushScheduled = false
  let flushSerial = 0
  const debounceHandles = []

  const cancelScheduledFlush = () => {
    flushScheduled = false
    flushSerial += 1
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
    const patch = {}
    Object.keys(pendingPatch).forEach((key) => {
      // Read the latest logical state so a direct setData between batching and
      // rendering cannot be overwritten by an older queued value.
      const value = context && context.data
        ? statePath(key).reduce((current, part) => current == null ? undefined : current[part], context.data)
        : pendingPatch[key]
      if (value !== undefined) patch[key] = value
    })
    pendingPatch = null
    cancelScheduledFlush()
    if (!context || typeof context.setData !== "function" || !Object.keys(patch).length) {
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
    if (typeof wx !== "object" || !wx || typeof wx.nextTick !== "function") {
      flushPending()
      return
    }
    if (flushScheduled) {
      return
    }
    flushScheduled = true
    const serial = ++flushSerial
    const flushIfCurrent = () => {
      if (serial === flushSerial && !destroyed) flushPending()
    }
    try {
      wx.nextTick(flushIfCurrent)
    } catch (e) {
      // Fall through to setTimeout
    }
    if (flushScheduled && flushTimer === null) {
      flushTimer = setTimeout(flushIfCurrent, APPLY_STATE_FLUSH_MS)
      if (flushTimer && typeof flushTimer.unref === "function") {
        flushTimer.unref()
      }
    }
  }

  const applyState = (patch) => {
    if (destroyed || !isPlainObject(patch)) {
      return
    }
    if (context && typeof context.data === "object" && context.data !== null) {
      applyPatchToTarget(context.data, patch)
    }
    if (pendingPatch === null) pendingPatch = {}
    Object.keys(patch).forEach((key) => {
      const parts = statePath(key)
      if (!parts.length || patch[key] === undefined) return
      const pendingKeys = Object.keys(pendingPatch)
      if (pendingKeys.some((existing) => isAncestorPath(statePath(existing), parts))) return
      pendingKeys.forEach((existing) => {
        if (isAncestorPath(parts, statePath(existing))) delete pendingPatch[existing]
      })
      pendingPatch[key] = patch[key]
    })
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
      if (destroyed) return lastResult
      const self = this
      const args = new Array(arguments.length)
      for (let i = 0; i < args.length; i++) args[i] = arguments[i]
      const shouldCallNow = immediate && timer === null
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
      if (immediate) {
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
