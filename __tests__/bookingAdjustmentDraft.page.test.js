function setup() {
  jest.resetModules()
  let definition
  const requests = []
  const storage = new Map()
  global.Page = (value) => { definition = value }
  global.getApp = () => ({ globalData: {} })
  global.wx = {
    cloud: { callFunction: jest.fn((request) => requests.push(request)) },
    showToast: jest.fn(),
    stopPullDownRefresh: jest.fn(),
    getStorageSync: (key) => storage.get(key),
    setStorageSync: jest.fn((key, value) => storage.set(key, value))
  }
  require("../pages/booking-detail/booking-detail")
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  page.data.id = "booking_1"
  page.loadNotificationConfig = jest.fn()
  global.getCurrentPages = () => [page]
  const booking = { id: "booking_1", status: "quoted", city: "杭州", startDate: "2099-08-01", endDate: "2099-08-02" }
  const quote = { id: "quote_1", status: "sent", version: 1, totalCents: 123400, validUntil: "2099-12-31" }
  page.applyBooking({ ...booking }, { ...quote })
  return { page, requests, storage, booking, quote }
}

function input(page, value) {
  page.handleAdjustmentInput({ detail: { value } })
}

describe("客户报价调整草稿与真实提交结果", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  test.each(["return", "refresh"])("%s 读取同一报价保留未提交调整说明，缓存不混入草稿", (trigger) => {
    const { page, requests, storage, booking, quote } = setup()
    input(page, "希望取消取送车服务")
    if (trigger === "return") {
      global.getCurrentPages = () => [page, {}]
      global.getCurrentPages = () => [page]
      page.onShow()
    } else page.onPullDownRefresh()
    expect(requests).toHaveLength(1)
    requests[0].success({ result: { ok: true, detail: { ...booking }, latestQuote: { ...quote } } })
    expect(page.data.adjustmentNote).toBe("希望取消取送车服务")
    expect(page.data.latestQuote.adjustmentNote).toBe("")
    expect(storage.get("booking_detail_booking_1").latestQuote.adjustmentNote).toBe("")
    expect(page.data.loading).toBe(false)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("后台同报价刷新迟到成功仍保留已写草稿", () => {
    const { page, requests, booking, quote } = setup()
    input(page, "希望调整服务费")
    page.loadDetail()
    global.getCurrentPages = () => [page, {}]
    requests[0].success({ result: { ok: true, detail: { ...booking }, latestQuote: { ...quote } } })
    expect(page.data.adjustmentNote).toBe("希望调整服务费")
    expect(wx.showToast).not.toHaveBeenCalled()
    page.onUnload()
  })

  test.each(["booking", "quote", "version", "confirmed", "expired", "missing"])("%s 变化后不把旧调整说明套用到新状态", (change) => {
    const { page, booking, quote } = setup()
    input(page, "旧方案的调整说明")
    const nextBooking = { ...booking }
    const nextQuote = { ...quote }
    if (change === "booking") { nextBooking.id = "booking_2"; page.data.id = "booking_2" }
    if (change === "quote") nextQuote.id = "quote_2"
    if (change === "version") nextQuote.version = 2
    if (change === "confirmed") { nextBooking.status = "confirmed"; nextQuote.status = "confirmed" }
    if (change === "expired") { nextBooking.status = "contacted"; nextQuote.status = "expired" }
    page.applyBooking(nextBooking, change === "missing" ? null : nextQuote)
    expect(page.data.adjustmentNote).toBe("")
    expect(page._adjustmentDraftQuoteKey).toBe("")
    page.onUnload()
  })

  test("同报价已有服务端调整申请时展示已保存内容，不能继续显示本地草稿", () => {
    const { page, booking, quote, storage } = setup()
    input(page, "还未保存的 B")
    page.applyBooking({ ...booking, status: "adjustment_requested" }, {
      ...quote, status: "adjustment_requested", adjustmentNote: "已经提交的 A"
    })
    expect(page.data.adjustmentNote).toBe("已经提交的 A")
    expect(storage.get("booking_detail_booking_1").latestQuote.adjustmentNote).toBe("已经提交的 A")
    expect(page._adjustmentDraftQuoteKey).toBe("")
    page.onUnload()
  })

  test("调整申请正文冲突保留 B 为草稿，既不误报成功也不覆盖缓存中的报价", () => {
    const { page, requests, storage, booking, quote } = setup()
    input(page, "原申请 A")
    page.handleRequestQuoteAdjustment()
    requests[0].fail({ errMsg: "响应丢失" })
    input(page, "新申请 B")
    page.handleRequestQuoteAdjustment()
    wx.showToast.mockClear()
    wx.setStorageSync.mockClear()
    requests[1].success({ result: {
      ok: false, code: "VERSION_CONFLICT", message: "调整申请已提交不同内容，请查看最新申请后再操作"
    } })
    expect(requests).toHaveLength(2)
    expect(page.data.quoteResponding).toBe(false)
    expect(page.data.adjustmentNote).toBe("新申请 B")
    expect(page.data.booking.status).toBe("quoted")
    expect(wx.showToast).toHaveBeenCalledWith({ title: "申请已更新，请核对", icon: "none" })
    expect(wx.setStorageSync).not.toHaveBeenCalled()
    expect(storage.get("booking_detail_booking_1").latestQuote.adjustmentNote).toBe("")
    page.loadDetail()
    requests[2].success({ result: {
      ok: true, detail: { ...booking, status: "adjustment_requested" },
      latestQuote: { ...quote, status: "adjustment_requested", adjustmentNote: "原申请 A" }
    } })
    expect(page.data.adjustmentNote).toBe("原申请 A")
    expect(page.data.latestQuote.adjustmentNote).toBe("原申请 A")
    page.onUnload()
  })

  test.each([true, false])("调整申请成功 updated=%s 使用服务端真实正文，后续读取失败也不伪造记录", (updated) => {
    const { page, requests, storage } = setup()
    input(page, "客户端提交内容")
    page.handleRequestQuoteAdjustment()
    requests[0].success({ result: {
      ok: true, updated, bookingStatus: "adjustment_requested", adjustmentNote: "服务端实际已保存内容"
    } })
    expect(requests[1].name).toBe("bookingMyDetail")
    requests[1].fail({ errMsg: "详情暂不可用" })
    expect(page.data.booking.status).toBe("adjustment_requested")
    expect(page.data.adjustmentNote).toBe("服务端实际已保存内容")
    expect(page.data.latestQuote.adjustmentNote).toBe("服务端实际已保存内容")
    expect(storage.get("booking_detail_booking_1").latestQuote.adjustmentNote).toBe("服务端实际已保存内容")
    page.onUnload()
  })

  test("后台收到正文冲突后返回先保留草稿并提示，主动刷新才展示已提交申请", () => {
    const { page, requests, booking, quote } = setup()
    input(page, "新申请 B")
    page.handleRequestQuoteAdjustment()
    global.getCurrentPages = () => [page, {}]
    requests[0].success({ result: { ok: false, code: "VERSION_CONFLICT" } })
    expect(wx.showToast).not.toHaveBeenCalled()
    page.onShow()
    expect(requests).toHaveLength(1)
    expect(wx.showToast).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.adjustmentNote).toBe("新申请 B")
    expect(requests).toHaveLength(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "申请已更新，请核对", icon: "none" })
    page.onPullDownRefresh()
    requests[1].success({ result: {
      ok: true, detail: { ...booking, status: "adjustment_requested" },
      latestQuote: { ...quote, status: "adjustment_requested", adjustmentNote: "原申请 A" }
    } })
    expect(page.data.adjustmentNote).toBe("原申请 A")
    page.onUnload()
  })

  test("后台冲突提示不会带到另一预约或已卸载页面", () => {
    const { page, requests, booking, quote } = setup()
    input(page, "待提交说明")
    page.handleRequestQuoteAdjustment()
    global.getCurrentPages = () => [page, {}]
    requests[0].success({ result: { ok: false, code: "VERSION_CONFLICT" } })
    page.data.id = "booking_2"
    page.applyBooking({ ...booking, id: "booking_2" }, { ...quote, id: "quote_2" })
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(requests[1].data.id).toBe("booking_2")
    page.onUnload()
    expect(page._quoteResponseConflictPending).toBe("")
    requests[0].success({ result: { ok: false, code: "VERSION_CONFLICT" } })
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("旧云函数成功响应未携带正文时仍使用本次提交快照", () => {
    const { page, requests } = setup()
    input(page, "  希望取消取送车服务  ")
    page.handleRequestQuoteAdjustment()
    requests[0].success({ result: { ok: true, bookingStatus: "adjustment_requested" } })
    expect(page.data.adjustmentNote).toBe("希望取消取送车服务")
    page.onUnload()
  })

  test("后台申请成功按实际正文回填，回前台刷新仍保留服务端事实", () => {
    const { page, requests, booking, quote } = setup()
    input(page, "待提交内容")
    page.handleRequestQuoteAdjustment()
    global.getCurrentPages = () => [page, {}]
    requests[0].success({ result: { ok: true, bookingStatus: "adjustment_requested", adjustmentNote: "已保存内容" } })
    expect(page.data.adjustmentNote).toBe("已保存内容")
    expect(wx.showToast).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    requests[1].success({ result: {
      ok: true, detail: { ...booking, status: "adjustment_requested" },
      latestQuote: { ...quote, status: "adjustment_requested", adjustmentNote: "已保存内容" }
    } })
    expect(page.data.adjustmentNote).toBe("已保存内容")
    page.onUnload()
  })
})
