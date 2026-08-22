function loadAnalytics() {
  jest.resetModules()
  return require("../shared/analytics")
}

describe("Phase 16 analytics client", () => {
  afterEach(() => delete global.wx)

  test("可信档案事件不再被客户端静默丢弃", () => {
    global.wx = { cloud: { callFunction: jest.fn() } }
    loadAnalytics().trackEvent("trusted_profile_view", "vehicle_1")
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "analyticsTrack",
      data: { eventType: "trusted_profile_view", vehicleId: "vehicle_1" }
    }))
  })

  test("内容事件只透传匿名归因字段", () => {
    global.wx = { cloud: { callFunction: jest.fn() } }
    loadAnalytics().trackEvent("content_view", "vehicle_1", {
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
})
