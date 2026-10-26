describe("customer booking responses across native callbacks and page returns", () => {
  let page
  let stack
  let requests
  let modals
  const booking = { id: "booking_1", status: "quoted", city: "杭州", userName: "张三", phone: "13800000000", note: "", startDate: "2099-08-01", endDate: "2099-08-02" }
  const quote = { id: "quote_1", status: "sent", version: 1, totalCents: 123400 }

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    modals = []
    global.wx = {
      cloud: { callFunction: jest.fn((options) => requests.push(options)) },
      showModal: jest.fn((options) => modals.push(options)),
      showToast: jest.fn(),
      setStorageSync: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => {
        for (const [key, value] of Object.entries(patch)) {
          if (key.startsWith("editForm.")) page.data.editForm[key.slice(9)] = value
          else page.data[key] = value
        }
      })
    }
    require("../pages/booking-detail/booking-detail")
    stack = [page]
    global.getCurrentPages = () => stack
    page.data.id = booking.id
    page.loadNotificationConfig = jest.fn()
    page.applyBooking({ ...booking }, { ...quote })
  })

  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test.each(["cancel", "network", "timeout", "background", "native failure"])("old quote confirmation cannot submit again after %s", (end) => {
    page.handleConfirmQuote()
    if (end === "background") stack = [page, {}]
    if (end === "native failure") modals[0].fail(new Error("modal unavailable"))
    else modals[0].success({ confirm: end !== "cancel" })
    stack = [page]
    if (end === "network") requests[0].fail(new Error("响应丢失"))
    if (end === "timeout") jest.advanceTimersByTime(12000)
    const requestCount = requests.length
    page.handleAdjustmentInput({ detail: { value: "我想先调整费用" } })
    wx.showToast.mockClear()
    modals[0].success({ confirm: true })
    expect(requests).toHaveLength(requestCount)
    expect(page.data.quoteResponding).toBe(false)
    expect(page.data.adjustmentNote).toBe("我想先调整费用")
    expect(wx.showToast).not.toHaveBeenCalled()

    page.handleConfirmQuote()
    modals[1].success({ confirm: true })
    expect(requests).toHaveLength(requestCount + 1)
  })

  test("a synchronously failed quote dialog does not submit and a fresh dialog can retry", () => {
    wx.showModal.mockImplementationOnce((options) => {
      modals.push(options)
      throw new Error("modal unavailable")
    })
    expect(() => page.handleConfirmQuote()).not.toThrow()
    modals[0].success({ confirm: true })
    expect(requests).toHaveLength(0)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "确认未打开，请重试", icon: "none" })
    page.handleConfirmQuote()
    modals[1].success({ confirm: true })
    expect(requests).toHaveLength(1)
  })

  test.each(["network", "business", "timeout"])("background quote %s failure is delivered once on return without changing the draft", (failure) => {
    page.handleAdjustmentInput({ detail: { value: "希望调整服务费" } })
    page.handleRequestQuoteAdjustment()
    stack = [page, {}]
    if (failure === "network") requests[0].fail(new Error("网络中断"))
    else if (failure === "timeout") jest.advanceTimersByTime(12000)
    else requests[0].success({ result: { ok: false, code: "INTERNAL_ERROR", message: "申请暂未保存" } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data.adjustmentNote).toBe("希望调整服务费")

    stack = [page]
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: failure === "network" ? "网络中断" : failure === "timeout" ? "报价操作超时，请重试" : "申请暂未保存",
      icon: "none"
    })
    expect(requests[1].name).toBe("bookingMyDetail")
    requests[1].success({ result: { ok: true, detail: { ...booking }, latestQuote: { ...quote } } })
    expect(page.data.adjustmentNote).toBe("希望调整服务费")
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("a contact status rejection in the background is explained on return before detail refresh", () => {
    page.applyBooking({ ...booking, status: "pending" })
    page.handleStartEdit()
    page.handleEditInput({ currentTarget: { dataset: { field: "phone" } }, detail: { value: "13900000000" } })
    page.handleSaveEdit()
    stack = [page, {}]
    requests[0].success({ result: { ok: false, code: "STATUS_CONFLICT", message: "状态已变，请核对" } })
    expect(wx.showToast).not.toHaveBeenCalled()

    stack = [page]
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "状态已变，请核对", icon: "none" })
    expect(requests[1].name).toBe("bookingMyDetail")
    requests[1].success({ result: { ok: true, detail: { ...booking }, latestQuote: { ...quote } } })
    expect(page.data.booking.phone).toBe("13800000000")
    expect(page.data.editing).toBe(false)
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test.each(["booking", "quote", "version", "retry", "unload"])("deferred quote failure cannot leak across %s", (change) => {
    page.handleAdjustmentInput({ detail: { value: "希望调整服务费" } })
    page.handleRequestQuoteAdjustment()
    stack = [page, {}]
    requests[0].fail(new Error("旧请求失败"))
    if (change === "unload") {
      page.onUnload()
      requests[0].fail(new Error("迟到失败"))
      expect(page._pendingDetailMutationFeedback).toBeNull()
    } else {
      if (change === "booking") {
        page.data.id = "booking_2"
        page.applyBooking({ ...booking, id: "booking_2" }, { ...quote })
      }
      if (change === "quote") page.applyBooking({ ...booking }, { ...quote, id: "quote_2" })
      if (change === "version") page.applyBooking({ ...booking }, { ...quote, version: 2 })
      stack = [page]
      if (change === "retry") page.handleRequestQuoteAdjustment()
      page.onShow()
    }
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("deferred contact rejection is discarded when a different booking is shown", () => {
    page.applyBooking({ ...booking, status: "pending" })
    page.handleStartEdit()
    page.handleSaveEdit()
    stack = [page, {}]
    requests[0].success({ result: { ok: false, code: "STATUS_NOT_ALLOWED", message: "状态已变，请核对" } })
    page.data.id = "booking_2"
    page.applyBooking({ ...booking, id: "booking_2" }, { ...quote, id: "quote_2" })
    stack = [page]
    page.onShow()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(requests[1].data.id).toBe("booking_2")
  })
})
