function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/booking-manage/booking-manage")
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

describe("pages/booking-manage workflow filters", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("列表分页请求携带优先级和协调进度", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              list: [],
              total: 0,
              page: 0,
              hasMore: false
            }
          })
          if (complete) {
            complete()
          }
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      currentStatus: "contacted",
      currentPriority: "standby",
      currentCoordination: "coordinating",
      keyword: "杭州",
      pageSize: 20
    })

    page.fetchList()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingList",
      data: {
        status: "contacted",
        schedulePriority: "standby",
        coordinationStatus: "coordinating",
        keyword: "杭州",
        limit: 2000,
        page: 0,
        pageSize: 20
      },
      success: expect.any(Function),
      fail: expect.any(Function)
    })
  })

  test("导出沿用筛选，重置会清空三个筛选组", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      currentStatus: "pending",
      currentPriority: "priority",
      currentCoordination: "pending",
      keyword: "MX-5"
    })

    page.handleExport()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingExportCsv",
      data: {
        status: "pending",
        schedulePriority: "priority",
        coordinationStatus: "pending",
        keyword: "MX-5",
        limit: 500
      },
      success: expect.any(Function),
      fail: expect.any(Function)
    })

    page.fetchList = jest.fn()
    page.handleReset()
    expect(page.data).toEqual(expect.objectContaining({
      keyword: "",
      currentStatus: "all",
      currentPriority: "all",
      currentCoordination: "all"
    }))
    expect(page.fetchList).toHaveBeenCalledTimes(1)
  })
})
