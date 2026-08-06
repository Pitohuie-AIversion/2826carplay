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
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("预约管理写操作超时后恢复状态并忽略迟到成功", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
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
    page.saveRemark("booking_2", "重复操作")
    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(20 * 1000)
    expect(page.data.loading).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "更新超时，请重试",
      icon: "none"
    })

    lateSuccess({
      result: {
        ok: true,
        notificationStatus: "sent"
      }
    })
    expect(page.fetchList).not.toHaveBeenCalled()
  })

  test("预约管理写操作遇到云 SDK 同步异常时安全结束", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud down")
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/booking-manage/booking-manage"),
      {}
    )

    expect(() => page.saveRemark("booking_1", "跟进中")).not.toThrow()
    expect(page.data.loading).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "cloud down",
      icon: "none"
    })
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
      confirmText: "知道了",
      confirmColor: "#528fff",
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

  test("详情状态更新超时后恢复按钮并忽略迟到成功", () => {
    jest.useFakeTimers()
    let lateSuccess = null
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      },
      showModal: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"),
      { id: "booking_timeout" }
    )
    page.loadDetail = jest.fn()

    page.updateStatus("contacted")
    jest.advanceTimersByTime(20 * 1000)

    expect(page.data.loading).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "更新超时，请重试",
      icon: "none"
    })

    lateSuccess({
      result: {
        ok: true,
        notificationStatus: "sent"
      }
    })
    expect(page.loadDetail).not.toHaveBeenCalled()
  })

  test("离开详情页后提醒弹窗不再触发刷新", () => {
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
      loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"),
      { id: "booking_unloaded" }
    )
    page.loadDetail = jest.fn()

    page.updateStatus("contacted")
    page.onUnload()
    global.wx.showModal.mock.calls[0][0].complete()

    expect(page.loadDetail).not.toHaveBeenCalled()
  })
})
