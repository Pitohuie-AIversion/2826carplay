/**
 * 极境车库 - 页面架构控制器与生命周期守卫 (Page Controller & Lifecycle Guard)
 *
 * 封装并自动应用《极境车库小程序开发与行为准则》全部守卫：
 * 1. 内存同步优先 (同步更新 this.data + wx.nextTick 排期渲染)
 * 2. 页面卸载主动资源回收 (自动清理 Debounce、定时器、网络重连监听)
 * 3. 原生动作切页防穿透 (pageNativeAction 自动开启与校验)
 * 4. 声明式权限防护 (可选注入所需管理权限并自动重定向)
 */

const { createPerformanceHelpers } = require("./performance")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("./pageNativeAction")
const { onNetworkReconnect } = require("./networkStatus")
const { requirePagePermission, cancelPagePermissionCheck } = require("./pageAuth")
const { formatToastTitle } = require("./uiFeedback")

/**
 * 为页面实例创建统一架构控制器
 *
 * @param {object} pageInstance Page 上下文实例 (this)
 * @param {object} [config={}] 控制器配置项
 * @param {string|function} [config.requiredPermission] 所需管理员权限
 * @param {function} [config.onNetworkReconnect] 网络恢复在线自愈回调
 * @param {boolean} [config.autoBindPage=true] 是否自动将 applyState/flushStateNow 挂载至 page 实例
 * @returns {object} 控制器接口
 */
function createPageController(pageInstance, config = {}) {
  if (!pageInstance || typeof pageInstance !== "object") {
    throw new Error("PageController: 必须提供有效的页面实例上下文")
  }

  // 1. 激活微信系统级原生动作安全守卫
  activatePageNativeActions(pageInstance)

  // 2. 初始化性能与状态批处理调度器 (内置内存同步优先守卫)
  const perf = createPerformanceHelpers(pageInstance)
  const cleanupTasks = []

  // 3. 挂载高性能状态函数至页面
  if (config.autoBindPage !== false) {
    pageInstance._perf = perf
    pageInstance.applyState = perf.applyState
    pageInstance.flushStateNow = perf.flushStateNow
  }

  // 4. 声明式权限拦截守卫
  if (config.requiredPermission) {
    requirePagePermission(pageInstance, config.requiredPermission, () => {
      // 权限不满足由 requirePagePermission 统一重定向回 mine
    })
    cleanupTasks.push(() => cancelPagePermissionCheck(pageInstance))
  }

  // 5. 弱网恢复与自愈监听
  if (typeof config.onNetworkReconnect === "function") {
    const unsubscribe = onNetworkReconnect((res) => {
      if (pageInstance._nativeActionsUnloaded !== true) {
        config.onNetworkReconnect.call(pageInstance, res)
      }
    })
    cleanupTasks.push(unsubscribe)
  }

  let disposed = false

  /**
   * 发起原生动作 (如弹窗、拨号、选择相册)
   * @param {object} [options]
   * @returns {object} action token
   */
  const beginAction = (options) => {
    return beginPageNativeAction(pageInstance, options)
  }

  /**
   * 检查原生动作回调是否仍然安全有效
   * @param {object} action
   * @returns {boolean}
   */
  const isActionActive = (action) => {
    return isPageNativeActionActive(pageInstance, action)
  }

  /**
   * 安全弹出轻提示，受字数上限与降级保护
   * @param {string} title
   * @param {string} [fallback]
   */
  const showToast = (title, fallback = "操作失败") => {
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({
        title: formatToastTitle(title, fallback),
        icon: "none"
      })
    }
  }

  /**
   * 释放所有页面绑定的资源 (必须在 onUnload 中调用)
   */
  const dispose = () => {
    if (disposed) return
    disposed = true

    // 取消原生交互状态
    cancelPageNativeActions(pageInstance)

    // 释放所有防抖定时器与批量渲染定时器
    if (perf && typeof perf.dispose === "function") {
      perf.dispose()
    }
    pageInstance._perf = null

    // 执行注册的清理任务
    while (cleanupTasks.length > 0) {
      const task = cleanupTasks.pop()
      try {
        if (typeof task === "function") task()
      } catch (e) {}
    }
  }

  return {
    perf,
    applyState: perf.applyState,
    flushStateNow: perf.flushStateNow,
    debounce: perf.debounce,
    beginAction,
    isActionActive,
    showToast,
    dispose
  }
}

/**
 * 声明式 Page 工厂函数 (Higher-Order Page Helper)
 * 自动注入 onLoad 架构初始化与 onUnload 彻底销毁
 *
 * @param {object} pageDef 页面配置对象
 * @param {object} [controllerConfig] 控制器选项
 * @returns {object} 装饰后的页面配置
 */
function definePage(pageDef, controllerConfig = {}) {
  const originalOnLoad = pageDef.onLoad
  const originalOnUnload = pageDef.onUnload

  pageDef.onLoad = function (options) {
    this.controller = createPageController(this, {
      ...controllerConfig,
      ...pageDef.controllerOptions
    })
    if (typeof originalOnLoad === "function") {
      return originalOnLoad.call(this, options)
    }
  }

  pageDef.onUnload = function () {
    try {
      if (typeof originalOnUnload === "function") {
        originalOnUnload.call(this)
      }
    } finally {
      if (this.controller && typeof this.controller.dispose === "function") {
        this.controller.dispose()
        this.controller = null
      }
    }
  }

  return pageDef
}

module.exports = {
  createPageController,
  definePage
}
