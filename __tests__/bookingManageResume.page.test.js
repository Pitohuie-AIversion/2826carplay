function loadPage(overrides = {}) {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  global.getApp = () => ({ globalData: {} })
  global.wx = { showToast: jest.fn(), showModal: jest.fn(), cloud: { callFunction: jest.fn() } }
  require("../pages/booking-manage/booking-manage")
  const page = { ...definition, data: { ...JSON.parse(JSON.stringify(definition.data)), pageAuthorized: true, ...overrides } }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  global.getCurrentPages = () => [page]
  return page
}

function respond(request, { list = [], page = 0, hasMore = true } = {}) {
  request.success({ result: { ok: true, list, page, hasMore, total: 30 } })
}

describe("预约管理分页筛选与切页恢复", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  test("未提交的关键词草稿不改变下一页筛选，确认搜索后从新关键词首页开始", () => {
    const page = loadPage({ keyword: "保时捷", currentCity: "杭州", currentPriority: "priority" })
    page.fetchList()
    respond(wx.cloud.callFunction.mock.calls[0][0], { list: [{ id: "porsche-1" }] })
    page.handleKeywordInput({ detail: { value: "法拉利" } })
    page.onReachBottom()
    const append = wx.cloud.callFunction.mock.calls[1][0]
    expect(append.data).toMatchObject({ keyword: "保时捷", city: "杭州", schedulePriority: "priority", page: 1 })
    respond(append, { list: [{ id: "porsche-2" }], page: 1 })
    expect(page.data.list.map((item) => item.id)).toEqual(["porsche-1", "porsche-2"])
    expect(page.data.keyword).toBe("法拉利")
    page.handleSearchConfirm({ detail: { value: "法拉利" } })
    expect(wx.cloud.callFunction.mock.calls[2][0].data).toMatchObject({ keyword: "法拉利", page: 0 })
  })

  test("分页失败后重试沿用已显示结果的筛选条件", () => {
    const page = loadPage({ keyword: "保时捷" })
    page.fetchList()
    respond(wx.cloud.callFunction.mock.calls[0][0], { list: [{ id: "existing" }] })
    page.handleKeywordInput({ detail: { value: "法拉利" } })
    page.handleLoadMore()
    wx.cloud.callFunction.mock.calls[1][0].fail({ errMsg: "offline" })
    page.handleLoadMore()
    expect(wx.cloud.callFunction.mock.calls[2][0].data).toMatchObject({ keyword: "保时捷", page: 1 })
    expect(page.data.list.map((item) => item.id)).toEqual(["existing"])
  })

  test("显式修改分页筛选时改为首页查询，不拼接不同条件的结果", () => {
    const page = loadPage({ keyword: "保时捷" })
    page.fetchList()
    respond(wx.cloud.callFunction.mock.calls[0][0], { list: [{ id: "existing" }] })
    page.fetchList({ append: true, keyword: "法拉利" })
    const request = wx.cloud.callFunction.mock.calls[1][0]
    expect(request.data).toMatchObject({ keyword: "法拉利", page: 0 })
    respond(request, { list: [{ id: "ferrari" }] })
    expect(page.data.list.map((item) => item.id)).toEqual(["ferrari"])
  })

  test("状态确认弹窗切页后返回的确认不提交写入", () => {
    const page = loadPage()
    page.handleUpdateStatus({ currentTarget: { dataset: { id: "booking_1", status: "contacted" } } })
    global.getCurrentPages = () => [{}]
    wx.showModal.mock.calls[0][0].success({ confirm: true })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test.each(["status", "remark"])("%s 写入在后台成功时不弹反馈，返回后刷新结果", (kind) => {
    const page = loadPage()
    page.fetchList = jest.fn()
    if (kind === "status") page.updateStatus("booking_1", "contacted")
    else page.saveRemark("booking_1", "已联系")
    global.getCurrentPages = () => [{}]
    page.setData.mockClear()
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, notificationStatus: "sent" } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(page.setData).not.toHaveBeenCalled()
    expect(page.fetchList).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.loading).toBe(false)
    expect(page.fetchList).toHaveBeenCalledTimes(1)
    page.onShow()
    expect(page.fetchList).toHaveBeenCalledTimes(1)
  })

  test.each(["timeout", "failure"])("后台 %s 静默收尾，返回页面后提示失败而不自动重试", (kind) => {
    const page = loadPage()
    page.fetchList = jest.fn()
    page.updateStatus("booking_1", "contacted")
    global.getCurrentPages = () => [{}]
    page.setData.mockClear()
    if (kind === "timeout") jest.advanceTimersByTime(20001)
    else wx.cloud.callFunction.mock.calls[0][0].fail({ errMsg: "offline" })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.setData).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.loading).toBe(false)
    expect(page.fetchList).not.toHaveBeenCalled()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test.each(["business", "network", "timeout"])("后台备注保存 %s 失败后返回页面、刷新列表仍保留草稿，主动重试使用新基线", (kind) => {
    const page = loadPage({ list: [{ id: "booking_1", adminRemark: "原备注", adminRemarkDraft: "未保存的跟进草稿" }] })
    page.saveRemark("booking_1", "未保存的跟进草稿")
    global.getCurrentPages = () => [{}]
    const saveRequest = wx.cloud.callFunction.mock.calls[0][0]
    if (kind === "business") saveRequest.success({ result: { ok: false, message: "备注已被其他管理员修改" } })
    else if (kind === "network") saveRequest.fail({ errMsg: "offline" })
    else jest.advanceTimersByTime(20001)
    expect(wx.showToast).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.loading).toBe(false)
    expect(page.data.list[0].adminRemarkDraft).toBe("未保存的跟进草稿")
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledTimes(1)

    page.fetchList()
    respond(wx.cloud.callFunction.mock.calls[1][0], { list: [{ id: "booking_1", adminRemark: "其他管理员的新备注" }] })
    expect(page.data.list[0]).toMatchObject({ adminRemark: "其他管理员的新备注", adminRemarkDraft: "未保存的跟进草稿" })
    expect(wx.cloud.callFunction.mock.calls.filter(([request]) => request.name === "bookingUpdateAdminRemark")).toHaveLength(1)
    page.saveRemark("booking_1", page.data.list[0].adminRemarkDraft)
    expect(wx.cloud.callFunction.mock.calls[2][0].data.expectedAdminRemark).toBe("其他管理员的新备注")
    wx.cloud.callFunction.mock.calls[2][0].success({ result: { ok: true } })
    respond(wx.cloud.callFunction.mock.calls[3][0], { list: [{ id: "booking_1", adminRemark: "未保存的跟进草稿" }] })
    expect(page.data.list[0]).toMatchObject({ adminRemark: "未保存的跟进草稿", adminRemarkDraft: "未保存的跟进草稿" })
  })

  test("备注后台保存成功后更新冲突基线，后续无编辑刷新接受服务端最新备注", () => {
    const page = loadPage({ list: [{ id: "booking_1", adminRemark: "原备注", adminRemarkDraft: "已联系" }] })
    page.saveRemark("booking_1", "已联系")
    global.getCurrentPages = () => [{}]
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true } })
    global.getCurrentPages = () => [page]
    page.onShow()
    respond(wx.cloud.callFunction.mock.calls[1][0], { list: [{ id: "booking_1", adminRemark: "已联系" }] })
    expect(page.data.list[0]).toMatchObject({ adminRemark: "已联系", adminRemarkDraft: "已联系" })
    page.fetchList()
    respond(wx.cloud.callFunction.mock.calls[2][0], { list: [{ id: "booking_1", adminRemark: "后续已完成" }] })
    expect(page.data.list[0].adminRemarkDraft).toBe("后续已完成")
  })

  test("卸载时取消尚未送达的后台写入反馈", () => {
    const page = loadPage()
    page.saveRemark("booking_1", "草稿")
    global.getCurrentPages = () => [{}]
    wx.cloud.callFunction.mock.calls[0][0].fail({ errMsg: "offline" })
    expect(typeof page._bookingMutationDeferredResult).toBe("function")
    page.onUnload()
    expect(page._bookingMutationDeferredResult).toBeNull()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("状态提醒弹窗关闭时已切页则等待返回后刷新", () => {
    const page = loadPage()
    page.fetchList = jest.fn()
    page.updateStatus("booking_1", "contacted")
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, notificationStatus: "failed" } })
    global.getCurrentPages = () => [{}]
    page.setData.mockClear()
    wx.showModal.mock.calls[0][0].complete()
    expect(page.setData).not.toHaveBeenCalled()
    expect(page.fetchList).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.loading).toBe(false)
    expect(page.fetchList).toHaveBeenCalledTimes(1)
  })

  test("写入未完成时返回页面不提前解除忙碌，卸载后迟到结果不写页面", () => {
    const page = loadPage()
    page.fetchList = jest.fn()
    page.updateStatus("booking_1", "contacted")
    page.onShow()
    expect(page.data.loading).toBe(true)
    expect(page.fetchList).not.toHaveBeenCalled()
    page.onUnload()
    page.setData.mockClear()
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, notificationStatus: "failed" } })
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
})
