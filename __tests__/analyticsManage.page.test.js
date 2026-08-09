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
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("分析概览无回调时超时收尾并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    const done = jest.fn()
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchOverview(done)
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("数据分析加载超时，请检查网络后重试")
    expect(done).toHaveBeenCalledTimes(1)

    lateSuccess({
      result: {
        ok: true,
        metrics: { vehicle_detail: 99 },
        conversionRate: 50,
        trend: [],
        topVehicles: []
      }
    })
    expect(page.data.metricItems).toEqual([])
    expect(page.data.loadError).toBe("数据分析加载超时，请检查网络后重试")
  })

  test("新分析周期请求覆盖旧请求并固定周期参数", () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition(), { days: 7 })

    page.fetchOverview()
    page.data.days = 30
    page.fetchOverview()
    expect(requests[0].data.days).toBe(7)
    expect(requests[1].data.days).toBe(30)

    requests[1].success({
      result: {
        ok: true,
        metrics: { vehicle_detail: 30 },
        conversionRate: 20,
        trend: [],
        topVehicles: []
      }
    })
    requests[0].success({
      result: {
        ok: true,
        metrics: { vehicle_detail: 7 },
        conversionRate: 10,
        trend: [],
        topVehicles: []
      }
    })

    expect(page.data.metricItems[0].value).toBe(30)
    expect(page.data.metricItems[3].value).toBe("20%")
  })

  test("匿名数据清理无回调时超时收尾并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn(),
      showModal: jest.fn(),
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const page = createPage(loadPageDefinition(), { canCleanup: true, loading: false })

    page.runCleanup()
    jest.advanceTimersByTime(20 * 1000)

    expect(page.data.cleanupLoading).toBe(false)
    expect(global.wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "清理超时，请重试",
      icon: "none"
    })

    lateSuccess({
      result: {
        ok: true,
        processed: 1,
        deleted: 1,
        failed: 0
      }
    })
    expect(global.wx.showModal).not.toHaveBeenCalled()
  })

  test("匿名数据清理遇到云 SDK 同步异常时安全结束", () => {
    global.wx = {
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud down")
        })
      }
    }
    const page = createPage(loadPageDefinition(), { canCleanup: true, loading: false })

    expect(() => page.runCleanup()).not.toThrow()
    expect(page.data.cleanupLoading).toBe(false)
    expect(global.wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "cloud down",
      icon: "none"
    })
  })

  test("管理员确认后调用限量清理并展示结果", () => {
    global.wx = {
      showModal: jest.fn(({ title, success, complete }) => {
        if (title === "清理过期匿名数据") {
          success({ confirm: true })
          return
        }
        complete()
      }),
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(({ name, success, complete }) => {
          if (name === "analyticsCleanup") {
            success({
              result: {
                ok: true,
                processed: 100,
                deleted: 99,
                failed: 1,
                hasMore: true
              }
            })
          } else {
            success({
              result: {
                ok: true,
                metrics: {},
                conversionRate: 0,
                trend: [],
                topVehicles: []
              }
            })
          }
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      canCleanup: true,
      loading: false
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
      showCancel: false,
      complete: expect.any(Function)
    })
    expect(page.data.cleanupLoading).toBe(false)
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(
      expect.objectContaining({ name: "analyticsOverview" })
    )
  })

  test("清理结果弹窗关闭前保持写锁并在关闭后刷新概览", () => {
    const requests = []
    let resultModal = null
    global.wx = {
      showModal: jest.fn((options) => {
        resultModal = options
      }),
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn(),
      stopPullDownRefresh: jest.fn(),
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition(), {
      pageAuthorized: true,
      canCleanup: true,
      loading: false,
      days: 7
    })

    page.runCleanup()
    requests[0].success({
      result: {
        ok: true,
        processed: 2,
        deleted: 2,
        failed: 0
      }
    })

    expect(page.data.cleanupLoading).toBe(true)
    page.handlePeriodTap({ currentTarget: { dataset: { days: 30 } } })
    page.onPullDownRefresh()
    page.handleCleanup()
    expect(requests).toHaveLength(1)
    expect(global.wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
    expect(global.wx.showModal).toHaveBeenCalledTimes(1)

    resultModal.complete()
    resultModal.complete()

    expect(page.data.cleanupLoading).toBe(false)
    expect(requests).toHaveLength(2)
    expect(requests[1].name).toBe("analyticsOverview")
    requests[1].success({
      result: {
        ok: true,
        metrics: {},
        conversionRate: 0,
        trend: [],
        topVehicles: []
      }
    })
  })

  test("清理结果弹窗打开后离页会忽略迟到关闭回调", () => {
    const requests = []
    let resultModal = null
    global.wx = {
      showModal: jest.fn((options) => {
        resultModal = options
      }),
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition(), {
      canCleanup: true,
      loading: false
    })

    page.runCleanup()
    requests[0].success({
      result: {
        ok: true,
        processed: 1,
        deleted: 1,
        failed: 0
      }
    })
    page.onUnload()
    resultModal.complete()

    expect(requests).toHaveLength(1)
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
                pricing_view: 40,
                booking_start: 30,
                booking_submit: 12,
                rental_rules_view: 20,
                phone_call: 4,
                share: 3,
                availability_available: 8,
                availability_conflict: 2,
                availability_unknown: 1
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
    expect(page.data.funnelItems.map((item) => item.rate)).toEqual([100, 60, 40, 30, 12])
    expect(page.data.decisionItems).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "rules", value: 20 }),
        expect.objectContaining({ key: "availability", value: 11 })
      ])
    )
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
