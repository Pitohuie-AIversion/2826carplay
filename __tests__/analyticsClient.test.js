function loadAnalytics() {
  jest.resetModules()
  return require("../shared/analytics")
}

describe("shared/analytics", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.wx
  })

  test("短时间内相同事件只上报一次，不同车辆仍可分别上报", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-07-29T08:00:00.000Z"))
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      }
    }
    const { trackEvent } = loadAnalytics()

    trackEvent("vehicle_detail", "vehicle_1")
    trackEvent("vehicle_detail", "vehicle_1")
    trackEvent("vehicle_detail", "vehicle_2")

    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(2)
  })

  test("上报失败后允许立即重试", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ fail }) => fail())
      }
    }
    const { trackEvent } = loadAnalytics()

    trackEvent("booking_submit", "vehicle_1")
    trackEvent("booking_submit", "vehicle_1")

    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(2)
  })

  test("统计接口同步异常不会打断页面且允许重试", () => {
    global.wx = {
      cloud: {
        callFunction: jest
          .fn()
          .mockImplementationOnce(() => {
            throw new Error("cloud unavailable")
          })
          .mockImplementationOnce(() => {})
      }
    }
    const { trackEvent } = loadAnalytics()

    expect(() => trackEvent("booking_start", "vehicle_1")).not.toThrow()
    trackEvent("booking_start", "vehicle_1")

    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(2)
  })

  test("超过冷却时间后可再次记录", () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-07-29T08:00:00.000Z"))
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      }
    }
    const { trackEvent } = loadAnalytics()

    trackEvent("garage_view")
    jest.advanceTimersByTime(5000)
    trackEvent("garage_view")

    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(2)
  })
})
