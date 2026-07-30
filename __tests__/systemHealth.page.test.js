jest.mock("../shared/pageAuth", () => ({
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
    expect(page.data.summary.ready).toBe(true)
    expect(page.data.checks[0]).toMatchObject({
      statusLabel: "正常",
      statusClass: "check-pass"
    })
    expect(page.data.checks[1]).toMatchObject({
      statusLabel: "待确认",
      statusClass: "check-warning"
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
})
