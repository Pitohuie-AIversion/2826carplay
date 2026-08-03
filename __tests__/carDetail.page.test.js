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
})
