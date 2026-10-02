jest.mock("../shared/analytics", () => ({ trackEvent: jest.fn() }))

describe("saved customer service configuration", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.wx
    delete global.getCurrentPages
  })

  function setup() {
    jest.resetModules()
    return require("../shared/customerService")
  }

  test("passes the saved URL as extInfo.url without rewriting it as attribution", () => {
    const { openWxKfChat, hasWxKfConfig } = setup()
    const config = { wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/sample?enc_scene=a%2Bb" }
    global.wx = { openCustomerServiceChat: jest.fn(), showToast: jest.fn() }
    expect(openWxKfChat(config, { vehicleId: "vehicle", source: "car_detail" })).toBe(true)
    expect(wx.openCustomerServiceChat).toHaveBeenCalledWith(expect.objectContaining({
      corpId: config.wxKfCorpId, extInfo: { url: config.wxKfExtInfo }
    }))
    expect(hasWxKfConfig({ ...config, wxKfExtInfo: "" })).toBe(false)
    expect(hasWxKfConfig({ ...config, wxKfExtInfo: "base64-placeholder" })).toBe(false)
    expect(hasWxKfConfig({ ...config, wxKfCorpId: "bad" })).toBe(false)
    expect(openWxKfChat({})).toBe(false)
  })

  test.each(["callback", "throw"])("native chat %s failure falls back once using the saved phone", (failure) => {
    const { openCustomerService } = setup()
    const config = { wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/sample", servicePhone: "18800000000" }
    let nativeRequest
    global.wx = {
      cloud: { callFunction: ({ success }) => success({ result: { ok: true, config } }) },
      openCustomerServiceChat: jest.fn((options) => { nativeRequest = options; if (failure === "throw") throw new Error("unsupported") }),
      showToast: jest.fn()
    }
    const fallback = jest.fn()
    openCustomerService({ page: {}, onLegacyFallback: fallback })
    if (failure === "callback") nativeRequest.fail({ errMsg: "openCustomerServiceChat:fail invalid corpId" })
    nativeRequest.fail({ errMsg: "duplicate callback" })
    expect(fallback).toHaveBeenCalledTimes(1)
    expect(fallback).toHaveBeenCalledWith(config)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test.each(["cancel", "page_changed", "request_cancelled", "superseded"])("native failure after %s does not trigger fallback", (reason) => {
    const { openCustomerService } = setup()
    const config = { wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/sample" }
    const nativeRequests = []
    global.wx = { nextTick: (callback) => callback(),
      cloud: { callFunction: ({ success }) => success({ result: { ok: true, config } }) },
      openCustomerServiceChat: (options) => nativeRequests.push(options), showToast: jest.fn() }
    const page = {}
    global.getCurrentPages = () => [page]
    const fallback = jest.fn()
    const cancel = openCustomerService({ page, onLegacyFallback: fallback })
    if (reason === "page_changed") global.getCurrentPages = () => [{}]
    if (reason === "request_cancelled") cancel()
    if (reason === "superseded") openCustomerService({ page, onLegacyFallback: fallback })
    nativeRequests[0].fail({ errMsg: reason === "cancel" ? "openCustomerServiceChat:fail cancel" : "openCustomerServiceChat:fail" })
    expect(fallback).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("late config cannot open chat or fallback on another page", () => {
    const { openCustomerService } = setup()
    let request
    global.wx = { cloud: { callFunction: (options) => { request = options } }, openCustomerServiceChat: jest.fn() }
    const page = {}
    global.getCurrentPages = () => [page]
    const fallback = jest.fn()
    openCustomerService({ page, onLegacyFallback: fallback })
    global.getCurrentPages = () => [{}]
    request.success({ result: { ok: true, config: { wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/sample" } } })
    expect(wx.openCustomerServiceChat).not.toHaveBeenCalled()
    expect(fallback).not.toHaveBeenCalled()
  })

  test("unload cleanup cancels configuration request timers and callbacks", () => {
    jest.useFakeTimers()
    const { openCustomerService, cancelCustomerServiceRequest } = setup()
    let request
    global.wx = { cloud: { callFunction: (options) => { request = options } } }
    const page = {}
    const fallback = jest.fn()
    openCustomerService({ page, onLegacyFallback: fallback })
    cancelCustomerServiceRequest(page)
    expect(jest.getTimerCount()).toBe(0)
    request.fail(new Error("late"))
    expect(fallback).not.toHaveBeenCalled()
  })
})
