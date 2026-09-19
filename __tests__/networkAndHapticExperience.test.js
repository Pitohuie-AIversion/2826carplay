const { triggerHapticFeedback } = require("../shared/hapticFeedback")

function createMockPage(definition, extraData = {}) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...extraData,
      form: { ...(definition.data && definition.data.form), ...(extraData && extraData.form) }
    }
  }
  page.setData = jest.fn((patch, done) => {
    Object.keys(patch).forEach((key) => {
      if (key.startsWith("form.")) {
        page.data.form[key.slice(5)] = patch[key]
      } else {
        page.data[key] = patch[key]
      }
    })
    if (typeof done === "function") {
      done()
    }
  })
  page.applyState = page.setData
  return page
}

describe("网络重连与触感反馈全链路体验优化", () => {
  beforeEach(() => {
    jest.clearAllMocks()
    const { resetNetworkStatusForTest } = require("../shared/networkStatus")
    resetNetworkStatusForTest()
  })

  afterEach(() => {
    delete global.Page
    delete global.Component
    delete global.wx
    delete global.getApp
  })

  describe("1. shared/networkStatus 弱网感知与自愈底座", () => {
    test("监听网络状态并在从断网恢复时触发重连回调", () => {
      const {
        onNetworkReconnect,
        getNetworkState
      } = require("../shared/networkStatus")

      let networkChangeCallback
      global.wx = {
        getNetworkType: jest.fn(({ success }) => success({ networkType: "none", isConnected: false })),
        onNetworkStatusChange: jest.fn((cb) => {
          networkChangeCallback = cb
        }),
        offNetworkStatusChange: jest.fn()
      }

      const callback = jest.fn()
      const unsubscribe = onNetworkReconnect(callback)

      expect(getNetworkState().isConnected).toBe(false)
      expect(callback).not.toHaveBeenCalled()

      // 网络恢复为 wifi
      networkChangeCallback({ isConnected: true, networkType: "wifi" })

      expect(getNetworkState().isConnected).toBe(true)
      expect(callback).toHaveBeenCalledTimes(1)

      // 再次触发 wifi，没有状态反转，不应重复重连
      networkChangeCallback({ isConnected: true, networkType: "wifi" })
      expect(callback).toHaveBeenCalledTimes(1)

      // 取消订阅后再次恢复不再触发
      unsubscribe()
      networkChangeCallback({ isConnected: false, networkType: "none" })
      networkChangeCallback({ isConnected: true, networkType: "5g" })
      expect(callback).toHaveBeenCalledTimes(1)
    })

    test("notifyNetworkReconnectForTest 可直接测试重连广播", () => {
      const {
        onNetworkReconnect,
        notifyNetworkReconnectForTest
      } = require("../shared/networkStatus")

      const fn1 = jest.fn()
      const fn2 = jest.fn()
      const unsub1 = onNetworkReconnect(fn1)
      onNetworkReconnect(fn2)

      notifyNetworkReconnectForTest()
      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(1)

      unsub1()
      notifyNetworkReconnectForTest()
      expect(fn1).toHaveBeenCalledTimes(1)
      expect(fn2).toHaveBeenCalledTimes(2)
    })
  })

  describe("2. shared/hapticFeedback 豪车触感震动反馈", () => {
    test("支持 light, medium, heavy, selection 震动模式", () => {
      const vibrateMock = jest.fn(({ success }) => success && success())
      global.wx = {
        vibrateShort: vibrateMock
      }

      expect(triggerHapticFeedback("light")).toBe(true)
      expect(vibrateMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: "light", style: "light" }))

      expect(triggerHapticFeedback("medium")).toBe(true)
      expect(vibrateMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: "medium", style: "medium" }))

      expect(triggerHapticFeedback("heavy")).toBe(true)
      expect(vibrateMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: "heavy", style: "heavy" }))

      expect(triggerHapticFeedback("selection")).toBe(true)
      expect(vibrateMock).toHaveBeenLastCalledWith(expect.objectContaining({ type: "light", style: "light" }))
    })

    test("环境不支持或抛出异常时静默降级不报错", () => {
      global.wx = {}
      expect(triggerHapticFeedback("light")).toBe(false)

      global.wx = {
        vibrateShort: jest.fn(() => {
          throw new Error("Simulator unsupported")
        })
      }
      expect(triggerHapticFeedback("medium")).toBe(false)
    })
  })

  describe("3. 核心页面弱网重连自愈机制", () => {
    test("车库页 garage 在 loadError 状态下收到重连通知自动重试加载", () => {
      jest.isolateModules(() => {
        let definition
        global.Page = jest.fn((def) => {
          definition = def
        })
        global.getApp = () => ({ globalData: {} })
        global.wx = {
          getNetworkType: jest.fn(),
          onNetworkStatusChange: jest.fn(),
          offNetworkStatusChange: jest.fn()
        }

        require("../pages/garage/garage")
        const page = createMockPage(definition, { loadError: true })
        page.loadCars = jest.fn()

        page.onLoad({})
        expect(page.loadCars).not.toHaveBeenCalled()

        // 触发重连自愈
        const { notifyNetworkReconnectForTest } = require("../shared/networkStatus")
        notifyNetworkReconnectForTest()
        expect(page.loadCars).toHaveBeenCalledTimes(1)

        // 卸载后不应再触发
        page.onUnload()
        notifyNetworkReconnectForTest()
        expect(page.loadCars).toHaveBeenCalledTimes(1)
      })
    })

    test("车辆详情页 car-detail 在 loadError 状态下收到重连通知自动重试", () => {
      jest.isolateModules(() => {
        let definition
        global.Page = jest.fn((def) => {
          definition = def
        })
        global.getApp = () => ({ globalData: {} })
        global.wx = {
          getNetworkType: jest.fn(),
          onNetworkStatusChange: jest.fn(),
          offNetworkStatusChange: jest.fn()
        }

        require("../pages/car-detail/car-detail")
        const page = createMockPage(definition, { carId: "car_001", loadError: true })
        page.loadCarDetail = jest.fn()
        page.loadFavoriteStatus = jest.fn()
        page.loadOperationConfig = jest.fn()

        page.onLoad({ carId: "car_001" })

        // 模拟断网自愈
        const { notifyNetworkReconnectForTest } = require("../shared/networkStatus")
        notifyNetworkReconnectForTest()
        expect(page.loadCarDetail).toHaveBeenCalledWith("car_001")
        expect(page.loadFavoriteStatus).toHaveBeenCalledWith("car_001")

        page.onUnload()
        notifyNetworkReconnectForTest()
        expect(page.loadCarDetail).toHaveBeenCalledTimes(2) // 1 in onLoad + 1 in reconnect
      })
    })

    test("预约列表页 bookings 在 loadError 状态下收到重连通知自动重试", () => {
      jest.isolateModules(() => {
        let definition
        global.Page = jest.fn((def) => {
          definition = def
        })
        global.getApp = () => ({ globalData: {} })
        global.wx = {
          getNetworkType: jest.fn(),
          onNetworkStatusChange: jest.fn(),
          offNetworkStatusChange: jest.fn()
        }

        require("../pages/bookings/bookings")
        const page = createMockPage(definition, { loadError: true })
        page.loadList = jest.fn()

        page.onLoad()
        const { notifyNetworkReconnectForTest } = require("../shared/networkStatus")
        notifyNetworkReconnectForTest()
        expect(page.loadList).toHaveBeenCalledTimes(1)

        page.onUnload()
        notifyNetworkReconnectForTest()
        expect(page.loadList).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe("4. 预选城市无缝传递与租期/预估租金实时联动", () => {
    test("车辆详情页将选定城市传递到预约跳转 URL", () => {
      jest.isolateModules(() => {
        let definition
        global.Page = jest.fn((def) => {
          definition = def
        })
        global.getApp = () => ({ globalData: {} })
        const navigateToMock = jest.fn()
        global.wx = {
          navigateTo: navigateToMock,
          getNetworkType: jest.fn(),
          onNetworkStatusChange: jest.fn()
        }

        require("../pages/car-detail/car-detail")
        const page = createMockPage(definition, {
          carId: "car_999",
          car: { id: "car_999", name: "Porsche 911", location: "上海" }
        })
        page.loadOperationConfig = jest.fn()
        page.loadCarDetail = jest.fn()
        page.loadFavoriteStatus = jest.fn()

        page.onLoad({ carId: "car_999", city: "杭州" })
        page.handleBookingTap()

        expect(navigateToMock).toHaveBeenCalledTimes(1)
        const url = navigateToMock.mock.calls[0][0].url
        expect(url).toContain("vehicleId=car_999")
        expect(url).toContain("city=%E6%9D%AD%E5%B7%9E") // encodeURIComponent("杭州")
      })
    })

    test("预约页正确计算用车天数与参考预估金额，并保留原 durationText 兼容性", () => {
      jest.isolateModules(() => {
        let definition
        global.Page = jest.fn((def) => {
          definition = def
        })
        global.getApp = () => ({ globalData: {} })
        global.wx = {
          setNavigationBarTitle: jest.fn(),
          getNetworkType: jest.fn(),
          onNetworkStatusChange: jest.fn()
        }

        require("../pages/booking/booking")
        const page = createMockPage(definition)
        page.loadSavedContact = jest.fn()
        page.loadOperationConfig = jest.fn()
        page.loadBookingCar = jest.fn()

        page.onLoad({ carId: "car_001", city: "杭州" })
        expect(page._initialCity).toBe("杭州")

        // 应用车辆数据（日租 1500）
        page.data.cityOptions = ["杭州", "上海"]
        page.applyCar({
          id: "car_001",
          name: "Ferrari Roma",
          priceDay: 1500,
          location: "上海"
        })

        // 预选城市优先于车辆默认城市
        expect(page.data.form.city).toBe("杭州")
        expect(page.data.cityIndex).toBe(0)

        // 选择 3 天跨度
        page.handleDateShortcut({
          currentTarget: { dataset: { action: "three-days" } }
        })

        const summary = page.data.bookingSummary
        expect(summary.durationText).toBe("3 天跨度")
        const estimate = page.data.rentalEstimate
        expect(estimate.rentalDays).toBe(3)
        expect(estimate.estimateTotal).toBe(4500)
        expect(estimate.estimateText).toBe("预估参考 ￥4500")
      })
    })
  })

  describe("5. 核心交互触感震动反馈触发验证", () => {
    test("car-card 点击触发 light 触感反馈", () => {
      jest.isolateModules(() => {
        const vibrateMock = jest.fn()
        global.wx = { vibrateShort: vibrateMock }

        let definition
        global.Component = jest.fn((def) => {
          definition = def
        })

        require("../components/car-card/car-card")
        const component = {
          ...definition.methods,
          data: { car: { id: "car_888" } },
          triggerEvent: jest.fn()
        }

        component.handleTap()
        expect(vibrateMock).toHaveBeenCalledWith(expect.objectContaining({ style: "light" }))
        expect(component.triggerEvent).toHaveBeenCalledWith("cardtap", { carId: "car_888" })
      })
    })

    test("booking-detail 紧急救援呼叫触发 medium 触感反馈", () => {
      jest.isolateModules(() => {
        const vibrateMock = jest.fn()
        const makePhoneCallMock = jest.fn()
        global.wx = {
          vibrateShort: vibrateMock,
          makePhoneCall: makePhoneCallMock
        }

        let definition
        global.Page = jest.fn((def) => {
          definition = def
        })

        require("../pages/booking-detail/booking-detail")
        const page = createMockPage(definition, { servicePhone: "400-888-2826" })

        page.handleEmergencyCall()
        expect(vibrateMock).toHaveBeenCalledWith(expect.objectContaining({ style: "medium" }))
        expect(makePhoneCallMock).toHaveBeenCalledWith(expect.objectContaining({ phoneNumber: "400-888-2826" }))
      })
    })

    test("car-detail 顾问微信复制与海报保存触发 medium 触感反馈", () => {
      jest.isolateModules(() => {
        const vibrateMock = jest.fn()
        const setClipboardMock = jest.fn(({ success }) => success && success())
        const saveImageMock = jest.fn(({ success }) => success && success())
        global.wx = {
          vibrateShort: vibrateMock,
          setClipboardData: setClipboardMock,
          saveImageToPhotosAlbum: saveImageMock,
          showToast: jest.fn()
        }

        let definition
        global.Page = jest.fn((def) => {
          definition = def
        })

        require("../pages/car-detail/car-detail")
        const page = createMockPage(definition, { posterImagePath: "/tmp/poster.png" })
        page.handleClosePosterModal = jest.fn()

        page.handleWechatConsult()
        expect(vibrateMock).toHaveBeenCalledWith(expect.objectContaining({ style: "medium" }))

        vibrateMock.mockClear()
        page.handleSavePoster()
        expect(vibrateMock).toHaveBeenCalledWith(expect.objectContaining({ style: "medium" }))
      })
    })
  })
})
