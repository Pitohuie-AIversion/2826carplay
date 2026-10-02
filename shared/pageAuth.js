function redirectToMine(shouldContinue) {
  const canContinue =
    typeof shouldContinue === "function" ? shouldContinue : () => true
  if (!canContinue()) {
    return
  }
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() : []

  if (pages.length > 1) {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        if (!canContinue()) {
          return
        }
        wx.redirectTo({
          url: "/pages/mine/mine",
          fail: () => {
            if (canContinue()) {
              wx.reLaunch({
                url: "/pages/mine/mine"
              })
            }
          }
        })
      }
    })
    return
  }

  wx.redirectTo({
    url: "/pages/mine/mine",
    fail: () => {
      if (canContinue()) {
        wx.reLaunch({
          url: "/pages/mine/mine"
        })
      }
    }
  })
}

function resolveAllowed(result, required) {
  if (!result || !result.ok) {
    return false
  }

  if (typeof required === "function") {
    return Boolean(required(result))
  }

  if (typeof required === "string") {
    return Boolean(result[required])
  }

  return false
}

const { getCached, setCache, invalidateCache } = require("./cloudDataCache")
const { isPageCurrent } = require("./pageNativeAction")

const PERMISSION_CHECK_TIMEOUT_MS = 12 * 1000
const PAGE_PERMISSION_CACHE_KEY = "page_permissions_v1"
const PAGE_PERMISSION_CACHE_TTL_MS = 3 * 60 * 1000

let lastWxEnv = null
let permissionCacheRevision = 0
let permissionRequestSerial = 0
let lastCompletedRequestSerial = 0

function clearPagePermissionCache() {
  permissionCacheRevision += 1
  invalidateCache(PAGE_PERMISSION_CACHE_KEY)
}

function checkWxEnvReset() {
  const currentWx = typeof wx !== "undefined" ? wx : null
  if (currentWx !== lastWxEnv) {
    lastWxEnv = currentWx
    clearPagePermissionCache()
  }
}

function cancelPagePermissionCheck(page) {
  if (!page || typeof page._cancelPagePermissionCheck !== "function") {
    return
  }
  page._cancelPagePermissionCheck()
  page._cancelPagePermissionCheck = null
}

function requirePagePermission(page, options) {
  const config = options && typeof options === "object" ? options : {}
  const required = config.required
  const noPermissionMessage = config.noPermissionMessage || "无权访问该页面"
  const failMessage = config.failMessage || "权限校验失败，请稍后重试"

  if (!page || typeof page.setData !== "function") {
    return
  }

  checkWxEnvReset()

  cancelPagePermissionCheck(page)
  const cacheRevision = permissionCacheRevision
  let requestSerial = 0
  let settled = false
  let cancelled = false
  let timeoutId = null
  let redirectTimerId = null
  const cancel = () => {
    cancelled = true
    settled = true
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    if (redirectTimerId) {
      clearTimeout(redirectTimerId)
      redirectTimerId = null
    }
  }
  page._cancelPagePermissionCheck = cancel
  const scheduleRedirect = (delay) => {
    redirectTimerId = setTimeout(() => {
      redirectTimerId = null
      if (!cancelled && isPageCurrent(page)) {
        redirectToMine(() => !cancelled && isPageCurrent(page))
      }
    }, delay)
  }

  page.setData({
    pageAuthorized: false
  })

  if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
    wx.showToast({
      title: "云能力未初始化",
      icon: "none"
    })
    scheduleRedirect(500)
    return cancel
  }

  const finish = (callback) => {
    if (settled || cancelled) {
      return false
    }
    // A role change or a newer completed check supersedes this response.
    // Restart the live page's check instead of restoring an old permission snapshot.
    if (cacheRevision !== permissionCacheRevision ||
        (requestSerial > 0 && requestSerial < lastCompletedRequestSerial)) {
      requirePagePermission(page, { ...config, force: cacheRevision !== permissionCacheRevision })
      return false
    }
    settled = true
    if (timeoutId) {
      clearTimeout(timeoutId)
      timeoutId = null
    }
    callback()
    return true
  }

  const handleCheckFailure = () => {
    finish(() => {
      wx.showToast({
        title: failMessage,
        icon: "none"
      })
      scheduleRedirect(700)
    })
  }

  const cached = getCached(PAGE_PERMISSION_CACHE_KEY, PAGE_PERMISSION_CACHE_TTL_MS)
  if (cached && !config.force) {
    const allowed = resolveAllowed(cached, required)
    if (!allowed) {
      finish(() => {
        wx.showToast({
          title: noPermissionMessage,
          icon: "none"
        })
        scheduleRedirect(700)
      })
      return cancel
    }

    finish(() => {
      page.setData({
        pageAuthorized: true
      })

      if (typeof config.onAuthorized === "function") {
        config.onAuthorized(cached)
      }
    })
    return cancel
  }

  timeoutId = setTimeout(handleCheckFailure, PERMISSION_CHECK_TIMEOUT_MS)
  requestSerial = ++permissionRequestSerial

  try {
    wx.cloud.callFunction({
      name: "getMyPermissions",
      success: (res) => {
        const result = res && res.result ? res.result : null

        if (!result || !result.ok) {
          handleCheckFailure()
          return
        }

        const allowed = resolveAllowed(result, required)
        finish(() => {
          lastCompletedRequestSerial = requestSerial
          setCache(PAGE_PERMISSION_CACHE_KEY, result)
          if (!allowed) {
            wx.showToast({
              title: noPermissionMessage,
              icon: "none"
            })
            scheduleRedirect(700)
            return
          }
          page.setData({
            pageAuthorized: true
          })

          if (typeof config.onAuthorized === "function") {
            config.onAuthorized(result)
          }
        })
      },
      fail: handleCheckFailure
    })
  } catch (error) {
    handleCheckFailure()
  }

  return cancel
}

module.exports = {
  cancelPagePermissionCheck,
  requirePagePermission,
  clearPagePermissionCache
}
