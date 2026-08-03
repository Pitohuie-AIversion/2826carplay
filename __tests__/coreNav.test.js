const fs = require("fs")
const path = require("path")

function loadComponentDefinition() {
  jest.resetModules()
  let definition = null
  global.Component = jest.fn((input) => {
    definition = input
  })
  require("../components/core-nav/core-nav")
  return definition
}

function createComponent(definition, activeKey) {
  return {
    ...definition.methods,
    data: {
      activeKey
    }
  }
}

describe("components/core-nav 核心导航", () => {
  afterEach(() => {
    delete global.Component
    delete global.wx
  })

  test.each([
    ["favorites", "/pages/favorites/favorites"],
    ["bookings", "/pages/bookings/bookings"],
    ["mine", "/pages/mine/mine"]
  ])("可从车库切换到 %s", (key, url) => {
    global.wx = {
      redirectTo: jest.fn(),
      reLaunch: jest.fn()
    }
    const component = createComponent(loadComponentDefinition(), "garage")

    component.handleNavigate({
      currentTarget: {
        dataset: {
          key
        }
      }
    })

    expect(wx.redirectTo).toHaveBeenCalledWith(
      expect.objectContaining({
        url
      })
    )
  })

  test("点击当前页面不会重复跳转", () => {
    global.wx = {
      redirectTo: jest.fn(),
      reLaunch: jest.fn()
    }
    const component = createComponent(loadComponentDefinition(), "bookings")

    component.handleNavigate({
      currentTarget: {
        dataset: {
          key: "bookings"
        }
      }
    })

    expect(wx.redirectTo).not.toHaveBeenCalled()
  })

  test("使用统一的原生图标并提供无障碍名称", () => {
    const wxml = fs.readFileSync(
      path.resolve(__dirname, "../components/core-nav/core-nav.wxml"),
      "utf8"
    )
    const wxss = fs.readFileSync(
      path.resolve(__dirname, "../components/core-nav/core-nav.wxss"),
      "utf8"
    )

    expect(wxml).toContain("core-nav-icon-heart")
    expect(wxml).toContain("core-nav-icon-calendar")
    expect(wxml).toContain("core-nav-icon-profile")
    expect(wxml).toContain('aria-role="tablist"')
    expect((wxml.match(/aria-role="tab"/g) || []).length).toBe(4)
    expect(wxml).toContain('aria-selected="{{activeKey === \'garage\'}}"')
    expect(wxml).toContain('aria-selected="{{activeKey === \'mine\'}}"')
    expect(wxml).toContain('class="core-nav-emblem" src="/assets/icons/jijing-garage-emblem.png" mode="aspectFill" aria-hidden="true"')
    expect(wxml).toContain('aria-label="打开收藏"')
    expect(wxml).not.toContain(">♡<")
    expect(wxml).not.toContain(">◫<")
    expect(wxml).not.toContain(">◎<")
    expect(wxss).toContain("env(safe-area-inset-bottom)")
    expect(wxss).toContain("env(safe-area-inset-left)")
    expect(wxss).toContain("env(safe-area-inset-right)")
    expect(wxss).toContain(".core-nav-item-active .core-nav-label")
  })

  test("四个核心页面为全面屏底部导航预留动态安全区", () => {
    ;["garage", "favorites", "bookings", "mine"].forEach((pageName) => {
      const wxss = fs.readFileSync(
        path.resolve(__dirname, `../pages/${pageName}/${pageName}.wxss`),
        "utf8"
      )

      expect(wxss).toMatch(/padding:\s*[^;]*env\(safe-area-inset-bottom\)/)
    })
  })
})
