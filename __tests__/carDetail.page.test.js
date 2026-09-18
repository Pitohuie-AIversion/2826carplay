jest.mock("../shared/analytics", () => ({
  trackEvent: jest.fn()
}))

const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/car-detail/car-detail")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data
    }
  }
  page.setData = jest.fn((patch) => {
    page.data = {
      ...page.data,
      ...patch
    }
  })
  return page
}

describe("pages/car-detail 客户侧车辆状态", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("详情页状态和主要操作与首页客户口径一致", () => {
    global.wx = {
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.applyCar({
      id: "vehicle-1",
      name: "BMW 740Li",
      status: "available",
      images: []
    })
    expect(page.data.car).toMatchObject({
      statusText: "可预约",
      primaryActionText: "立即预约",
      actionHintText: "提交意向后，由顾问确认档期、价格与服务规则"
    })

    page.applyCar({
      id: "vehicle-2",
      name: "BMW X7",
      status: "rented",
      images: []
    })
    expect(page.data.car).toMatchObject({
      statusText: "使用中",
      primaryActionText: "咨询档期",
      actionHintText: "可先咨询后续档期，由顾问联系确认时间"
    })
  })

  test("费用与租赁规则按需展开且每次访问只记录一次匿名查看", () => {
    global.wx = {
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    const { trackEvent } = require("../shared/analytics")
    trackEvent.mockClear()
    page.data.carId = "vehicle-pricing"
    page.applyCar({
      id: "vehicle-pricing",
      name: "Porsche 911",
      status: "available",
      priceDay: 1888,
      priceSummary: {
        hasBasePrice: true,
        baseDailyRate: 1888,
        baseDailyRateText: "￥1888",
        billingUnit: "24小时"
      },
      images: []
    })

    expect(page.data.pricingOverview.baseDailyRateText).toBe("￥1888")
    expect(page.data.pricingOverview.disclaimer).toContain("不会自动锁定车辆")

    page.handleTogglePricing()
    page.handleTogglePricing()
    page.handleTogglePricing()
    page.handleToggleRentalRules()
    page.handleToggleRentalRules()
    page.handleToggleRentalRules()

    expect(trackEvent).toHaveBeenCalledWith("pricing_view", "vehicle-pricing")
    expect(trackEvent).toHaveBeenCalledWith("rental_rules_view", "vehicle-pricing")
    expect(trackEvent.mock.calls.filter(([type]) => type === "pricing_view")).toHaveLength(1)
    expect(trackEvent.mock.calls.filter(([type]) => type === "rental_rules_view")).toHaveLength(1)
  })

  test("详情页公开展示费用边界而不伪造正式报价或支付", () => {
    const pageDir = path.resolve(__dirname, "../pages/car-detail")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "car-detail.wxml"), "utf8")

    expect(wxmlSource).toContain("费用怎么计算")
    expect(wxmlSource).toContain("基础日租参考")
    expect(wxmlSource).toContain("查看完整租赁规则")
    expect(wxmlSource).toContain("pricingOverview.disclaimer")
    expect(wxmlSource).not.toContain("立即支付")
    expect(wxmlSource).not.toContain("报价已生效")
  })

  test("可信档案按需展开并只记录一次匿名查看", () => {
    global.wx = { setNavigationBarTitle: jest.fn() }
    const page = createPage(loadPageDefinition())
    const { trackEvent } = require("../shared/analytics")
    trackEvent.mockClear()
    page.data.carId = "vehicle-trust"
    page.applyCar({
      id: "vehicle-trust",
      name: "BMW M4",
      status: "available",
      images: [],
      trustArchive: {
        status: "pending",
        statusText: "资料待复核",
        lastUpdatedDate: "2026-08-01",
        freshnessDays: 8,
        missingCount: 0,
        items: [{ key: "inspection", label: "最近检查", value: "2026-08-01" }]
      }
    })

    expect(page.data.car.trustArchive.statusClass).toBe("trust-status-pending")
    page.handleToggleTrustArchive()
    page.handleToggleTrustArchive()
    page.handleToggleTrustArchive()
    expect(trackEvent.mock.calls.filter(([type]) => type === "trusted_profile_view")).toEqual([
      ["trusted_profile_view", "vehicle-trust"]
    ])
  })

  test("点击车辆图片可从当前位置打开全屏预览", () => {
    global.wx = {
      setNavigationBarTitle: jest.fn(),
      previewImage: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.applyCar({
      id: "vehicle-gallery",
      name: "Porsche 911",
      status: "available",
      images: ["cloud://cover-1", "cloud://cover-2"]
    })

    page.handleHeroImageTap({
      currentTarget: {
        dataset: {
          index: 1
        }
      }
    })

    expect(wx.previewImage).toHaveBeenCalledWith(
      expect.objectContaining({
        current: "cloud://cover-2",
        urls: ["cloud://cover-1", "cloud://cover-2"]
      })
    )
  })

  test("ignores a preview failure after the vehicle detail page unloads", () => {
    let previewOptions
    global.wx = {
      setNavigationBarTitle: jest.fn(),
      previewImage: jest.fn((options) => {
        previewOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.applyCar({
      id: "vehicle-preview-unload",
      name: "Porsche 911",
      status: "available",
      images: ["cloud://cover-1"]
    })

    page.handleHeroImageTap({ currentTarget: { dataset: { index: 0 } } })
    page.onUnload()
    previewOptions.fail(new Error("preview failed"))

    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("轮播图片索引只接受图库范围内的值", () => {
    global.wx = {
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.applyCar({
      id: "vehicle-gallery-index",
      name: "Porsche 911",
      status: "available",
      images: ["cloud://cover-1", "cloud://cover-2"]
    })

    page.handleHeroSwiperChange({ detail: { current: 1 } })
    expect(page.data.currentImageIndex).toBe(1)

    page.handleHeroSwiperChange({ detail: { current: 4 } })
    expect(page.data.currentImageIndex).toBe(0)
  })

  test("详情页电话咨询使用后台运营配置中的最新号码", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ name, success }) => {
          expect(name).toBe("operationConfigGet")
          success({
            result: {
              ok: true,
              config: {
                servicePhone: " 18800001111 "
              }
            }
          })
        })
      },
      makePhoneCall: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.loadOperationConfig()
    page.handlePhoneCall()

    expect(page.data.servicePhone).toBe("18800001111")
    expect(wx.makePhoneCall).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumber: "18800001111"
    }))
  })

  test("运营配置不可用时保留默认客服电话", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: false
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.loadOperationConfig()

    expect(page.data.servicePhone).toBe("15715710090")
  })

  test("车辆详情无响应时退出骨架屏并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      },
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.loadCarDetail("vehicle-timeout")
    expect(page.data.loading).toBe(true)

    jest.advanceTimersByTime(15 * 1000)
    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe(true)
    expect(page.data.loadErrorText).toBe("车辆详情加载超时，请检查网络后重试")

    lateSuccess({
      result: {
        ok: true,
        car: { id: "vehicle-timeout", name: "迟到车辆", status: "available", images: [] }
      }
    })
    expect(page.data.loadError).toBe(true)
    expect(page.data.car).toBeNull()
  })

  test("切换详情请求后忽略旧车辆的迟到结果", () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requests.push(options)
        })
      },
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.loadCarDetail("vehicle-old")
    page.loadCarDetail("vehicle-new")
    requests[1].success({
      result: {
        ok: true,
        car: { id: "vehicle-new", name: "新车辆", status: "available", images: [] }
      }
    })
    requests[0].success({
      result: {
        ok: true,
        car: { id: "vehicle-old", name: "旧车辆", status: "available", images: [] }
      }
    })

    expect(page.data.car.id).toBe("vehicle-new")
    expect(page.data.car.name).toBe("新车辆")
  })

  test("车辆详情调用同步异常时安全进入重试状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud sdk crashed")
        })
      },
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    expect(() => page.loadCarDetail("vehicle-error")).not.toThrow()
    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe(true)
    expect(page.data.loadErrorText).toBe("cloud sdk crashed")
  })

  test("收藏操作无响应时恢复按钮并忽略迟到成功", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.carId = "vehicle-favorite-timeout"

    page.handleFavoriteTap()
    expect(page.data.favoriteLoading).toBe(true)

    jest.advanceTimersByTime(12 * 1000)
    expect(page.data.favoriteLoading).toBe(false)
    expect(page.data.favorited).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "收藏请求超时，请重试", icon: "none" })

    lateSuccess({ result: { ok: true, favorited: true } })
    expect(page.data.favorited).toBe(false)
  })

  test("初始收藏状态无响应时超时并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          lateSuccess = options.success
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.loadFavoriteStatus("vehicle-status-timeout")
    jest.advanceTimersByTime(10 * 1000)
    lateSuccess({ result: { ok: true, favorited: true } })

    expect(page.data.favorited).toBe(false)
    expect(page._favoriteStatusTimer).toBeNull()
  })

  test("初始收藏状态同步异常时保持默认值并清理计时器", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("favorite status unavailable")
        })
      }
    }
    const page = createPage(loadPageDefinition())

    expect(() => page.loadFavoriteStatus("vehicle-status-error")).not.toThrow()
    expect(page.data.favorited).toBe(false)
    expect(page._favoriteStatusTimer).toBeNull()
  })

  test("详情页离开后初始收藏状态不再回写", () => {
    let lateSuccess = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          lateSuccess = options.success
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.loadFavoriteStatus("vehicle-status-unload")
    page.onUnload()
    lateSuccess({ result: { ok: true, favorited: true } })

    expect(page.data.favorited).toBe(false)
  })

  test("收藏调用同步异常时安全恢复可重试状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud sdk crashed")
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.carId = "vehicle-favorite-error"

    expect(() => page.handleFavoriteTap()).not.toThrow()
    expect(page.data.favoriteLoading).toBe(false)
    expect(page.data.favorited).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "收藏操作失败", icon: "none" })
  })

  test("收藏更新完成后忽略初始状态查询的迟到结果", () => {
    let statusSuccess
    let updateSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ name, success }) => {
          if (name === "favoriteStatus") {
            statusSuccess = success
          } else if (name === "favoriteSet") {
            updateSuccess = success
          }
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.carId = "vehicle-favorite-race"

    page.loadFavoriteStatus(page.data.carId)
    page.handleFavoriteTap()
    updateSuccess({ result: { ok: true, favorited: true } })
    statusSuccess({ result: { ok: true, favorited: false } })

    expect(page.data.favoriteLoading).toBe(false)
    expect(page.data.favorited).toBe(true)
  })

  test("收藏处理中隐藏心形图标并提供稳定状态文案", () => {
    const pageDir = path.resolve(__dirname, "../pages/car-detail")
    const wxml = fs.readFileSync(path.join(pageDir, "car-detail.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "car-detail.wxss"), "utf8")

    expect(wxml).toContain('wx:if="{{!favoriteLoading}}" class="favorite-button-icon"')
    expect(wxml).toContain("favoriteLoading ? '处理中…'")
    expect(wxml).toContain("favoriteLoading ? '正在更新收藏状态'")
    expect(wxml).toContain('disabled="{{favoriteLoading}}"')
    expect(wxml).toContain('hover-class="hero-image-pressed"')
    expect(wxml).toContain('aria-label="预览第 {{index + 1}} 张车辆图片，共 {{car.imageItems.length}} 张"')
    expect(wxml).toContain('circular="{{car.imageItems.length > 1}}"')
    expect(wxml).toContain('wx:if="{{car.imageItems.length > 1}}" class="hero-pagination"')
    expect(wxml).toContain("hero-image-loading-emblem")
    expect(wxml).toContain("hero-placeholder-emblem")
    expect(wxss).toContain(".hero-image-pressed")
    expect(wxss).toContain("padding-bottom: calc(210rpx + env(safe-area-inset-bottom))")
    expect(wxss).toContain("env(safe-area-inset-left)")
    expect(wxss).toContain("env(safe-area-inset-right)")
    expect(wxss).toMatch(/\.detail-bottom-bar\s*\{[^}]*right:\s*calc\(24rpx \+ env\(safe-area-inset-right\)\)/s)
    expect(wxss).toContain(".hero-image-loading-mark")
    expect(wxss).toContain(".hero-placeholder-brand-row")
    expect(wxss).toContain(".hero-pagination-segment-active")
  })

  test("支持生成车型海报、门店地图导航与微信咨询快捷复制", () => {
    global.wx = {
      setNavigationBarTitle: jest.fn(),
      openLocation: jest.fn(),
      setClipboardData: jest.fn(),
      showModal: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.car = {
      id: "car_911",
      name: "保时捷 911",
      location: "杭州市西湖区西溪路极境车库"
    }
    page.data.carId = "car_911"

    page.handleOpenPosterModal()
    expect(page.data.posterModalVisible).toBe(true)
    page.handleClosePosterModal()
    expect(page.data.posterModalVisible).toBe(false)

    page.handleOpenLocation()
    expect(global.wx.openLocation).toHaveBeenCalledWith(
      expect.objectContaining({
        latitude: 30.2741,
        longitude: 120.1551,
        address: "杭州市西湖区西溪路极境车库"
      })
    )

    page.handleWechatConsult()
    expect(global.wx.setClipboardData).toHaveBeenCalledWith(
      expect.objectContaining({
        data: "jijing_garage"
      })
    )

    const pageDir = path.resolve(__dirname, "../pages/car-detail")
    const wxml = fs.readFileSync(path.join(pageDir, "car-detail.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "car-detail.wxss"), "utf8")
    expect(wxml).toContain('bindtap="handleOpenPosterModal"')
    expect(wxml).toContain('bindtap="handleOpenLocation"')
    expect(wxml).toContain('bindtap="handleWechatConsult"')
    expect(wxml).toContain('id="posterCanvas"')
    expect(wxss).toContain(".poster-button")
    expect(wxss).toContain(".poster-modal-overlay")
  })

  test("若存在全局预填数据则首屏立即渲染车辆信息且无需骨架态", () => {
    global.getApp = jest.fn(() => ({
      globalData: {
        _tempCarDetailPreview: {
          id: "vehicle-preview-1",
          name: "保时捷 911",
          status: "available",
          priceDay: 2800,
          cover: "cloud://porsche.jpg",
          images: ["cloud://porsche.jpg"]
        }
      }
    }))
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.onLoad({ carId: "vehicle-preview-1" })

    expect(page.data.loading).toBe(false)
    expect(page.data.car).toMatchObject({
      id: "vehicle-preview-1",
      name: "保时捷 911"
    })
    page.onUnload()
  })

  test("车辆详情下拉刷新同步重载详情、收藏与场景指南并在完成时关闭刷新", () => {
    let detailSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ name, success }) => {
          if (name === "vehiclePublicDetail") {
            detailSuccess = success
          }
        })
      },
      showToast: jest.fn(),
      stopPullDownRefresh: jest.fn(),
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.carId = "vehicle-porsche-gt3"
    page.data.loading = false
    page.loadOperationConfig = jest.fn()
    page.loadFavoriteStatus = jest.fn()
    page.loadRelatedGuides = jest.fn()

    page.onPullDownRefresh()
    expect(page.loadOperationConfig).toHaveBeenCalled()
    expect(page.loadFavoriteStatus).toHaveBeenCalledWith("vehicle-porsche-gt3")
    expect(page.loadRelatedGuides).toHaveBeenCalledWith("vehicle-porsche-gt3")
    expect(global.wx.stopPullDownRefresh).not.toHaveBeenCalled()

    // 正在加载时再次下拉应直接关闭刷新
    page.data.loading = true
    page.onPullDownRefresh()
    expect(global.wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
    page.data.loading = false

    // 详情数据返回后关闭刷新
    detailSuccess({
      result: {
        ok: true,
        car: { id: "vehicle-porsche-gt3", name: "Porsche 911 GT3", status: "idle", images: [] }
      }
    })
    expect(global.wx.stopPullDownRefresh).toHaveBeenCalledTimes(2)
    expect(page.data.car.name).toBe("Porsche 911 GT3")
    page.onUnload()
  })
})


