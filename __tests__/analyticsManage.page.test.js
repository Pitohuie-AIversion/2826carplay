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
})
