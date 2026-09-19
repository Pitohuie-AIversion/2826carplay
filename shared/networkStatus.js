/**
 * 极境车库 - 全局网络状态与重连自愈管理
 * 
 * 适用于地下车库、电梯、高速等弱网及断网场景。
 * 当检测到网络从离线恢复为在线时，自动通知订阅者静默重刷页面或自愈重试。
 */

let isListening = false
let isConnected = true
let networkType = "unknown"
const reconnectListeners = new Set()

function handleNetworkStatusChange(res) {
  const previousConnected = isConnected
  isConnected = Boolean(res && res.isConnected)
  networkType = String((res && res.networkType) || "unknown")

  // 从无网恢复为有网时，触发所有重连监听
  if (!previousConnected && isConnected) {
    reconnectListeners.forEach((callback) => {
      try {
        if (typeof callback === "function") {
          callback({ isConnected, networkType })
        }
      } catch (error) {}
    })
  }
}

function initNetworkStatusListener() {
  if (isListening) return
  if (typeof wx === "undefined") return

  if (typeof wx.getNetworkType === "function") {
    try {
      wx.getNetworkType({
        success: (res) => {
          networkType = String((res && res.networkType) || "unknown")
          isConnected = networkType !== "none"
        }
      })
    } catch (e) {}
  }

  if (typeof wx.onNetworkStatusChange === "function") {
    try {
      wx.onNetworkStatusChange(handleNetworkStatusChange)
      isListening = true
    } catch (e) {}
  }
}

function onNetworkReconnect(callback) {
  if (typeof callback !== "function") return () => {}
  initNetworkStatusListener()
  reconnectListeners.add(callback)
  return () => {
    reconnectListeners.delete(callback)
  }
}

function offNetworkReconnect(callback) {
  if (typeof callback === "function") {
    reconnectListeners.delete(callback)
  }
}

function getNetworkState() {
  return {
    isConnected,
    networkType,
    listenerCount: reconnectListeners.size
  }
}

// 供测试环境重置与触发
function _resetForTesting() {
  isListening = false
  isConnected = true
  networkType = "unknown"
  reconnectListeners.clear()
}

function _simulateStatusChange(res) {
  handleNetworkStatusChange(res)
}

function notifyNetworkReconnectForTest(payload = { isConnected: true, networkType: "wifi" }) {
  reconnectListeners.forEach((callback) => {
    try {
      if (typeof callback === "function") {
        callback(payload)
      }
    } catch (error) {}
  })
}

module.exports = {
  initNetworkStatusListener,
  onNetworkReconnect,
  offNetworkReconnect,
  getNetworkState,
  _resetForTesting,
  _simulateStatusChange,
  resetNetworkStatusForTest: _resetForTesting,
  notifyNetworkReconnectForTest
}
