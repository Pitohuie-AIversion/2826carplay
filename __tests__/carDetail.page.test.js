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
  test("租赁条款只显示已保存内容，清空、缺字段与读取失败均撤销旧文案", () => {
    let request
    global.wx = { setNavigationBarTitle: jest.fn(), cloud: { callFunction: jest.fn((options) => { request = options }) } }
    const page = createPage(loadPageDefinition())
    page.applyCar({ id: "car", images: [], priceDay: 500 })
    expect(Object.values(page.data.rentalTerms).every((value) => value === "")).toBe(true)
    const saved = { includedText: "已登记的计费说明", protectionText: "已登记保障说明", depositText: "已登记押金说明", estimateDisclaimer: "已登记价格说明" }
    for (const result of [{ rentalTerms: Object.fromEntries(Object.keys(saved).map((key) => [key, ""])) }, {}, null]) {
      page.loadOperationConfig({ force: true })
      request.success({ result: { ok: true, config: { rentalTerms: saved } } })
      expect(page.data.pricingOverview.includedText).toBe(saved.includedText)
      expect(page.data.pricingOverview.feeItems).toHaveLength(1)
      expect(page.data.pricingOverview.ruleItems).toHaveLength(1)
      page.loadOperationConfig({ force: true })
      if (result) request.success({ result: { ok: true, config: result } })
      else request.fail({ errMsg: "network failed" })
      expect(Object.values(page.data.rentalTerms).every((value) => value === "")).toBe(true)
      expect(page.data.pricingOverview).toMatchObject({ includedText: "", disclaimer: "", feeItems: [], ruleItems: [], baseDailyRateText: "￥500" })
    }
    page.onUnload()
  })

  test("显式清空的性能字段不回填旧扁平字段，数值零保持可见", () => {
    global.wx = { setNavigationBarTitle: jest.fn() }
    const page = createPage(loadPageDefinition())
    page.applyCar({ id: "car", images: [], horsepower: "历史300Ps", performance: { horsepower: "", acceleration: 0, torque: 0 } })
    expect(page.data.car.performance).toMatchObject({ horsepower: "—", acceleration: "0", torque: "0" })
  })

  test("服务配置清空后移除旧电话、服务时间与导航，人工提示来自车辆数据", () => {
    let config = { servicePhone: "18800001111", serviceHoursText: "周一至周五 10:00–18:00", serviceHubs: [
      { id: "store", city: "杭州", type: "store", name: "湖畔门店", address: "已登记地址", latitude: 30.2, longitude: 120.1 }
    ] }
    global.wx = { setNavigationBarTitle: jest.fn(), openLocation: jest.fn(), showToast: jest.fn(),
      cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, config } })) } }
    const page = createPage(loadPageDefinition())
    page.applyCar({ id: "car", images: [], location: "杭州", publicDrivingTips: "停车后请检查车窗" })
    page.loadOperationConfig({ force: true })
    expect(page.data.serviceHoursText).toBe(config.serviceHoursText)
    expect(page.data.car.publicDrivingTips).toBe("停车后请检查车窗")
    expect(page.data.canNavigate).toBe(true)
    config = { servicePhone: "", serviceHoursText: "", serviceHubs: [] }
    page.loadOperationConfig({ force: true })
    expect(page.data.servicePhone).toBe("")
    expect(page.data.serviceHoursText).toBe("")
    expect(page.data.canNavigate).toBe(false)
    page.handleOpenLocation()
    expect(wx.openLocation).not.toHaveBeenCalled()
    page.onUnload()
  })

  test("导航失败回调在详情页卸载后不会提示", () => {
    global.wx = { setNavigationBarTitle: jest.fn(), openLocation: jest.fn(), showToast: jest.fn() }
    const page = createPage(loadPageDefinition())
    page.data.serviceHubs = [{ id: "store", city: "杭州", type: "store", name: "门店", address: "地址", latitude: 0, longitude: 0 }]
    page.applyCar({ id: "car", images: [], location: "门店" })
    page.handleOpenLocation()
    const options = wx.openLocation.mock.calls[0][0]
    expect(options.latitude).toBe(0)
    page.onUnload()
    options.fail({ errMsg: "fail" })
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("详情只显示管理员配置的连租规则，清空后移除折扣展示", () => {
    global.wx = { setNavigationBarTitle: jest.fn() }
    const page = createPage(loadPageDefinition())
    page.applyCar({ id: "car_1", images: [], rentalDiscountTiers: [{ minDays: 5, discountRate: 0.92 }] })
    expect(page.data.pricingOverview.discountTiers).toEqual([expect.objectContaining({ minDays: 5, discountText: "9.2折" })])
    page.applyCar({ id: "car_1", images: [], rentalDiscountTiers: [] })
    expect(page.data.pricingOverview.discountTiers).toEqual([])
  })

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
    page.data.rentalTerms = { estimateDisclaimer: "本报价仅供参考，不会自动锁定车辆" }
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

    expect(page.data.servicePhone).toBe("")
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

  test("支持车型海报、已保存网点导航与已保存微信客服", () => {
    global.wx = {
      setNavigationBarTitle: jest.fn(),
      openLocation: jest.fn(),
      setClipboardData: jest.fn(),
      showModal: jest.fn(),
      showToast: jest.fn(),
      openCustomerServiceChat: jest.fn(),
      cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, config: {
        wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/test-link"
      } } })) }
    }
    const page = createPage(loadPageDefinition())
    page.data.car = {
      id: "car_911",
      name: "保时捷 911",
      location: "杭州市西湖区西溪路极境车库"
    }
    page.data.carId = "car_911"
    page.data.serviceHubs = [{
      id: "hz-store", city: "杭州", type: "store", name: "已保存门店",
      address: "杭州市西湖区西溪路极境车库", latitude: 30.2741, longitude: 120.1551
    }]

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
    expect(global.wx.openCustomerServiceChat).toHaveBeenCalledWith(expect.objectContaining({
      corpId: "ww123456", extInfo: { url: "https://work.weixin.qq.com/kfid/test-link" }
    }))
    expect(global.wx.setClipboardData).not.toHaveBeenCalled()

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

  test("保存海报支持授权失败友好提示与成功提示", () => {
    let saveCallback = null
    global.wx = {
      saveImageToPhotosAlbum: jest.fn((options) => {
        saveCallback = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.setData({ posterImagePath: "wxfile://tmp/poster.png", posterModalVisible: true })

    page.handleSavePoster()
    expect(global.wx.saveImageToPhotosAlbum).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "wxfile://tmp/poster.png"
      })
    )

    // 1. 模拟相册权限拒绝时给出明确开启提示
    saveCallback.fail({ errMsg: "saveImageToPhotosAlbum:fail auth deny" })
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "请开启相册权限",
      icon: "none"
    })

    // 2. 模拟保存成功时提示并关闭弹窗
    saveCallback.success()
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "海报已保存相册",
      icon: "success"
    })
    expect(page.data.posterModalVisible).toBe(false)
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

  test("详情页展示驾控性能与亮点卡片，优先使用管理员人工录入，未录入则显示中性占位（零脑补模式）", () => {
    global.wx = { setNavigationBarTitle: jest.fn() }
    const page = createPage(loadPageDefinition())
    const neutralHighlights = ["具体配置以车辆实车为准", "建议到店体验后确认功能"]

    // 保时捷 911：未录入 performance → 零脑补，显示占位（不再自动套预设）
    page.applyCar({
      id: "vehicle-porsche-911",
      name: "保时捷 911 Carrera S",
      brand: "保时捷",
      category: "supercar",
      status: "available",
      images: []
    })

    expect(page.data.car.performance).toBeDefined()
    expect(page.data.car.performance.acceleration).toBe("—")
    expect(page.data.car.performance.horsepower).toBe("—")
    expect(page.data.car.performance.drivetrain).toBe("—")
    expect(page.data.car.performance.torque).toBe("—")
    expect(page.data.car.performance.highlights).toEqual(neutralHighlights)

    // 法拉利 F8：未录入 performance → 零脑补，显示占位
    page.applyCar({
      id: "vehicle-ferrari-f8",
      name: "法拉利 F8 Tributo",
      brand: "法拉利",
      category: "supercar",
      status: "available",
      images: []
    })
    expect(page.data.car.performance.acceleration).toBe("—")
    expect(page.data.car.performance.horsepower).toBe("—")
    expect(page.data.car.performance.drivetrain).toBe("—")

    // 管理员显式录入 performance → 100% 按录入值透传（覆盖正确）
    page.applyCar({
      id: "vehicle-custom",
      name: "极境定制版",
      brand: "极境",
      status: "available",
      images: [],
      performance: {
        acceleration: "2.5s",
        horsepower: "1000Ps",
        drivetrain: "三电机四驱",
        torque: "1200N·m",
        highlights: ["碳陶刹车", "全碳车身"]
      }
    })
    expect(page.data.car.performance.acceleration).toBe("2.5s")
    expect(page.data.car.performance.horsepower).toBe("1000Ps")
    expect(page.data.car.performance.drivetrain).toBe("三电机四驱")
    expect(page.data.car.performance.torque).toBe("1200N·m")
    expect(page.data.car.performance.highlights).toEqual(["碳陶刹车", "全碳车身"])

    const pageDir = path.resolve(__dirname, "../pages/car-detail")
    const wxml = fs.readFileSync(path.join(pageDir, "car-detail.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "car-detail.wxss"), "utf8")
    expect(wxml).toContain("performance-card")
    expect(wxml).toContain("PERFORMANCE & HIGHLIGHTS")
    expect(wxml).toContain("car.performance.acceleration")
    expect(wxml).toContain("car.performance.horsepower")
    expect(wxml).toContain("car.performance.highlights")
    expect(wxss).toContain(".performance-card")
    expect(wxss).toContain(".perf-metrics-grid")
    expect(wxss).toContain(".perf-tag-dot")
  })

  test("loadCarDetail 支持从 storage 缓存秒开 (SWR 策略)", () => {
    const cachedCar = {
      id: "car-swr-1",
      name: "保时捷 911 GT3",
      brand: "保时捷",
      priceDay: 4500,
      status: "available",
      images: ["cloud://car-1.jpg"]
    }
    global.wx = {
      getStorageSync: jest.fn((key) => {
        if (key === "car_detail_car-swr-1") {
          return cachedCar
        }
        return null
      }),
      cloud: {
        callFunction: jest.fn()
      },
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.loadCarDetail("car-swr-1")
    expect(page.data.car).not.toBeNull()
    expect(page.data.car.name).toBe("保时捷 911 GT3")
    page.onUnload()
  })

  test("handleRetryHeroImage 允许重试失败的主图并恢复加载状态", () => {
    const page = createPage(loadPageDefinition())
    page.data.car = {
      id: "car-1",
      imageItems: [
        { src: "cloud://img1.jpg", displaySrc: "", failed: true, loaded: false }
      ]
    }
    global.wx = {
      vibrateShort: jest.fn()
    }
    page.handleRetryHeroImage({
      currentTarget: {
        dataset: { index: 0 }
      }
    })
    expect(page.data["car.imageItems[0].failed"]).toBe(false)
    expect(page.data["car.imageItems[0].loaded"]).toBe(false)

    const pageDir = path.resolve(__dirname, "../pages/car-detail")
    const wxml = fs.readFileSync(path.join(pageDir, "car-detail.wxml"), "utf8")
    expect(wxml).toContain("handleRetryHeroImage")
    expect(wxml).toContain("点击重试")
  })
})

