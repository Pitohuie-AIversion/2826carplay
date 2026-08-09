const OPERATION_CONFIG_TIMEOUT_MS = 10 * 1000

function requestOperationConfig(input) {
  const options = input && typeof input === "object" ? input : {}
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
  requestOperationConfig
}
