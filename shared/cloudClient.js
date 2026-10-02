/**
 * 极境车库 - 统一云函数通信客户端 (Standardized Cloud Client)
 *
 * 特性：
 * 1. 结构化 Promise 返回，统一响应协议与错误提取
 * 2. 页面生命周期感知 (联动 pageNativeAction，防止页面卸载后脏回调)
 * 3. 超时防护 (默认 15s 超时)
 * 4. 完全保留 wx.cloud.callFunction 底层调用语义，兼容 Jest 与模拟点击沙箱
 */

const { isPageNativeActionActive } = require("./pageNativeAction")
const { formatToastTitle } = require("./uiFeedback")

const DEFAULT_TIMEOUT_MS = 15 * 1000

/**
 * 提取易于阅读的错误提示文案
 * @param {any} error 
 * @param {string} [fallback="请求失败，请稍后重试"] 
 * @returns {string}
 */
function extractErrorMessage(error, fallback = "请求失败，请稍后重试") {
  if (!error) return fallback
  if (typeof error === "string") return error
  if (typeof error.message === "string" && error.message) return error.message
  if (typeof error.errMsg === "string" && error.errMsg) {
    const rawMsg = error.errMsg
    if (rawMsg.includes("network") || rawMsg.includes("timeout") || rawMsg.includes("fail")) {
      return "网络连接不稳定，请检查后重试"
    }
    return rawMsg
  }
  return fallback
}

/**
 * 统一调用微信云开发云函数
 *
 * @param {string} name 云函数名称
 * @param {object} [data={}] 传输数据载荷
 * @param {object} [options={}] 可选配置
 * @param {number} [options.timeoutMs=15000] 超时毫秒数 (0 表示不限)
 * @param {object} [options.pageContext=null] 小程序 Page 实例
 * @param {object} [options.action=null] pageNativeAction 动作凭证
 * @param {boolean} [options.showErrorToast=false] 失败时是否自动弹出通用 Toast
 * @param {function} [options.onSuccess=null] 兼容回调形式
 * @param {function} [options.onFail=null] 兼容回调形式
 * @param {function} [options.onComplete=null] 完成回调
 * @returns {Promise<{ ok: boolean, data: any, code?: string, message?: string, raw?: any }>}
 */
function callCloud(name, data = {}, options = {}) {
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_TIMEOUT_MS
  const { pageContext, action, showErrorToast } = options

  return new Promise((resolve) => {
    let settled = false
    let timer = null

    const isCurrentActive = () => {
      if (!pageContext) return true
      if (action) {
        return isPageNativeActionActive(pageContext, action)
      }
      return pageContext._nativeActionsUnloaded !== true
    }

    const cleanup = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      cleanup()

      if (!isCurrentActive()) {
        return
      }

      if (!result.ok && showErrorToast) {
        try {
          if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
            wx.showToast({
              title: formatToastTitle(result.message, "操作失败"),
              icon: "none"
            })
          }
        } catch (e) {}
      }

      if (result.ok) {
        if (typeof options.onSuccess === "function") {
          try { options.onSuccess(result.data, result) } catch (e) {}
        }
      } else {
        if (typeof options.onFail === "function") {
          try { options.onFail(result) } catch (e) {}
        }
      }

      if (typeof options.onComplete === "function") {
        try { options.onComplete(result) } catch (e) {}
      }

      resolve(result)
    }

    if (timeoutMs > 0) {
      timer = setTimeout(() => {
        finish({
          ok: false,
          code: "TIMEOUT",
          message: "网络请求超时，请检查网络后重试"
        })
      }, timeoutMs)
      if (timer && typeof timer.unref === "function") {
        timer.unref()
      }
    }

    if (typeof wx === "undefined" || !wx.cloud || typeof wx.cloud.callFunction !== "function") {
      finish({
        ok: false,
        code: "ENV_ERROR",
        message: "当前环境不支持微信云开发"
      })
      return
    }

    try {
      wx.cloud.callFunction({
        name,
        data,
        success: (res) => {
          const resResult = (res && res.result) !== undefined ? res.result : res
          if (resResult && typeof resResult === "object") {
            if (resResult.ok === false) {
              finish({
                ok: false,
                code: resResult.code || "BUSINESS_ERROR",
                message: extractErrorMessage(resResult, "操作失败"),
                data: resResult.data,
                raw: res
              })
              return
            }
            if (resResult.ok === true) {
              finish({
                ok: true,
                data: resResult.data !== undefined ? resResult.data : resResult,
                code: resResult.code,
                message: resResult.message,
                raw: res
              })
              return
            }
          }
          finish({
            ok: true,
            data: resResult,
            raw: res
          })
        },
        fail: (err) => {
          finish({
            ok: false,
            code: "CLOUD_ERROR",
            message: extractErrorMessage(err, "云端服务暂时不可用，请稍后重试"),
            raw: err
          })
        }
      })
    } catch (invocationError) {
      finish({
        ok: false,
        code: "INVOCATION_ERROR",
        message: extractErrorMessage(invocationError, "调用云函数异常"),
        raw: invocationError
      })
    }
  })
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  extractErrorMessage,
  callCloud
}
