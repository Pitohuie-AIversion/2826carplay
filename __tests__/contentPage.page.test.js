const fs = require("fs")
const path = require("path")

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
  return page
}

describe("pages/content-page 服务指南", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("未知内容类型安全回退到常见问题并生成章节目录", () => {
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
    expect(page.data.sections).toHaveLength(4)
    expect(page.data.activeSectionKey).toBe("section-1")
    expect(page.loadContent).toHaveBeenCalledWith("faq")
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({
      title: "常见问题"
    })
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
    requestOptions.success({
      result: {
        ok: true,
        config: { faqContent: "1. 迟到问题\n迟到正文" }
      }
    })

    expect(page.data.sections[0].title).toBe("默认问题")
  })
})
