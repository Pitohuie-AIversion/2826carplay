function loadPage(route) {
  let definition
  global.Page = (value) => { definition = value }
  require(`../pages/${route}/${route}`)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".")
      let target = page.data
      for (const part of parts.slice(0, -1)) target = target[part]
      target[parts[parts.length - 1]] = value
    }
  })
  return page
}

function setup(route = "booking") {
  jest.resetModules()
  const requests = []
  const storage = new Map()
  global.getApp = () => ({ globalData: {} })
  global.wx = {
    cloud: { callFunction: jest.fn((request) => { requests.push(request) }) },
    showToast: jest.fn(), showModal: jest.fn(), setNavigationBarTitle: jest.fn(),
    getStorageSync: (key) => storage.get(key), setStorageSync: (key, value) => storage.set(key, value)
  }
  const page = loadPage(route)
  global.getCurrentPages = () => [page]
  if (route === "booking") {
    Object.assign(page.data, { carId: "car_1", carName: "预约车辆", privacyAgreed: true })
    Object.assign(page.data.form, { userName: "联系人", phone: "13800138000", startDate: "2099-08-01", endDate: "2099-08-02", city: "杭州", pickupLocation: "网点A", returnLocation: "网点B", note: "原始备注" })
  } else {
    page.data.id = "b1"
    page.applyBooking({ id: "b1", status: "quoted", city: "杭州", startDate: "2099-08-01", endDate: "2099-08-02" }, { id: "q1", status: "sent", version: 1, totalCents: 123456, baseRentalCents: 120000, serviceFeeCents: 3456, validUntil: "2099-12-31" })
  }
  return { page, requests, storage }
}

describe("预约创建和响应重试保持实际业务结果", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  test("相同内容重新输入和订阅状态改变仍复用失败请求ID", () => {
    const { page, requests } = setup()
    page.handleSubmit()
    requests[0].fail({ errMsg: "response lost" })
    page.handleInput({ currentTarget: { dataset: { field: "note" } }, detail: { value: "  原始备注  " } })
    page.data.bookingStatusTemplateId = "new-template"
    wx.requestSubscribeMessage = jest.fn(({ complete }) => complete({ "new-template": "reject" }))
    page.handleSubmit()
    expect(requests[1].data).toEqual(requests[0].data)
    expect(requests[1].data.requestId).toBe(requests[0].data.requestId)
    requests[1].success({ result: { ok: true, duplicated: true, id: "created_1" } })
    expect(page.data.submitSuccess).toBe(true)
    expect(page.data.submittedBookingId).toBe("created_1")
    page.onUnload()
  })

  test.each(["pickupLocation", "returnLocation", "note", "city"])("自动变化的%s也必须使用新业务快照ID", (field) => {
    const { page, requests } = setup()
    page.handleSubmit()
    requests[0].fail({ errMsg: "response lost" })
    page.data.form[field] = "新内容"
    page.handleSubmit()
    expect(requests[1].data.requestId).not.toBe(requests[0].data.requestId)
    expect(requests[1].data[field]).toBe("新内容")
    requests[1].success({ result: { ok: false, code: "DUPLICATE_BOOKING", message: "相同车辆和日期的预约已提交，请勿重复预约" } })
    expect(page.data.submitSuccess).toBe(false)
    expect(page.data.submitErrorText).toContain("本次修改尚未保存")
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "已有同日期预约", icon: "none" })
    page.onUnload()
  })

  test("订阅弹窗期间归因变化不会替换点击提交时的快照", () => {
    const { page, requests } = setup()
    page.data.attribution = { contentId: "guide_1", channel: "wechat_share", scene: "weekend_trip" }
    let proceed
    page.requestStatusSubscription = (callback) => { proceed = callback }
    page.handleSubmit()
    page.data.attribution = { contentId: "guide_2", channel: "qr", scene: "ev_experience" }
    proceed()
    expect(requests[0].data.attribution).toEqual({ contentId: "guide_1", channel: "wechat_share", scene: "weekend_trip" })
    page.onUnload()
  })

  test("仅来源变化重试复用原请求和归因，不创建第二个业务意向", () => {
    const { page, requests } = setup()
    page.data.attribution = { contentId: "guide_1", channel: "direct", scene: "weekend_trip" }
    page.handleSubmit()
    requests[0].fail({ errMsg: "response lost" })
    page.data.attribution = { contentId: "guide_2", channel: "wechat_share", scene: "ev_experience" }
    page.handleSubmit()
    expect(requests[1].data.requestId).toBe(requests[0].data.requestId)
    expect(requests[1].data.attribution).toEqual(requests[0].data.attribution)
    requests[1].success({ result: { ok: true, duplicated: true, id: "created_1" } })
    expect(page.data.submittedBookingId).toBe("created_1")
    page.onUnload()
  })

  test("创建请求切到后台失败只恢复状态，返回后原内容重试复用ID", () => {
    const { page, requests } = setup()
    page.handleSubmit()
    global.getCurrentPages = () => [page, {}]
    requests[0].fail({ errMsg: "response lost" })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data.isSubmitting).toBe(false)
    global.getCurrentPages = () => [page]
    page.handleSubmit()
    expect(requests[1].data.requestId).toBe(requests[0].data.requestId)
    page.onUnload()
    requests[1].success({ result: { ok: true, id: "late" } })
    expect(page.data.submitSuccess).toBe(false)
  })

  test.each(["confirm", "cancel"])("%s成功后详情刷新失败仍保留真实状态和报价金额", (action) => {
    const { page, requests, storage } = setup("booking-detail")
    if (action === "confirm") page.respondToQuote("confirm")
    else page.cancelBooking("b1")
    requests[0].success({ result: { ok: true, bookingStatus: action === "confirm" ? "confirmed" : undefined } })
    expect(requests[1].name).toBe("bookingMyDetail")
    requests[1].fail({ errMsg: "detail unavailable" })
    expect(page.data.booking.status).toBe(action === "confirm" ? "confirmed" : "cancelled")
    expect(page.data.latestQuote.totalText).toBe("1234.56")
    expect(page.data.latestQuote.baseRentalText).toBe("1200.00")
    expect(page.data.canCancel).toBe(action === "confirm")
    expect(storage.get("booking_detail_b1").booking.status).toBe(page.data.booking.status)
    page.onUnload()
  })

  test("报价缓存重开及详情刷新失败都不把已保存金额改成0", () => {
    const { page, requests, storage } = setup("booking-detail")
    const cached = storage.get("booking_detail_b1")
    expect(cached.latestQuote.totalText).toBe("1234.56")
    // A fresh module gives this second page its own setData receiver.
    jest.resetModules()
    const reopened = loadPage("booking-detail")
    global.getCurrentPages = () => [reopened]
    reopened.onLoad({ id: "b1" })
    reopened.loadDetail()
    requests.find((request) => request.name === "bookingMyDetail").fail({ errMsg: "offline" })
    expect(reopened.data.latestQuote).toMatchObject({ totalText: "1234.56", baseRentalText: "1200.00", serviceFeeText: "34.56" })
    reopened.onUnload()
    page.onUnload()
  })

  test.each(["network", "response"])("预约详情后台%s失败不向前台页面弹提示，返回仍可刷新真实状态", (failure) => {
    const { page, requests } = setup("booking-detail")
    page.loadNotificationConfig = jest.fn()
    page.loadDetail()
    global.getCurrentPages = () => [page, {}]
    if (failure === "network") requests[0].fail({ errMsg: "network unavailable" })
    else requests[0].success({ result: { ok: false, code: "INTERNAL_ERROR", message: "读取失败" } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data.loading).toBe(false)
    expect(page.data.loadFailed).toBe(true)
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(requests).toHaveLength(2)
    requests[1].success({ result: { ok: true, detail: { id: "b1", status: "cancelled" } } })
    expect(page.data.booking.status).toBe("cancelled")
    expect(page.data.canCancel).toBe(false)
    page.onUnload()
  })

  test("报价响应中不能取消，取消弹窗期间不能确认或申请调整", () => {
    const { page, requests } = setup("booking-detail")
    page.respondToQuote("confirm")
    page.handleCancel()
    page.cancelBooking("b1")
    expect(requests).toHaveLength(1)
    expect(wx.showModal).not.toHaveBeenCalled()
    requests[0].fail({ errMsg: "network" })
    page.handleCancel()
    expect(page.data.cancelling).toBe(true)
    page.handleConfirmQuote()
    page.data.adjustmentNote = "调整日期"
    page.handleRequestQuoteAdjustment()
    expect(requests).toHaveLength(1)
    expect(wx.showModal).toHaveBeenCalledTimes(1)
    wx.showModal.mock.calls[0][0].success({ confirm: false })
    page.onUnload()
  })

  test.each(["confirm", "cancel"])("%s后台成功不弹提示，卸载迟到失败不触碰页面", (action) => {
    const { page, requests } = setup("booking-detail")
    if (action === "confirm") page.respondToQuote("confirm")
    else page.cancelBooking("b1")
    global.getCurrentPages = () => [page, {}]
    requests[0].success({ result: { ok: true, bookingStatus: action === "confirm" ? "confirmed" : undefined } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    expect(page.data.booking.status).toBe(action === "confirm" ? "confirmed" : "cancelled")
    page.onUnload()
    requests[0].fail({ errMsg: "late" })
    expect(wx.showToast).not.toHaveBeenCalled()
  })
})
