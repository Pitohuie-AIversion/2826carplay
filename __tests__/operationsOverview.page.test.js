jest.mock("../shared/pageAuth", () => ({
  requirePagePermission: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/operations-overview/operations-overview")
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
    expect(page.data.alerts.find((item) => item.key === "booking").title).toBe("6 条预约待联系")
    expect(page.data.alerts.find((item) => item.key === "booking").url).toBe(
      "/pages/booking-workbench/booking-workbench"
    )
    expect(page.data.alerts.find((item) => item.key === "privacy").value).toBe(3)
    expect(page.data.alerts.find((item) => item.key === "storage").value).toBe(3)
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
              counts: { bookingPending: 1 },
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
    expect(page.data.alerts.find((item) => item.key === "booking").value).toBe(1)
  })
})
