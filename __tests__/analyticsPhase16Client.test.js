const fs = require("fs")
const path = require("path")

function loadAnalyticsFresh() {
  jest.resetModules()
  return require("../shared/analytics")
}

describe("Phase 16 analytics client", () => {
  afterEach(() => {
    delete global.wx
    jest.useRealTimers()
  })

  test("可信档案事件不再被客户端静默丢弃", () => {
    global.wx = { cloud: { callFunction: jest.fn() } }
    loadAnalyticsFresh().trackEvent("trusted_profile_view", "vehicle_1")
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "analyticsTrack",
      data: { eventType: "trusted_profile_view", vehicleId: "vehicle_1" }
    }))
  })

  test("内容事件只透传匿名归因字段", () => {
    global.wx = { cloud: { callFunction: jest.fn() } }
    loadAnalyticsFresh().trackEvent("content_view", "vehicle_1", {
      contentId: "guide_1",
      channel: "wechat_share",
      scene: "weekend_trip",
      note: "private"
    })
    expect(global.wx.cloud.callFunction.mock.calls[0][0].data).toEqual({
      eventType: "content_view",
      vehicleId: "vehicle_1",
      contentId: "guide_1",
      channel: "wechat_share",
      scene: "weekend_trip"
    })
  })

  test("非法内容标识在客户端被丢弃且不上报", () => {
    global.wx = { cloud: { callFunction: jest.fn() } }
    loadAnalyticsFresh().trackEvent("content_view", "vehicle_1", {
      contentId: "../private",
      channel: "unknown",
      note: "private"
    })
    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test("内容预约开始只在预约页实际打开时记录", () => {
    const files = [
      "pages/content-page/content-page.js",
      "pages/car-detail/car-detail.js",
      "pages/booking/booking.js"
    ].map((file) => fs.readFileSync(path.resolve(__dirname, "..", file), "utf8")).join("\n")
    expect(files.match(/trackEvent\("content_booking_start"/g)).toHaveLength(1)
    expect(fs.readFileSync(path.resolve(__dirname, "../pages/booking/booking.js"), "utf8"))
      .toContain('trackEvent("content_booking_start", carId, this.data.attribution)')
  })

  test("5 秒冷却内同 eventKey 重复 trackEvent 只上报 1 次", () => {
    jest.useFakeTimers().setSystemTime(new Date(1000000))
    const failCbs = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          if (typeof options.fail === "function") failCbs.push(options.fail)
        })
      }
    }
    const { trackEvent } = loadAnalyticsFresh()
    const attribution = { contentId: "guide_cd_1", channel: "wechat_share", scene: "ev_experience" }
    trackEvent("content_view", "car_cd_1", attribution)
    trackEvent("content_view", "car_cd_1", attribution)
    trackEvent("content_view", "car_cd_1", attribution)
    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(global.wx.cloud.callFunction.mock.calls[0][0].data).toEqual({
      eventType: "content_view",
      vehicleId: "car_cd_1",
      contentId: "guide_cd_1",
      channel: "wechat_share",
      scene: "ev_experience"
    })
  })

  test("不同 contentId / vehicleId / channel / scene 或超 5 秒冷却不再拦截", () => {
    jest.useFakeTimers().setSystemTime(new Date(2000000))
    global.wx = { cloud: { callFunction: jest.fn() } }
    const { trackEvent } = loadAnalyticsFresh()
    trackEvent("content_view", "car_1", { contentId: "guide_1", channel: "qr", scene: "weekend_trip" })
    trackEvent("content_view", "car_2", { contentId: "guide_1", channel: "qr", scene: "weekend_trip" })
    trackEvent("content_view", "car_1", { contentId: "guide_2", channel: "qr", scene: "weekend_trip" })
    trackEvent("content_view", "car_1", { contentId: "guide_1", channel: "moments", scene: "weekend_trip" })
    trackEvent("content_view", "car_1", { contentId: "guide_1", channel: "qr", scene: "group_travel" })
    jest.advanceTimersByTime(5100)
    trackEvent("content_view", "car_1", { contentId: "guide_1", channel: "qr", scene: "weekend_trip" })
    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(6)
  })

  test("analyticsTrack fail 回调删除冷却键，允许同 key 立刻重试", () => {
    jest.useFakeTimers().setSystemTime(new Date(3000000))
    let capturedFail = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          capturedFail = options.fail
        })
      }
    }
    const { trackEvent } = loadAnalyticsFresh()
    const attribution = { contentId: "guide_retry", channel: "direct", scene: "business_reception" }
    trackEvent("content_vehicle_click", "car_retry", attribution)
    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    if (capturedFail) capturedFail(new Error("network fail"))
    trackEvent("content_vehicle_click", "car_retry", attribution)
    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(2)
  })
})
