function loadPageDefinition(path) {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require(path)
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

describe("预约管理状态提醒反馈", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("列表更新成功且提醒发送失败时明确提示并刷新", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              notificationStatus: "failed"
            }
          })
        })
      },
      showModal: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/booking-manage/booking-manage"),
      {}
    )
    page.fetchList = jest.fn()

    page.updateStatus("booking_1", "contacted")

    expect(global.wx.showModal).toHaveBeenCalledWith({
      title: "状态已更新",
      content: "预约状态已更新，但提醒发送失败。可在错误日志中查看原因。",
      showCancel: false,
      complete: expect.any(Function)
    })
    expect(global.wx.showToast).not.toHaveBeenCalled()
    global.wx.showModal.mock.calls[0][0].complete()
    expect(page.fetchList).toHaveBeenCalledTimes(1)
  })

  test("详情更新成功且提醒已发送时给出成功反馈", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              notificationStatus: "sent"
            }
          })
        })
      },
      showModal: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"),
      { id: "booking_1" }
    )
    page.loadDetail = jest.fn()

    page.updateStatus("contacted")

    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "提醒已发送",
      icon: "none"
    })
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
  })

  test("详情更新成功但用户未订阅时区分提示", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              notificationStatus: "not_subscribed"
            }
          })
        })
      },
      showModal: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"),
      { id: "booking_1" }
    )
    page.loadDetail = jest.fn()

    page.updateStatus("contacted")

    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "用户未订阅提醒",
      icon: "none"
    })
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
  })
})
