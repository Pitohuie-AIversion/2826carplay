describe("booking detail subscription native lifecycle", () => {
  let page
  let stack
  let app
  let subscriptions
  const templateId = "template_status_1234567890"
  const expectedTitles = {
    accept: "已订阅下一次状态提醒",
    reject: "未开启状态提醒",
    failure: "订阅失败，请稍后重试",
    timeout: "订阅请求超时，请重试"
  }

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    subscriptions = []
    app = { globalData: { nativeActionAppVisible: true } }
    global.getApp = () => app
    global.wx = {
      cloud: { callFunction: jest.fn() },
      requestSubscribeMessage: jest.fn((options) => subscriptions.push(options)),
      showToast: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages/booking-detail/booking-detail")
    Object.assign(page.data, {
      id: "booking_1",
      booking: { id: "booking_1", status: "pending" },
      canEdit: true,
      bookingStatusTemplateId: templateId,
      subscriptionEnabled: true
    })
    page.loadNotificationConfig = jest.fn()
    page.loadDetail = jest.fn()
    stack = [page]
    global.getCurrentPages = () => stack
  })

  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  function finish(kind, index = 0) {
    const options = subscriptions[index]
    if (kind === "timeout") jest.advanceTimersByTime(15000)
    else if (kind === "failure") options.fail({ errMsg: "requestSubscribeMessage:fail unavailable" })
    else if (kind === "cancel") options.fail({ errMsg: "requestSubscribeMessage:fail cancel" })
    else if (kind === "complete") options.complete()
    else options.success({ errMsg: "requestSubscribeMessage:ok", [templateId]: kind })
    options.complete()
  }

  test.each(["accept", "reject", "failure", "cancel", "timeout", "complete"])("background %s waits until this page returns before unlocking and showing one result", (kind) => {
    page.handleRequestStatusSubscription()
    stack = [page, { route: "pages/mine/mine" }]
    page.setData.mockClear()
    finish(kind)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)

    stack = [page]
    page.onShow()
    expect(page.data.subscriptionRequesting).toBe(false)
    if (expectedTitles[kind]) expect(wx.showToast).toHaveBeenCalledWith({ title: expectedTitles[kind], icon: "none" })
    else expect(wx.showToast).not.toHaveBeenCalled()
    const toastCount = wx.showToast.mock.calls.length
    subscriptions[0].success({ [templateId]: "accept" })
    subscriptions[0].fail({ errMsg: "late failure" })
    subscriptions[0].complete()
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(toastCount)
    expect(wx.requestSubscribeMessage).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test("an app hidden with the same top page also defers its accepted result", () => {
    page.handleRequestStatusSubscription()
    app.globalData.nativeActionAppVisible = false
    page.setData.mockClear()
    finish("accept")
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    app.globalData.nativeActionAppVisible = true
    page.onShow()
    expect(page.data.subscriptionRequesting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: expectedTitles.accept, icon: "none" })
  })

  test("a hidden or unloaded page cannot launch another native subscription", () => {
    stack = [page, {}]
    page.handleRequestStatusSubscription()
    expect(wx.requestSubscribeMessage).not.toHaveBeenCalled()
    expect(page.setData).not.toHaveBeenCalled()
    stack = [page]
    page.onUnload()
    page.handleRequestStatusSubscription()
    expect(wx.requestSubscribeMessage).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test.each(["accept", "reject", "ban", "filter"])("foreground %s reports only the native template choice once", (choice) => {
    page.handleRequestStatusSubscription()
    expect(subscriptions[0].tmplIds).toEqual([templateId])
    finish(choice)
    subscriptions[0].fail({ errMsg: "late failure" })
    subscriptions[0].success({ [templateId]: "accept" })
    expect(page.data.subscriptionRequesting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: choice === "accept" ? expectedTitles.accept : expectedTitles.reject, icon: "none" })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test("after a background timeout, an old response cannot unlock or confirm the new request", () => {
    page.handleRequestStatusSubscription()
    stack = [page, {}]
    finish("timeout")
    stack = [page]
    page.onShow()
    wx.showToast.mockClear()
    page.handleRequestStatusSubscription()
    page.setData.mockClear()
    subscriptions[0].success({ [templateId]: "accept" })
    subscriptions[0].complete()
    expect(page.data.subscriptionRequesting).toBe(true)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    finish("accept", 1)
    expect(page.data.subscriptionRequesting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: expectedTitles.accept, icon: "none" })
  })

  test.each(["booking", "template"])("returning after the %s changes discards the old result while allowing a fresh request", (change) => {
    page.handleRequestStatusSubscription()
    stack = [page, {}]
    finish("accept")
    if (change === "booking") page.data.id = "booking_2"
    else page.data.bookingStatusTemplateId = "new_status_template"
    stack = [page]
    page.onShow()
    expect(page.data.subscriptionRequesting).toBe(false)
    expect(wx.showToast).not.toHaveBeenCalled()
    page.handleRequestStatusSubscription()
    expect(subscriptions).toHaveLength(2)
    expect(subscriptions[1].tmplIds).toEqual([page.data.bookingStatusTemplateId])
  })

  test.each([false, true])("unload discards late callbacks and pending completion; received=%s", (received) => {
    page.handleRequestStatusSubscription()
    stack = [page, {}]
    if (received) finish("accept")
    page.onUnload()
    page.setData.mockClear()
    subscriptions[0].success({ [templateId]: "accept" })
    subscriptions[0].fail({ errMsg: "late failure" })
    subscriptions[0].complete()
    jest.advanceTimersByTime(15000)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page._pendingSubscriptionCompletion).toBeNull()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("returning before a response keeps the request locked and its later success works once", () => {
    page.handleRequestStatusSubscription()
    stack = [page, {}]
    page.onHide()
    stack = [page]
    page.onShow()
    page.handleRequestStatusSubscription()
    expect(page.data.subscriptionRequesting).toBe(true)
    expect(page.loadDetail).not.toHaveBeenCalled()
    expect(subscriptions).toHaveLength(1)
    finish("accept")
    expect(page.data.subscriptionRequesting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("a synchronous API failure after hiding is reported only after return", () => {
    wx.requestSubscribeMessage.mockImplementationOnce((options) => {
      subscriptions.push(options)
      stack = [page, {}]
      page.setData.mockClear()
      throw new Error("native unavailable")
    })
    expect(() => page.handleRequestStatusSubscription()).not.toThrow()
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    stack = [page]
    page.onShow()
    subscriptions[0].success({ [templateId]: "accept" })
    expect(page.data.subscriptionRequesting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: expectedTitles.failure, icon: "none" })
  })
})
