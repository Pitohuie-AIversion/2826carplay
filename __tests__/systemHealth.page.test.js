const fs = require("fs")
const path = require("path")

jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/system-health/system-health")
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

describe("pages/system-health", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("页面展示汇总与检查状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              checkedAt: "2026-07-30T08:30:00.000Z",
              summary: {
                total: 2,
                passed: 1,
                warnings: 1,
                failed: 0,
                ready: true
              },
              checks: [
                {
                  key: "collection_vehicles",
                  label: "车辆数据",
                  status: "pass",
                  message: "集合可正常访问"
                },
                {
                  key: "booking_status_template",
                  label: "预约状态订阅模板",
                  status: "warning",
                  message: "未配置模板"
                }
              ]
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.loadHealth()

    expect(page.data.loading).toBe(false)
    expect(page.data.summary.technicalReady).toBe(true)
    expect(page.data.summary.ready).toBe(false)
    expect(page.data.summary.level).toBe("attention")
    expect(page.data.summary.completionPercent).toBe(13)
    expect(page.data.checks[0]).toMatchObject({
      statusLabel: "正常",
      statusClass: "check-pass",
      groupLabel: "数据集合",
      iconClass: "check-kind-icon-database"
    })
    expect(page.data.checks[1]).toMatchObject({
      statusLabel: "待确认",
      statusClass: "check-warning",
      groupLabel: "运营配置",
      iconClass: "check-kind-icon-config"
    })
  })

  test("云函数业务失败时显示错误且可再次重试", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: false,
              message: "仅管理员可执行上线检查"
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.loadHealth()

    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("仅管理员可执行上线检查")
  })

  test("健康检查无回调时超时收尾并忽略迟到结果", () => {
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

    page.loadHealth({ refreshing: true, done })
    jest.advanceTimersByTime(20 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.refreshing).toBe(false)
    expect(page.data.loadError).toBe("上线检查超时，请检查网络后重试")
    expect(done).toHaveBeenCalledTimes(1)

    lateSuccess({
      result: {
        ok: true,
        checkedAt: "2026-08-06T08:30:00.000Z",
        summary: { total: 1, passed: 1, warnings: 0, failed: 0 },
        checks: [{ key: "late", status: "pass" }]
      }
    })
    expect(page.data.checks).toEqual([])
    expect(page.data.loadError).toBe("上线检查超时，请检查网络后重试")
  })

  test("新一轮刷新覆盖旧请求且旧结果不会回写", () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition())

    page.loadHealth()
    page.loadHealth({ refreshing: true })
    requests[1].success({
      result: {
        ok: true,
        checkedAt: "2026-08-06T08:30:00.000Z",
        summary: { total: 1, passed: 1, warnings: 0, failed: 0 },
        checks: [{ key: "fresh", label: "最新结果", status: "pass" }]
      }
    })
    requests[0].success({
      result: {
        ok: true,
        checkedAt: "2026-08-05T08:30:00.000Z",
        summary: { total: 1, passed: 0, warnings: 0, failed: 1 },
        checks: [{ key: "stale", label: "过期结果", status: "fail" }]
      }
    })

    expect(page.data.checks).toHaveLength(1)
    expect(page.data.checks[0].key).toBe("fresh")
    expect(page.data.summary.failed).toBe(0)
  })

  test("云 SDK 同步异常时安全结束加载", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud sdk crashed")
        })
      }
    }
    const page = createPage(loadPageDefinition())

    expect(() => page.loadHealth()).not.toThrow()
    expect(page.data.loading).toBe(false)
    expect(page.data.refreshing).toBe(false)
    expect(page.data.loadError).toBe("cloud sdk crashed")
  })

  test("人工确认保存在当前设备当天并实时更新完成度", () => {
    global.wx = {
      setStorageSync: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      summary: {
        total: 2,
        passed: 2,
        warnings: 0,
        failed: 0,
        technicalReady: true,
        ready: false,
        level: "attention",
        title: "自动检查通过，等待人工确认",
        desc: "",
        completionPercent: 25
      }
    })

    page.handleManualToggle({
      currentTarget: {
        dataset: {
          key: "indexes"
        }
      }
    })

    expect(page.data.manualCompletedCount).toBe(1)
    expect(page.data.manualChecks.find((item) => item.key === "indexes").checked).toBe(true)
    expect(page.data.manualChecks.find((item) => item.key === "indexes").iconClass).toBe(
      "manual-kind-icon-index"
    )
    expect(page.data.summary.level).toBe("attention")
    expect(page.data.summary.completionPercent).toBe(38)
    expect(global.wx.setStorageSync).toHaveBeenCalledWith(
      "system_health_manual_review_v1",
      expect.objectContaining({
        completedKeys: ["indexes"]
      })
    )
  })

  test("整体状态与人工确认使用原生图标和复选语义", () => {
    const pageDir = path.resolve(__dirname, "../pages/system-health")
    const wxml = fs.readFileSync(path.join(pageDir, "system-health.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "system-health.wxss"), "utf8")

    expect(wxml).toContain("summary-state-icon-{{summary.level}}")
    expect(wxml).toContain('class="health-skeleton"')
    expect(wxml).toContain("health-skeleton-completion")
    expect(wxml).toContain("health-skeleton-stats")
    expect(wxml).toContain("health-skeleton-check")
    expect(wxml).not.toContain('class="state-loader"')
    expect(wxml).toContain("manual-check-icon")
    expect(wxml).toContain("completion-breakdown")
    expect(wxml).toContain('class="check-kind-icon {{item.iconClass}}"')
    expect(wxml).toContain("check-status-native-icon-{{item.status}}")
    expect(wxml).toContain('class="manual-kind-icon {{item.iconClass}}"')
    expect(wxml).toContain('class="refresh-native-icon')
    expect(wxml).toContain('aria-disabled="{{loading || refreshing}}"')
    expect(wxml).toContain('hover-class="{{loading || refreshing ? \'none\' : \'refresh-link-pressed\'}}"')
    expect(wxml).toContain('aria-role="checkbox"')
    expect(wxml).toContain('aria-checked="{{item.checked}}"')
    expect(wxml).not.toContain("summary.level === 'ready' ? '✓'")
    expect(wxml).not.toContain("item.checked ? '✓'")
    expect(wxss).toContain(".summary-state-icon-ready")
    expect(wxss).toContain(".summary-state-icon-blocked::after")
    expect(wxss).toContain(".completion-stat-icon-pass")
    expect(wxss).toContain(".check-kind-icon-database")
    expect(wxss).toContain(".manual-kind-icon-devices")
    expect(wxss).toContain(".health-skeleton-summary")
    expect(wxss).toContain(".health-skeleton-check-status")
    expect(wxss).toContain(".refresh-link-pressed")
  })
})
