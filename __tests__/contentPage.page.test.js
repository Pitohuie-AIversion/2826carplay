const fs = require("fs")
const path = require("path")
const activePages = new Set()

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/content-page/content-page")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      contentTabs: definition.data.contentTabs.map((item) => ({ ...item }))
    }
  }
  page.setData = jest.fn((patch, done) => {
    Object.assign(page.data, patch)
    if (typeof done === "function") {
      done()
    }
  })
  activePages.add(page)
  return page
}

describe("pages/content-page 服务指南", () => {
  afterEach(() => {
    for (const page of activePages) page.onUnload()
    activePages.clear()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test("未知内容类型安全回退到常见问题，加载前不显示写死的业务规则", () => {
    global.wx = {
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.loadContent = jest.fn()

    page.onLoad({
      type: "unknown"
    })

    expect(page.data.type).toBe("faq")
    expect(page.data.pageTitle).toBe("常见问题")
    expect(page.data.content).toBe("")
    expect(page.data.sections).toEqual([])
    expect(page.data.activeSectionKey).toBe("")
    expect(page.loadContent).toHaveBeenCalledWith("faq")
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({
      title: "常见问题"
    })
  })

  test.each(["faq", "rules"])("%s 读取失败明确提示，重试后空配置清除旧内容", (type) => {
    const requests = []
    global.wx = { setNavigationBarTitle: jest.fn(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    const page = createPage(loadPageDefinition())
    page.onLoad({ type })
    expect(page.data.content).toBe("")
    expect(page.data.contentLoading).toBe(true)
    requests[0].fail({ errMsg: "network unavailable" })
    expect(page.data.content).toBe("")
    expect(page.data.contentLoading).toBe(false)
    expect(page.data.contentError).toContain("重试")
    page.handleContentRetry()
    requests[1].success({ result: { ok: true, config: { [`${type}Content`]: "1. 已保存规则\n正文" } } })
    expect(page.data.sections[0].title).toBe("已保存规则")
    expect(page.data.contentError).toBe("")
    page.handleContentRetry()
    expect(requests).toHaveLength(3)
    requests[2].success({ result: { ok: true, config: { [`${type}Content`]: "" } } })
    expect(page.data.content).toBe("")
    expect(page.data.sections).toEqual([])
    expect(page.data.activeSectionKey).toBe("")
    expect(page.data.contentLoading).toBe(false)
  })

  test("重新显示内容页时重读已失效配置，成功空内容不恢复旧规则", () => {
    const requests = []
    global.wx = { setNavigationBarTitle: jest.fn(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    const page = createPage(loadPageDefinition())
    page.onLoad({ type: "rules" })
    page.onShow()
    requests[0].success({ result: { ok: true, config: { rulesContent: "1. 原规则\n原正文" } } })
    require("../shared/operationConfigRequest").clearOperationConfigCache()
    page.onShow()
    expect(requests).toHaveLength(2)
    requests[1].success({ result: { ok: true, config: {} } })
    expect(page.data.content).toBe("")
    expect(page.data.sections).toEqual([])
  })

  test("内容读取途中缓存失效立即恢复重试，迟到内容不能再显示", () => {
    const requests = []
    global.wx = { setNavigationBarTitle: jest.fn(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    const page = createPage(loadPageDefinition())
    page.onLoad({ type: "rules" })
    require("../shared/operationConfigRequest").clearOperationConfigCache()
    expect(page.data.contentLoading).toBe(false)
    expect(page.data.contentError).toContain("重试")
    requests[0].success({ result: { ok: true, config: { rulesContent: "迟到旧规则" } } })
    expect(page.data.content).toBe("")
    page.handleContentRetry()
    requests[1].success({ result: { ok: true, config: { rulesContent: "已保存新规则" } } })
    expect(page.data.content).toBe("已保存新规则")
  })

  test("刷新规则失败后再次显示页面不会恢复已过时的缓存正文", () => {
    const requests = []
    global.wx = { nextTick: (callback) => callback(), setNavigationBarTitle: jest.fn(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    const page = createPage(loadPageDefinition())
    page.onLoad({ type: "rules" })
    page.onShow()
    requests[0].success({ result: { ok: true, revision: 1, config: { rulesContent: "以前保存的规则" } } })
    page.handleContentRetry()
    requests[1].fail({ errMsg: "network" })
    expect(page.data.content).toBe("")
    page.onShow()
    expect(page.data.content).toBe("")
    expect(page.data.contentLoading).toBe(true)
    expect(requests).toHaveLength(3)
    requests[2].success({ result: { ok: true, revision: 2, config: { rulesContent: "最新保存规则" } } })
    expect(page.data.content).toBe("最新保存规则")
  })

  test("隐私政策在配置读取失败时仍可完整阅读", () => {
    let request
    global.wx = { setNavigationBarTitle: jest.fn(), cloud: { callFunction: jest.fn((options) => { request = options }) } }
    const page = createPage(loadPageDefinition())
    page.onLoad({ type: "privacy" })
    const original = page.data.content
    expect(original).toContain("个人信息")
    request.fail({ errMsg: "network unavailable" })
    expect(page.data.content).toBe(original)
    expect(page.data.contentError).toBe("")
    expect(page.data.contentLoading).toBe(false)
  })

  test("场景指南同样读取已保存客服电话，配置失败不改写指南正文", () => {
    const requests = []
    global.wx = { setNavigationBarTitle: jest.fn(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    const page = createPage(loadPageDefinition())
    page.onLoad({ contentId: "guide-contacts" })
    const configRequest = requests.find((request) => request.name === "operationConfigGet")
    expect(configRequest).toBeDefined()
    configRequest.success({ result: { ok: true, config: { servicePhone: "18800000000" } } })
    expect(page.data.servicePhone).toBe("18800000000")
    page.applyContent("指南原文")
    page.loadContent("", { force: true })
    requests.filter((request) => request.name === "operationConfigGet")[1].fail({ errMsg: "network" })
    expect(page.data.servicePhone).toBe("")
    expect(page.data.content).toBe("指南原文")
    expect(page.data.contentError).toBe("")
  })

  test("可切换服务指南并定位文档章节", () => {
    global.wx = {
      redirectTo: jest.fn(),
      pageScrollTo: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.applyContent("更新日期：2026年7月31日\n\n1. 第一章节\n第一段内容\n\n2. 第二章节\n第二段内容")

    page.handleContentTabTap({
      currentTarget: {
        dataset: {
          type: "privacy"
        }
      }
    })
    page.handleSectionTap({
      currentTarget: {
        dataset: {
          key: "section-2"
        }
      }
    })

    expect(wx.redirectTo).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/pages/content-page/content-page?type=privacy"
      })
    )
    expect(page.data.activeSectionKey).toBe("section-2")
    expect(wx.pageScrollTo).toHaveBeenCalledWith(
      expect.objectContaining({
        selector: "#section-2",
        duration: 280
      })
    )
  })

  test("隐私权利与客服行动使用对应原生图标", () => {
    const pageDir = path.resolve(__dirname, "../pages/content-page")
    const wxml = fs.readFileSync(path.join(pageDir, "content-page.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "content-page.wxss"), "utf8")

    expect(wxml).toContain("rights-action-native-icon")
    expect(wxml).toContain("support-chat-native-icon")
    expect(wxml).toContain("support-phone-native-icon")
    expect(wxml).toContain('aria-role="tablist" aria-label="服务指南内容类型"')
    expect(wxml).toContain('aria-role="tab"')
    expect(wxml).toContain('aria-selected="{{type === item.type}}"')
    expect(wxml).toContain('aria-label="{{item.title}}"')
    expect(wxml).toContain('aria-pressed="{{activeSectionKey === item.key}}"')
    expect(wxml).toContain('scroll-into-view="content-index-{{activeSectionKey}}"')
    expect(wxml).toContain('id="content-index-{{item.key}}"')
    expect(wxml).toContain('class="section-scroll-cue"')
    expect(wxml).toContain('hover-class="content-control-pressed"')
    expect(wxml).toContain('class="document-count-value">{{sections.length}}</text><text>节内容</text>')
    expect(wxml).toContain('class="hero-emblem" src="/assets/icons/jijing-garage-emblem.png" mode="aspectFill" aria-hidden="true"')
    expect(wxml).toContain('aria-label="提交个人信息查询、更正或删除申请"')
    expect(wxml).toContain('aria-label="联系极境车库在线客服"')
    expect(wxml).toContain('aria-label="拨打极境车库咨询电话"')
    expect(wxml).not.toContain('open-type="contact">在线客服</button>')
    expect(wxss).toContain(".content-action-content")
    expect(wxss).toContain(".rights-action-native-icon")
    expect(wxss).toContain(".content-control-pressed")
    expect(wxss).toContain(".section-scroll-cue-arrow")
    expect(wxss).toContain(".document-count-value")
    expect(wxss).toContain("calc(24rpx + env(safe-area-inset-right))")
    expect(wxss).toContain("calc(24rpx + env(safe-area-inset-left))")
    expect(wxss).toContain("calc(70rpx + env(safe-area-inset-bottom))")
  })

  test("连续读取内容配置时只采用最新类型结果", () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition())

    page.loadContent("faq")
    page.loadContent("rules")
    requests[1].success({
      result: {
        ok: true,
        config: {
          servicePhone: "18800000000",
          rulesContent: "1. 最新规则\n规则正文"
        }
      }
    })
    requests[0].success({
      result: {
        ok: true,
        config: {
          faqContent: "1. 旧问题\n旧正文"
        }
      }
    })

    expect(page.data.servicePhone).toBe("18800000000")
    expect(page.data.sections[0].title).toBe("最新规则")
  })

  test("内容页离开后忽略迟到配置", () => {
    let requestOptions = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.applyContent("1. 默认问题\n默认正文")

    page.loadContent("faq")
    page.onUnload()
    page.setData.mockClear()
    requestOptions.success({
      result: {
        ok: true,
        config: { faqContent: "1. 迟到问题\n迟到正文" }
      }
    })

    expect(page.data.content).toBe("")
    expect(page.setData).not.toHaveBeenCalled()
  })

  test("场景内容分享时固定 wechat_share 渠道并携带 contentId 与场景", () => {
    global.wx = {
      setNavigationBarTitle: jest.fn(),
      cloud: {
        callFunction: jest.fn()
      }
    }
    global.getCurrentPages = jest.fn(() => [{ route: "pages/content-page/content-page" }])
    const page = createPage(loadPageDefinition())
    page.setData({
      guideMode: true,
      guide: {
        id: "guide_8",
        slug: "weekend-mogan-mountain",
        title: "莫干山周末敞篷自驾",
        shareTitle: "莫干山周末敞篷自驾：看云海和日落",
        scenario: "weekend_trip"
      },
      attribution: { channel: "qr", scene: "", contentId: "guide_8", vehicleId: "" }
    })

    const shareCfg = page.onShareAppMessage()
    expect(shareCfg.title).toBe("莫干山周末敞篷自驾：看云海和日落")
    expect(shareCfg.path).toContain("/pages/content-page/content-page?")
    expect(shareCfg.path).toContain("channel=wechat_share")
    expect(shareCfg.path).toContain("contentId=weekend-mogan-mountain")
    expect(shareCfg.path).toContain("scene=weekend_trip")
    expect(shareCfg.path).not.toContain("vehicleId=")
  })

  test("分享落地时触发 share_open 与 content_view 两条匿名埋点带三字段", () => {
    const requests = []
    global.wx = {
      setNavigationBarTitle: jest.fn(),
      cloud: {
        callFunction: jest.fn((options) => {
          requests.push(options)
          if (options.name === "contentGuideDetail") {
            options.success({
              result: {
                ok: true,
                guide: {
                  id: "guide_share_01",
                  slug: "guide_share_01",
                  title: "试驾全流程避坑",
                  summary: "避坑摘要",
                  body: "正文",
                  scenario: "ev_experience",
                  vehicleIds: ["car_ev_1"]
                },
                vehicles: [{ id: "car_ev_1", name: "小鹏 P7" }]
              }
            })
          }
        })
      }
    }
    global.getCurrentPages = jest.fn(() => [{ route: "pages/content-page/content-page" }])
    const page = createPage(loadPageDefinition())

    page.onLoad({
      channel: "wechat_share",
      scene: "ev_experience",
      contentId: "guide_share_01"
    })

    expect(page.data.guideMode).toBe(true)
    expect(page.data.attribution).toEqual({
      channel: "wechat_share",
      scene: "ev_experience",
      contentId: "guide_share_01",
      vehicleId: ""
    })
    expect(requests[0].name).toBe("contentGuideDetail")
    const trackCalls = requests.filter((r) => r.name === "analyticsTrack").map((r) => r.data)
    expect(trackCalls).toHaveLength(2)
    expect(trackCalls).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ eventType: "share_open", contentId: "guide_share_01", channel: "wechat_share", scene: "ev_experience" }),
        expect.objectContaining({ eventType: "content_view", contentId: "guide_share_01", channel: "wechat_share", scene: "ev_experience" })
      ])
    )
  })

  test("车辆点击埋点 content_vehicle_click 并携带 attribution 跳转 car-detail", () => {
    const requests = []
    const navigations = []
    global.wx = {
      navigateTo: jest.fn((options) => navigations.push(options)),
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition())
    page.setData({
      attribution: {
        channel: "wechat_share",
        scene: "weekend_trip",
        contentId: "guide_drive_02",
        vehicleId: ""
      }
    })

    page.handleGuideVehicleTap({
      currentTarget: { dataset: { id: "car_mx5" } }
    })

    expect(requests[0].name).toBe("analyticsTrack")
    expect(requests[0].data).toMatchObject({
      eventType: "content_vehicle_click",
      vehicleId: "car_mx5",
      contentId: "guide_drive_02",
      channel: "wechat_share",
      scene: "weekend_trip"
    })
    expect(navigations).toHaveLength(1)
    const url = navigations[0].url
    expect(url).toContain("/pages/car-detail/car-detail?")
    expect(url).toContain("channel=wechat_share")
    expect(url).toContain("scene=weekend_trip")
    expect(url).toContain("contentId=guide_drive_02")
    expect(url).toContain("vehicleId=car_mx5")
  })

  test("loadGuide 命中本地 storage 快照实现 0ms 首屏直出", () => {
    const cachedGuide = {
      id: "guide-cold",
      title: "自驾全攻略",
      summary: "周末出行准备清单",
      body: "1. 证件准备\n请携带有效驾照。"
    }
    const cachedVehicles = [{ id: "car-911", name: "保时捷 911" }]
    global.wx = {
      getStorageSync: jest.fn((key) => {
        if (key === "guide_guide-cold") {
          return { guide: cachedGuide, vehicles: cachedVehicles }
        }
        return null
      }),
      cloud: { callFunction: jest.fn() },
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.loadGuide("guide-cold")
    expect(page.data.guide).toEqual(cachedGuide)
    expect(page.data.guideLoading).toBe(false)
    expect(page.data.pageTitle).toBe("自驾全攻略")
    expect(page.data.relatedVehicles).toEqual(cachedVehicles.map((vehicle) => ({ ...vehicle, statusText: "状态待确认" })))
    page.onUnload()
  })
})
