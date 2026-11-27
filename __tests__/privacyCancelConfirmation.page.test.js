describe("客户隐私撤回确认的生命周期", () => {
  let page, stack, requests, modals
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    modals = []
    global.wx = {
      cloud: { callFunction: jest.fn((request) => requests.push(request)) },
      showModal: jest.fn((options) => modals.push(options)),
      showToast: jest.fn(), setStorageSync: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages/privacy-request/privacy-request")
    page.applyRequestList(["request_a", "request_b"].map((id) => ({ id, type: "access", status: "pending", description: "查询个人信息" })))
    stack = [page]
    global.getCurrentPages = () => stack
    page.handleDescriptionInput({ detail: { value: "另一份未提交草稿" } })
  })
  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
    delete global.getApp
  })
  function open(id = "request_a") {
    page.handleCancelRequest({ currentTarget: { dataset: { id } } })
  }
  function leave() {
    if (typeof page.onHide === "function") page.onHide()
    stack = [page, {}]
  }

  test("连点另一个申请不会使第一个可见确认失效，也不会换错撤回对象", () => {
    wx.showModal.mockImplementation((options) => {
      modals.push(options)
      if (modals.length > 1 && options.fail) options.fail({ errMsg: "showModal:fail busy" })
    })
    open()
    open("request_b")
    modals[0].success({ confirm: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].data.id).toBe("request_a")
    expect(wx.showModal).toHaveBeenCalledTimes(1)
    expect(page.data.description).toBe("另一份未提交草稿")
  })

  test.each(["cancel", "native-cancel", "failure", "confirmed"])("已消费的 %s 确认回执不能再次发送撤回", (outcome) => {
    open()
    const modal = modals[0]
    if (outcome === "cancel") modal.success({ confirm: false, cancel: true })
    else if (outcome === "native-cancel") modal.fail({ errMsg: "showModal:fail cancel" })
    else if (outcome === "failure") modal.fail({ errMsg: "showModal:fail unavailable" })
    else {
      modal.success({ confirm: true })
      requests[0].fail({ errMsg: "连接中断" })
    }
    modal.success({ confirm: true })
    expect(requests).toHaveLength(outcome === "confirmed" ? 1 : 0)
    if (outcome.includes("cancel")) expect(wx.showToast).not.toHaveBeenCalled()
    open("request_b")
    modals[1].success({ confirm: true })
    expect(requests.at(-1).data.id).toBe("request_b")
  })

  test.each(["throw", "failure"])("原生确认 %s 后恢复重试且保留草稿", (outcome) => {
    if (outcome === "throw") wx.showModal.mockImplementationOnce(() => { throw new Error("native unavailable") })
    expect(() => open()).not.toThrow()
    if (outcome === "failure") modals[0].fail({ errMsg: "showModal:fail unavailable" })
    expect(wx.showToast).toHaveBeenCalledWith({ title: "撤回窗口打开失败", icon: "none" })
    expect(page.data.description).toBe("另一份未提交草稿")
    expect(requests).toHaveLength(0)
    open("request_b")
    modals.at(-1).success({ confirm: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].data.id).toBe("request_b")
  })

  test.each(["success", "fail"])("切页返回后旧 %s 回执不能干扰新的撤回确认", (callback) => {
    open()
    const old = modals[0]
    leave()
    stack = [page]
    page.onShow()
    open("request_b")
    old[callback](callback === "success" ? { confirm: true } : { errMsg: "native unavailable" })
    expect(requests).toHaveLength(0)
    expect(wx.showToast).not.toHaveBeenCalled()
    open()
    expect(modals).toHaveLength(2)
    modals[1].success({ confirm: true })
    expect(requests[0].data.id).toBe("request_b")
  })

  test.each(["success", "fail"])("卸载后旧 %s 回执不写入、不提示、不能重开窗口", (callback) => {
    open()
    page.onUnload()
    page.setData.mockClear()
    modals[0][callback](callback === "success" ? { confirm: true } : { errMsg: "native unavailable" })
    open("request_b")
    expect(modals).toHaveLength(1)
    expect(requests).toHaveLength(0)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("非当前页面的迟到点击不会拉起原生确认", () => {
    stack = [page, {}]
    open()
    expect(modals).toHaveLength(0)
  })

  test("应用切后台会丢弃未完成确认，回前台需要重新确认", () => {
    const app = { globalData: { nativeActionAppVisible: true } }
    global.getApp = () => app
    open()
    if (typeof page.onHide === "function") page.onHide()
    app.globalData.nativeActionAppVisible = false
    app.globalData.nativeActionAppVisible = true
    page.onShow()
    modals[0].success({ confirm: true })
    expect(requests).toHaveLength(0)
    open()
    modals[1].success({ confirm: true })
    expect(requests).toHaveLength(1)
  })

  test("撤回请求超时后旧确认不能自动重发，新的确认可重试", () => {
    open()
    modals[0].success({ confirm: true })
    jest.advanceTimersByTime(12000)
    expect(page.data.cancellingId).toBe("")
    modals[0].success({ confirm: true })
    expect(requests).toHaveLength(1)
    open()
    modals[1].success({ confirm: true })
    expect(requests).toHaveLength(2)
  })

  test("撤回成功并重新读取后，重复确认不再发送撤回请求", () => {
    open()
    modals[0].success({ confirm: true })
    requests[0].success({ result: { ok: true, id: "request_a", status: "cancelled" } })
    requests[1].success({ result: { ok: true, list: [{ id: "request_a", type: "access", status: "cancelled" }], page: 0, hasMore: false } })
    modals[0].success({ confirm: true })
    expect(requests).toHaveLength(2)
    expect(page.data.list[0].canCancel).toBe(false)
    expect(page.data.description).toBe("另一份未提交草稿")
  })
})
