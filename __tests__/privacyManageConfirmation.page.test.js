function createPage() {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  global.getApp = () => ({ globalData: {} })
  global.wx = { showToast: jest.fn(), showActionSheet: jest.fn(), showModal: jest.fn(), cloud: { callFunction: jest.fn() } }
  require("../pages-admin/privacy-request-manage/privacy-request-manage")
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  Object.assign(page.data, {
    pageAuthorized: true, initialLoading: false, hasLoaded: true,
    list: ["request_a", "request_b"].map((id) => ({ id, type: "correction", status: "pending", canHandle: true }))
  })
  global.getCurrentPages = () => [page]
  return page
}

function openRequest(page, id = "request_a") {
  page.handleRequestAction({ currentTarget: { dataset: { id } } })
}

describe("隐私申请处理的两阶段原生确认", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  test.each(["menu", "reason"])("在%s阶段连点另一个申请不会使当前有效确认失效或换错申请", (phase) => {
    const page = createPage()
    let menu
    let reason
    wx.showActionSheet.mockImplementation((options) => {
      if (!menu) menu = options
      else if (options.fail) options.fail({ errMsg: "showActionSheet:fail unavailable" })
    })
    wx.showModal.mockImplementation((options) => { reason = options })
    openRequest(page)
    if (phase === "reason") menu.success({ tapIndex: 2 })
    openRequest(page, "request_b")
    if (phase === "menu") menu.success({ tapIndex: 2 })
    expect(reason).toBeDefined()
    reason.success({ confirm: true, content: "身份资料尚需补充" })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction.mock.calls[0][0].data).toEqual({ id: "request_a", status: "rejected", resolutionNote: "身份资料尚需补充" })
    expect(wx.showActionSheet).toHaveBeenCalledTimes(1)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["menu", "reason"])("%s阶段原生同步异常不会冒泡，用户可重新处理申请", (phase) => {
    const page = createPage()
    if (phase === "menu") wx.showActionSheet.mockImplementationOnce(() => { throw new Error("native unavailable") })
    else wx.showModal.mockImplementationOnce(() => { throw new Error("native unavailable") })
    const attempt = () => {
      openRequest(page)
      if (phase === "reason") wx.showActionSheet.mock.calls[0][0].success({ tapIndex: 2 })
    }
    expect(attempt).not.toThrow()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "操作窗口打开失败", icon: "none" })
    openRequest(page, "request_b")
    wx.showActionSheet.mock.calls.at(-1)[0].success({ tapIndex: 0 })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction.mock.calls[0][0].data).toEqual({ id: "request_b", status: "processing", resolutionNote: "" })
    page.onUnload()
  })

  test.each([
    ["menu", "cancel"], ["menu", "failure"],
    ["reason", "cancel"], ["reason", "fail-cancel"], ["reason", "failure"], ["reason", "short-note"]
  ])("%s阶段%s只结束本次确认，之后可以处理另一个申请", (phase, outcome) => {
    const page = createPage()
    openRequest(page)
    let nativeOptions = wx.showActionSheet.mock.calls[0][0]
    if (phase === "reason") {
      nativeOptions.success({ tapIndex: 2 })
      nativeOptions = wx.showModal.mock.calls[0][0]
    }
    if (outcome === "short-note") nativeOptions.success({ confirm: true, content: "短" })
    else if (phase === "reason" && outcome === "cancel") nativeOptions.success({ confirm: false, cancel: true })
    else nativeOptions.fail({ errMsg: outcome.includes("cancel") ? "fail cancel" : "fail unavailable" })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    if (outcome.includes("cancel")) expect(wx.showToast).not.toHaveBeenCalled()
    else expect(wx.showToast).toHaveBeenCalledWith({ title: outcome === "short-note" ? "说明至少 2 字" : "操作窗口打开失败", icon: "none" })
    openRequest(page, "request_b")
    expect(wx.showActionSheet).toHaveBeenCalledTimes(2)
    wx.showActionSheet.mock.calls[1][0].success({ tapIndex: 0 })
    expect(wx.cloud.callFunction.mock.calls[0][0].data.id).toBe("request_b")
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["menu", "reason"])("%s没有回执时切页返回可重试，旧回执不能结束新申请确认", (phase) => {
    const page = createPage()
    openRequest(page)
    const oldMenu = wx.showActionSheet.mock.calls[0][0]
    if (phase === "reason") oldMenu.success({ tapIndex: 2 })
    const oldReason = wx.showModal.mock.calls[0] && wx.showModal.mock.calls[0][0]
    page.onHide()
    global.getCurrentPages = () => [page, {}]
    openRequest(page, "request_b")
    expect(wx.showActionSheet).toHaveBeenCalledTimes(1)
    global.getCurrentPages = () => [page]
    page.onShow()
    const refresh = wx.cloud.callFunction.mock.calls[0][0]
    expect(refresh.name).toBe("privacyRequestList")
    refresh.success({ result: { ok: true, list: page.data.list } })
    openRequest(page, "request_b")
    const newMenu = wx.showActionSheet.mock.calls[1][0]
    if (phase === "menu") oldMenu.success({ tapIndex: 2 })
    else oldReason.success({ confirm: true, content: "离开之前的原因" })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.showModal).toHaveBeenCalledTimes(phase === "reason" ? 1 : 0)
    openRequest(page)
    expect(wx.showActionSheet).toHaveBeenCalledTimes(2)
    newMenu.success({ tapIndex: 0 })
    expect(wx.cloud.callFunction.mock.calls[1][0].data.id).toBe("request_b")
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["menu", "reason"])("%s阶段卸载后原生失败不弹提示，也不再次拉起处理窗口", (phase) => {
    const page = createPage()
    openRequest(page)
    let nativeOptions = wx.showActionSheet.mock.calls[0][0]
    if (phase === "reason") {
      nativeOptions.success({ tapIndex: 2 })
      nativeOptions = wx.showModal.mock.calls[0][0]
    }
    page.onUnload()
    const updates = page.setData.mock.calls.length
    nativeOptions.fail({ errMsg: "native unavailable" })
    openRequest(page, "request_b")
    expect(wx.showActionSheet).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.setData).toHaveBeenCalledTimes(updates)
  })

  test.each(["success", "conflict", "network", "timeout"])("驳回提交在后台%s后，返回只交付一次并恢复处理入口", (outcome) => {
    const page = createPage()
    openRequest(page)
    wx.showActionSheet.mock.calls[0][0].success({ tapIndex: 2 })
    wx.showModal.mock.calls[0][0].success({ confirm: true, content: "需要补充身份证明" })
    const request = wx.cloud.callFunction.mock.calls[0][0]
    expect(request.name).toBe("privacyRequestUpdateStatus")
    page.onHide()
    global.getCurrentPages = () => [page, {}]
    if (outcome === "success") request.success({ result: { ok: true, status: "rejected" } })
    else if (outcome === "conflict") request.success({ result: { ok: false, code: "STATUS_CONFLICT", message: "申请状态已发生变化，请刷新后重试" } })
    else if (outcome === "network") request.fail({ errMsg: "offline" })
    else jest.advanceTimersByTime(20000)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data.updatingId).toBe("request_a")
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.updatingId).toBe("")
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(page._privacyManageDeferredResult).toBeNull()
    if (outcome === "success") {
      expect(wx.cloud.callFunction).toHaveBeenCalledTimes(2)
      const refresh = wx.cloud.callFunction.mock.calls[1][0]
      expect(refresh.name).toBe("privacyRequestList")
      refresh.success({ result: { ok: true, list: [page.data.list[1]] } })
    } else expect(page.data.list[0].status).toBe("pending")
    openRequest(page, "request_b")
    expect(wx.showActionSheet).toHaveBeenCalledTimes(2)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction.mock.calls.filter(([call]) => call.name === "privacyRequestUpdateStatus")).toHaveLength(1)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })
})
