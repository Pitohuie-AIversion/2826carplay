const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/analytics-manage/analytics-manage")
  return definition
}

function createPage(definition, overrides) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...(overrides || {})
    }
  }
  page.setData = jest.fn((patch) => {
    Object.assign(page.data, patch)
  })
  return page
}

describe("pages/analytics-manage cleanup", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("管理员确认后调用限量清理并展示结果", () => {
    global.wx = {
      showModal: jest.fn(({ title, success }) => {
        if (title === "清理过期匿名数据") {
          success({ confirm: true })
        }
      }),
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              processed: 100,
              deleted: 99,
              failed: 1,
              hasMore: true
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      canCleanup: true
    })

    page.handleCleanup()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "analyticsCleanup",
      data: { limit: 100 },
      success: expect.any(Function),
      fail: expect.any(Function),
      complete: expect.any(Function)
    })
    expect(global.wx.showModal).toHaveBeenCalledWith({
      title: "清理完成",
      content: "处理 100 条，成功删除 99 条，失败 1 条。可能仍有过期数据，可再次执行清理。",
      confirmText: "知道了",
      confirmColor: "#528fff",
      showCancel: false
    })
    expect(page.data.cleanupLoading).toBe(false)
  })

  test("非管理员不会发起清理", () => {
    global.wx = {
      showModal: jest.fn(),
      cloud: {
        callFunction: jest.fn()
      }
    }
    const page = createPage(loadPageDefinition(), {
      canCleanup: false
    })

    page.handleCleanup()

    expect(global.wx.showModal).not.toHaveBeenCalled()
    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test("分析结果构建指标图标和分阶段漏斗比例", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              metrics: {
                garage_view: 100,
                vehicle_detail: 60,
                booking_start: 30,
                booking_submit: 12
              },
              conversionRate: 20,
              trend: [
                { key: "day-1", label: "07-01", value: 4 },
                { key: "day-2", label: "07-02", value: 9 }
              ],
              topVehicles: []
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchOverview()

    expect(page.data.metricItems.map((item) => item.icon)).toEqual([
      "eye",
      "calendar",
      "check",
      "chart"
    ])
    expect(page.data.funnelItems.map((item) => item.rate)).toEqual([100, 60, 30, 12])
    expect(page.data.trendItems.map((item) => item.isPeak)).toEqual([false, true])
  })

  test("首次加载使用指标、漏斗与趋势骨架", () => {
    const pageDir = path.resolve(__dirname, "../pages/analytics-manage")
    const wxml = fs.readFileSync(path.join(pageDir, "analytics-manage.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "analytics-manage.wxss"), "utf8")

    expect(wxml).toContain('class="analytics-skeleton"')
    expect(wxml).toContain("metric-skeleton-card")
    expect(wxml).toContain("analytics-skeleton-columns")
    expect(wxml).not.toContain("正在汇总匿名运营数据…")
    expect(wxss).toContain(".metric-icon-eye")
    expect(wxss).toContain(".rank-item:nth-child(1) .rank-number")
  })

  test("失败、统计上限、隐私与清理区域使用原生图标", () => {
    const pageDir = path.resolve(__dirname, "../pages/analytics-manage")
    const wxml = fs.readFileSync(path.join(pageDir, "analytics-manage.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "analytics-manage.wxss"), "utf8")

    expect(wxml).toContain("analytics-state-icon")
    expect(wxml).toContain("analytics-retry-native-icon")
    expect(wxml).toContain("analytics-warning-native-icon")
    expect(wxml).toContain("analytics-lock-native-icon")
    expect(wxml).toContain("analytics-cleanup-native-icon")
    expect(wxml).toContain("analytics-empty-native-icon")
    expect(wxml).toContain("产生浏览、收藏或预约行为后")
    expect(wxml).toContain('aria-label="清理九十天前的匿名行为数据"')
    expect(wxml).not.toContain('bindtap="handleRetry">重新加载</button>')
    expect(wxml).toContain('hover-class="period-chip-pressed"')
    expect(wxml).toContain('aria-pressed="{{days === item.value}}"')
    expect(wxml).toContain('class="ui-scroll-cue trend-scroll-cue"')
    expect(wxml).toContain("{{item.isPeak ? '，本周期峰值' : ''}}")
    expect(wxss).toContain(".analytics-action-content")
    expect(wxss).toContain(".period-chip-pressed")
    expect(wxss).toContain(".analytics-tip-native-icon")
    expect(wxss).toContain(".analytics-empty-desc")
    expect(wxss).toContain(".trend-fill-peak")
    expect(wxss).toMatch(/\.rank-name\s*\{[^}]*-webkit-line-clamp:\s*2/s)
  })
})
