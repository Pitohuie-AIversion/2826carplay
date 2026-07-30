jest.mock("../shared/pageAuth", () => ({
  requirePagePermission: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/privacy-data-inventory/privacy-data-inventory")
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

describe("pages/privacy-data-inventory", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("页面格式化三类数据并展示部分失败提示", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              partial: true,
              unavailable: ["favorites"],
              truncated: ["bookings"],
              request: {
                id: "request_1",
                openid: "user_openid",
                type: "access",
                status: "processing",
                createdAt: "2026-07-30T08:00:00.000Z"
              },
              categories: {
                bookings: {
                  count: 1,
                  truncated: false,
                  list: [
                    {
                      id: "booking_1",
                      vehicleName: "示例车辆",
                      status: "pending",
                      startDate: "2026-08-01",
                      endDate: "2026-08-02"
                    }
                  ]
                },
                favorites: {
                  count: 0,
                  truncated: false,
                  list: []
                },
                privacyRequests: {
                  count: 1,
                  truncated: false,
                  list: [{ id: "request_1", type: "access", status: "processing" }]
                }
              }
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      requestId: "request_1"
    })

    page.loadInventory()

    expect(page.data.loading).toBe(false)
    expect(page.data.partial).toBe(true)
    expect(page.data.unavailableText).toBe("收藏数据")
    expect(page.data.issueText).toBe("收藏数据暂不可用；预约数据超过单类 200 条展示上限")
    expect(page.data.request.typeLabel).toBe("查询信息")
    expect(page.data.bookings.list[0]).toMatchObject({
      statusLabel: "待联系",
      dateText: "2026-08-01 至 2026-08-02"
    })
    expect(page.data.privacyRequests.list[0].statusLabel).toBe("处理中")
  })

  test("云函数失败时显示明确错误", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: false,
              message: "隐私申请不存在"
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      requestId: "missing_request"
    })

    page.loadInventory()

    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("隐私申请不存在")
  })
})
