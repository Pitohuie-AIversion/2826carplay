jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))

const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages-admin/operations-overview/operations-overview")
  return definition
}

function createPage(definition, data) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...(data || {})
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

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve))
}

describe("pages/operations-overview", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("管理员概览使用统一摘要口径并汇总车辆和预约", async () => {
    const results = {
      vehicleList: {
        ok: true,
        stats: { total: 8 },
        dashboard: { idle: 4, active: 2, maintenance: 2, recentAdded7d: 1 },
        recentAddedList: []
      },
      bookingList: {
        ok: true,
        dashboard: { total: 12, pending: 9, contacted: 3, completed: 0, recentCreated7d: 5 },
        recentCreatedList: []
      },
      operationSummaryGet: {
        ok: true,
        counts: {
          bookingPending: 6,
          bookingCoordinationPending: 7,
          privacyPending: 2,
          privacyProcessing: 1,
          storageCleanupPending: 3
        },
        unavailable: [],
        partial: false
      }
    }
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ name, success }) => {
          success({ result: results[name] })
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      canManageVehicles: true,
      canManageBookings: true,
      canManageRoles: true
    })

    page.loadOverview()
    await flushPromises()

    expect(page.data.loadError).toBe("")
    expect(page.data.vehicleMetrics.find((item) => item.key === "total").value).toBe(8)
    expect(page.data.bookingMetrics.find((item) => item.key === "pending").value).toBe(9)
    expect(page.data.alerts.find((item) => item.key === "booking").title).toBe("7 条预约待协调")
    expect(page.data.alerts.find((item) => item.key === "booking").url).toBe(
      "/pages/booking-workbench/booking-workbench"
    )
    expect(page.data.alerts.find((item) => item.key === "privacy").value).toBe(3)
    expect(page.data.alerts.find((item) => item.key === "storage").value).toBe(3)
    expect(page.data.pendingActionCount).toBe(15)
    expect(page.data.attentionAreaCount).toBe(4)
    expect(page.data.loadedSourceCount).toBe(3)
    expect(page.data.requestedSourceCount).toBe(3)
    expect(page.data.lastSyncedText).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/)
    expect(page.data.vehicleMetrics.find((item) => item.key === "maintenance").iconClass).toBe(
      "metric-icon-maintenance"
    )
    expect(page.data.bookingMetrics.find((item) => item.key === "pending").iconClass).toBe(
      "metric-icon-contact"
    )
    expect(page.data.alerts.find((item) => item.key === "booking")).toMatchObject({
      iconClass: "alert-native-icon-booking",
      actionLabel: "立即处理"
    })
    expect(page.data.syncProgress).toBe(100)
    expect(page.data.syncStateClass).toBe("sync-state-complete")
    expect(page.data.operationStateClass).toBe("operation-state-attention")
  })

  test("单项失败时保留其他模块并显示不可用提示", async () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ name, success }) => {
          if (name === "vehicleList") {
            success({ result: { ok: false, message: "车辆统计加载失败" } })
            return
          }
          if (name === "bookingList") {
            success({
              result: {
                ok: true,
                dashboard: { total: 3, pending: 1, contacted: 1, completed: 1, recentCreated7d: 2 },
                recentCreatedList: []
              }
            })
            return
          }
          success({
            result: {
              ok: true,
              counts: {
                bookingPending: 1,
                bookingCoordinationPending: 2
              },
              unavailable: [],
              partial: false
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      canManageVehicles: true,
      canManageBookings: true,
      canManageRoles: false
    })

    page.loadOverview()
    await flushPromises()

    expect(page.data.bookingLoaded).toBe(true)
    expect(page.data.vehicleLoaded).toBe(false)
    expect(page.data.loadError).toBe("车辆统计加载失败")
    expect(page.data.alerts.find((item) => item.key === "vehicle").tone).toBe("neutral")
    expect(page.data.alerts.find((item) => item.key === "booking").value).toBe(2)
    expect(page.data.pendingActionCount).toBe(2)
    expect(page.data.attentionAreaCount).toBe(1)
    expect(page.data.loadedSourceCount).toBe(2)
    expect(page.data.requestedSourceCount).toBe(3)
    expect(page.data.syncProgress).toBe(67)
    expect(page.data.syncStateLabel).toBe("部分数据可用")
    expect(page.data.syncStateClass).toBe("sync-state-partial")
  })

  test("数据源没有回调时按超时失败收口，不会一直显示骨架屏", async () => {
    jest.useFakeTimers()
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      }
    }
    const page = createPage(loadPageDefinition(), {
      canManageVehicles: true,
      canManageBookings: false,
      canManageRoles: false
    })

    page.loadOverview()
    jest.advanceTimersByTime(15 * 1000)
    await Promise.resolve()
    await Promise.resolve()

    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("数据请求超时，请稍后刷新")
    expect(page.data.loadedSourceCount).toBe(0)
  })

  test("数据源同步抛错时收口为模块错误", async () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud init failed")
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      canManageVehicles: true,
      canManageBookings: false,
      canManageRoles: false
    })

    expect(() => page.loadOverview()).not.toThrow()
    await flushPromises()

    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("cloud init failed")
    expect(page.data.vehicleLoaded).toBe(false)
  })

  test("数据源 fail 回调保留明确错误并执行刷新完成回调", async () => {
    const done = jest.fn()
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ fail }) => {
          fail({ errMsg: "callFunction:fail network" })
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      canManageVehicles: true,
      canManageBookings: false,
      canManageRoles: false
    })

    page.loadOverview({ refreshing: true, done })
    await flushPromises()

    expect(page.data.refreshing).toBe(false)
    expect(page.data.loadError).toBe("callFunction:fail network")
    expect(done).toHaveBeenCalledTimes(1)
  })

  test("数据源超时后忽略迟到成功回调", async () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      canManageVehicles: true,
      canManageBookings: false,
      canManageRoles: false
    })

    page.loadOverview()
    jest.advanceTimersByTime(15 * 1000)
    await Promise.resolve()
    await Promise.resolve()
    lateSuccess({
      result: {
        ok: true,
        stats: { total: 99 },
        dashboard: { idle: 99 }
      }
    })
    await Promise.resolve()

    expect(page.data.loadError).toBe("数据请求超时，请稍后刷新")
    expect(page.data.vehicleLoaded).toBe(false)
    expect(page.data.vehicleMetrics).toEqual([])
  })

  test("重叠刷新时旧聚合结果不会覆盖最新概览", async () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition(), {
      canManageVehicles: true,
      canManageBookings: false,
      canManageRoles: false
    })
    const firstDone = jest.fn()

    page.loadOverview({ refreshing: true, done: firstDone })
    page.loadOverview({ refreshing: true })
    expect(firstDone).toHaveBeenCalledTimes(1)

    requests[1].success({
      result: {
        ok: true,
        stats: { total: 2 },
        dashboard: { idle: 2, active: 0, maintenance: 0 }
      }
    })
    await flushPromises()
    requests[0].success({
      result: {
        ok: true,
        stats: { total: 99 },
        dashboard: { idle: 99, active: 0, maintenance: 0 }
      }
    })
    await flushPromises()

    expect(page.data.vehicleMetrics.find((item) => item.key === "total").value).toBe(2)
    expect(page.data.refreshing).toBe(false)
  })

  test("离开总览后聚合回调不再更新页面并结束刷新", async () => {
    let lateSuccess = null
    const done = jest.fn()
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const existingMetrics = [{ key: "total", value: 7 }]
    const page = createPage(loadPageDefinition(), {
      canManageVehicles: true,
      canManageBookings: false,
      canManageRoles: false,
      vehicleMetrics: existingMetrics
    })

    page.loadOverview({ refreshing: true, done })
    page.onUnload()
    lateSuccess({
      result: {
        ok: true,
        stats: { total: 88 },
        dashboard: { idle: 88 }
      }
    })
    await flushPromises()

    expect(done).toHaveBeenCalledTimes(1)
    expect(page.data.vehicleMetrics).toBe(existingMetrics)
  })

  test("云能力缺失时立即结束加载并调用完成回调", () => {
    const done = jest.fn()
    global.wx = {}
    const page = createPage(loadPageDefinition(), {
      canManageVehicles: true
    })

    page.loadOverview({ refreshing: true, done })

    expect(page.data.loading).toBe(false)
    expect(page.data.refreshing).toBe(false)
    expect(page.data.loadError).toBe("云能力未初始化")
    expect(done).toHaveBeenCalledTimes(1)
  })

  test("运营总览使用同步进度、业务图标和原生导航箭头", () => {
    const pageDir = path.resolve(__dirname, "../pages-admin/operations-overview")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "operations-overview.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "operations-overview.wxss"), "utf8")

    expect(wxmlSource).toContain('class="hero-sync {{syncStateClass}}"')
    expect(wxmlSource).toContain('aria-label="{{loading || refreshing ? \'正在刷新运营数据\' : \'刷新运营数据\'}}"')
    expect(wxmlSource).toContain("{{syncProgress}}%")
    expect(wxmlSource).toContain('class="overview-skeleton"')
    expect(wxmlSource).toContain("overview-skeleton-pulse")
    expect(wxmlSource).toContain("overview-skeleton-alert")
    expect(wxmlSource).toContain("overview-skeleton-metrics")
    expect(wxmlSource).not.toContain('class="state-loader"')
    expect(wxmlSource).toContain('class="pulse-native-icon pulse-native-icon-action"')
    expect(wxmlSource).toContain('class="alert-native-icon {{item.iconClass}}"')
    expect(wxmlSource).toContain('class="metric-native-icon {{item.iconClass}}"')
    expect(wxmlSource).toContain('class="recent-native-icon {{item.iconClass}}"')
    expect(wxmlSource).toContain('class="section-link-chevron"')
    expect(wxmlSource).toContain('class="recent-chevron"')
    expect(wxmlSource).toContain('hover-class="section-link-pressed"')
    expect(wxmlSource).toContain('hover-class="recent-item-pressed"')
    expect(wxmlSource).toContain('aria-label="查看 {{item.title}}，{{item.meta}}，{{item.statusLabel}}"')
    expect(wxmlSource).toContain("booking-section-native-icon inline-empty-native-icon")
    expect(wxmlSource).toContain("vehicle-section-native-icon inline-empty-native-icon")
    expect(wxmlSource).toContain("已同步的其他模块不受影响，可稍后刷新重试")
    expect(wxmlSource).not.toMatch(/[›✓✔]/)
    expect(wxssSource).toContain(".sync-state-complete .hero-sync-progress")
    expect(wxssSource).toContain(".alert-native-icon-storage")
    expect(wxssSource).toContain(".metric-icon-maintenance")
    expect(wxssSource).toContain(".inline-empty-native-icon")
    expect(wxssSource).toContain(".overview-skeleton-stat")
    expect(wxssSource).toContain(".overview-skeleton-metric")
    expect(wxssSource).toContain(".section-link-pressed")
    expect(wxssSource).toContain(".recent-item-pressed")
    expect(wxssSource).toMatch(/\.recent-title\s*\{[^}]*-webkit-line-clamp:\s*2/s)
    expect(wxssSource).toContain(".refresh-link-pressed")
  })
})
