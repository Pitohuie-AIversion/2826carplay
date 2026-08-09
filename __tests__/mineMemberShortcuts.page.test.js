function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/mine/mine")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      memberQuickActions: definition.data.memberQuickActions.map((item) => ({ ...item })),
      menuItems: definition.data.menuItems.map((item) => ({ ...item }))
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

const fs = require("fs")
const path = require("path")

describe("pages/mine 常用服务快捷入口", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("预约、收藏和信息申请从更多服务中提炼为三个快捷入口", () => {
    const page = createPage(loadPageDefinition())

    expect(page.data.memberQuickActions.map((item) => item.key)).toEqual([
      "bookings",
      "favorites",
      "privacyRequest"
    ])
    expect(page.data.memberQuickActions.map((item) => item.icon)).toEqual([
      "calendar",
      "heart",
      "lock"
    ])
    expect(page.data.memberQuickActions.every((item) => !item.symbol)).toBe(true)
    expect(page.data.menuItems.map((item) => item.key)).not.toEqual(
      expect.arrayContaining(["bookings", "favorites", "privacyRequest"])
    )
    expect(page.data.menuItems[0]).toMatchObject({
      key: "faq",
      icon: "chat",
      showSectionHeader: true
    })
    expect(page.data.menuItems.every((item) => item.icon && !item.glyph)).toBe(true)
  })

  test("快捷入口提供可点击语义和动态辅助名称", () => {
    const wxml = fs.readFileSync(
      path.resolve(__dirname, "../pages/mine/mine.wxml"),
      "utf8"
    )

    expect(wxml).toContain('aria-role="button"')
    expect(wxml).toContain('aria-label="{{item.title}}，{{item.desc}}"')
    expect(wxml).toContain("direction-arrow-icon")
    expect(wxml).toContain('aria-label="查看运营概览，{{operationPulse.total}} 项待处理"')
    expect(wxml).not.toContain("↗")
    expect(wxml).toContain("menu-icon-{{item.icon}}")
    expect(wxml).not.toContain("{{item.glyph}}")
    expect(wxml).toContain('aria-role="group" aria-label="{{userName}}，{{roleLabel}}，{{userDesc}}"')
    expect(wxml).toContain("{{item.badgeText ? '，' + item.badgeText + ' 项待处理' : ''}}")
    expect(wxml).toContain('class="avatar-image" src="/assets/icons/jijing-garage-emblem.png" mode="aspectFill" aria-hidden="true"')
  })

  test("权限同步期间使用局部菜单骨架避免入口跳变", () => {
    const pageDir = path.resolve(__dirname, "../pages/mine")
    const wxml = fs.readFileSync(path.join(pageDir, "mine.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "mine.wxss"), "utf8")

    expect(wxml).toContain('wx:if="{{permissionsLoading}}" class="menu-skeleton"')
    expect(wxml).toContain("menu-skeleton-row")
    expect(wxml).toContain("同步权限")
    expect(wxml).toContain('class="section-count-value">{{menuItems.length}}</text><text>项服务</text>')
    expect(wxml).not.toContain("ENTRIES")
    expect(wxml).not.toContain("'SYNC'")
    expect(wxss).toContain("@keyframes mine-menu-skeleton")
    expect(wxss).toContain("@keyframes mine-permission-dot")
    expect(wxss).toContain(".section-count-value")
  })

  test("客服行动区使用服务标识与双入口原生图标", () => {
    const pageDir = path.resolve(__dirname, "../pages/mine")
    const wxml = fs.readFileSync(path.join(pageDir, "mine.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "mine.wxss"), "utf8")

    expect(wxml).toContain("concierge-native-icon")
    expect(wxml).toContain("contact-chat-native-icon")
    expect(wxml).toContain("contact-phone-native-icon")
    expect(wxml).toContain('aria-label="联系极境车库在线客服"')
    expect(wxml).toContain('aria-label="拨打极境车库咨询电话"')
    expect(wxml).not.toContain('open-type="contact" hover-class="mine-button-pressed">在线客服</button>')
    expect(wxss).toContain(".contact-action-content")
    expect(wxss).toContain(".concierge-native-head")
  })

  test.each([
    ["analyticsManage", "数据分析", "/pages/analytics-manage/analytics-manage"],
    ["auditLogManage", "审计日志", "/pages/audit-log-manage/audit-log-manage"],
    ["bookingCalendar", "预约日历", "/pages/booking-calendar/booking-calendar"],
    ["bookingManage", "预约管理", "/pages/booking-manage/booking-manage"],
    ["bookings", "我的预约", "/pages/bookings/bookings"],
    ["bookingWorkbench", "待协调工作台", "/pages/booking-workbench/booking-workbench"],
    ["configManage", "运营配置", "/pages/config-manage/config-manage"],
    ["errorLogManage", "错误日志", "/pages/error-log-manage/error-log-manage"],
    ["faq", "常见问题", "/pages/content-page/content-page?type=faq"],
    ["favorites", "我的收藏", "/pages/favorites/favorites"],
    ["operationsOverview", "运营概览", "/pages/operations-overview/operations-overview"],
    ["privacy", "隐私政策", "/pages/content-page/content-page?type=privacy"],
    ["privacyRequest", "信息申请", "/pages/privacy-request/privacy-request"],
    ["privacyRequestManage", "隐私申请处理", "/pages/privacy-request-manage/privacy-request-manage"],
    ["roleManage", "权限管理", "/pages/role-manage/role-manage"],
    ["rules", "平台规则", "/pages/content-page/content-page?type=rules"],
    ["systemHealth", "上线检查", "/pages/system-health/system-health"],
    ["vehicleCreate", "新增车辆", "/pages/vehicle-create/vehicle-create"],
    ["vehicleManage", "车辆管理", "/pages/vehicle-manage/vehicle-manage"]
  ])("%s 菜单入口可直达对应页面", (key, title, url) => {
    global.wx = {
      navigateTo: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.handleMenuTap({
      currentTarget: {
        dataset: {
          key,
          title
        }
      }
    })

    expect(wx.navigateTo).toHaveBeenCalledWith(
      expect.objectContaining({
        url
      })
    )
  })

  test("菜单页面卸载后忽略迟到的跳转失败提示", () => {
    let navigateOptions
    global.wx = {
      navigateTo: jest.fn((options) => {
        navigateOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.handleMenuTap({
      currentTarget: {
        dataset: {
          key: "favorites",
          title: "我的收藏"
        }
      }
    })
    page.onUnload()
    navigateOptions.fail(new Error("navigate failed"))

    expect(global.wx.showToast).not.toHaveBeenCalled()
  })
})
