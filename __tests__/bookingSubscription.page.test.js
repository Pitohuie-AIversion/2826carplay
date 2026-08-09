function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/booking/booking")
  return definition
}

function loadDetailPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/booking-detail/booking-detail")
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
    Object.assign(page.data, patch)
  })
  return page
}

describe("pages/booking subscription", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test("配置模板时请求一次状态订阅并继续提交", () => {
    const done = jest.fn()
    global.wx = {
      requestSubscribeMessage: jest.fn(({ complete }) => complete())
    }
    const page = createPage(loadPageDefinition(), {
      bookingStatusTemplateId: "template_1234567890"
    })

    page.requestStatusSubscription(done)

    expect(global.wx.requestSubscribeMessage).toHaveBeenCalledWith({
      tmplIds: ["template_1234567890"],
      complete: expect.any(Function)
    })
    expect(done).toHaveBeenCalledTimes(1)
  })

  test("用户拒绝或接口异常时仍继续提交", () => {
    const done = jest.fn()
    global.wx = {
      requestSubscribeMessage: jest.fn(() => {
        throw new Error("request unavailable")
      })
    }
    const page = createPage(loadPageDefinition(), {
      bookingStatusTemplateId: "template_1234567890"
    })

    page.requestStatusSubscription(done)

    expect(done).toHaveBeenCalledTimes(1)
  })

  test("未配置模板时不请求授权", () => {
    const done = jest.fn()
    global.wx = {
      requestSubscribeMessage: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      bookingStatusTemplateId: ""
    })

    page.requestStatusSubscription(done)

    expect(global.wx.requestSubscribeMessage).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
  })

  test("进行中的预约可再次订阅下一次状态提醒", () => {
    const templateId = "template_1234567890"
    global.wx = {
      requestSubscribeMessage: jest.fn(({ success, complete }) => {
        success({ [templateId]: "accept" })
        complete()
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadDetailPageDefinition(), {
      canEdit: true,
      bookingStatusTemplateId: templateId,
      subscriptionEnabled: true
    })

    page.handleRequestStatusSubscription()

    expect(global.wx.requestSubscribeMessage).toHaveBeenCalledWith({
      tmplIds: [templateId],
      success: expect.any(Function),
      fail: expect.any(Function),
      complete: expect.any(Function)
    })
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "已订阅下一次状态提醒",
      icon: "none"
    })
    expect(page.data.subscriptionRequesting).toBe(false)
  })

  test("已结束预约不再请求状态订阅", () => {
    global.wx = {
      requestSubscribeMessage: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadDetailPageDefinition(), {
      canEdit: false,
      bookingStatusTemplateId: "template_1234567890",
      subscriptionEnabled: true
    })

    page.handleRequestStatusSubscription()

    expect(global.wx.requestSubscribeMessage).not.toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "状态提醒暂不可用",
      icon: "none"
    })
  })

  test("详情页订阅接口同步异常时恢复按钮状态", () => {
    global.wx = {
      requestSubscribeMessage: jest.fn(() => {
        throw new Error("request unavailable")
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadDetailPageDefinition(), {
      canEdit: true,
      bookingStatusTemplateId: "template_1234567890",
      subscriptionEnabled: true
    })

    page.handleRequestStatusSubscription()

    expect(page.data.subscriptionRequesting).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "订阅失败，请稍后重试",
      icon: "none"
    })
  })

  test("详情页订阅无回调时超时恢复并忽略迟到结果", () => {
    jest.useFakeTimers()
    let requestOptions = null
    const templateId = "template_1234567890"
    global.wx = {
      requestSubscribeMessage: jest.fn((options) => {
        requestOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadDetailPageDefinition(), {
      canEdit: true,
      bookingStatusTemplateId: templateId,
      subscriptionEnabled: true
    })

    page.handleRequestStatusSubscription()
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.subscriptionRequesting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "订阅请求超时，请重试",
      icon: "none"
    })
    requestOptions.success({ [templateId]: "accept" })
    requestOptions.complete()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("详情页离开后订阅回调保持静默", () => {
    let requestOptions = null
    const templateId = "template_1234567890"
    global.wx = {
      requestSubscribeMessage: jest.fn((options) => {
        requestOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadDetailPageDefinition(), {
      canEdit: true,
      bookingStatusTemplateId: templateId,
      subscriptionEnabled: true
    })

    page.handleRequestStatusSubscription()
    page.onUnload()
    requestOptions.success({ [templateId]: "accept" })
    requestOptions.complete()

    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("详情页离开后复制回调不再提示", () => {
    let clipboardOptions = null
    global.wx = {
      setClipboardData: jest.fn((options) => {
        clipboardOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadDetailPageDefinition(), {
      booking: { id: "booking-1" }
    })

    page.handleCopyBookingId()
    page.onUnload()
    clipboardOptions.success()
    clipboardOptions.fail()

    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("详情页离开后返回失败不再触发重定向降级", () => {
    let navigateOptions = null
    global.getCurrentPages = jest.fn(() => [{}, {}])
    global.wx = {
      navigateBack: jest.fn((options) => {
        navigateOptions = options
      }),
      redirectTo: jest.fn(),
      reLaunch: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadDetailPageDefinition())

    page.handleBackBookings()
    page.onUnload()
    navigateOptions.fail()

    expect(wx.redirectTo).not.toHaveBeenCalled()
    expect(wx.reLaunch).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })
})
