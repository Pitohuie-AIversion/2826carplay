// Cancellable page reads: late callbacks cannot mutate an unloaded/replaced page.
function requestCloudRead(options) {
  let settled = false
  let timer = null
  const finish = (callback, value) => {
    if (settled) return
    settled = true
    if (timer !== null) clearTimeout(timer)
    timer = null
    if (typeof callback === "function") callback(value)
  }
  const cancel = () => finish()
  const fail = (error) => finish(options.onFailure, error)
  if (typeof wx === "undefined" || !wx.cloud || typeof wx.cloud.callFunction !== "function") {
    fail({ code: "CLOUD_UNAVAILABLE" })
    return cancel
  }
  timer = setTimeout(() => fail({ code: "TIMEOUT" }), options.timeoutMs || 15000)
  try {
    wx.cloud.callFunction({
      name: options.name,
      data: options.data || {},
      success: (response) => {
        const result = response && response.result
        if (!result || !result.ok) {
          fail(result || { code: "INVALID_RESULT" })
          return
        }
        finish(options.onSuccess, result)
      },
      fail
    })
  } catch (error) {
    fail(error)
  }
  return cancel
}

module.exports = { requestCloudRead }
