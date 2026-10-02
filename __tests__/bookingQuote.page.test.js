const fs = require("fs")
const path = require("path")

function loadPageDefinition(modulePath) {
  jest.resetModules()
  let definition
  global.Page = jest.fn((input) => { definition = input })
  require(modulePath)
  return definition
}

function createPage(definition, overrides) {
  const page = { ...definition, data: { ...definition.data, ...(overrides || {}) } }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  return page
}

describe("Phase 12 报价页面闭环", () => {
  test("报价按当前车辆自定义规则推荐，日历门槛一致且无配置不推荐", () => {
    global.wx = {}
    const page = createPage(loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"))
    page.applyState = (patch) => Object.assign(page.data, patch)
    const booking = { startDate: "2099-08-01", endDate: "2099-08-05", status: "contacted", rentalDiscountTiers: [{ minDays: 5, discountRate: 0.92 }] }
    page.applyBooking(booking)
    expect(page.data.recommendedDiscount).toMatchObject({ minDays: 5, discountRate: 0.92 })
    page.applyBooking({ ...booking, rentalDiscountTiers: [] })
    expect(page.data.recommendedDiscount).toBeNull()
    page.applyBooking({ ...booking, rentalDiscountUnavailable: true })
    expect(page.data.recommendedDiscount).toBeNull()
  })

  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("顾问保存报价草稿时只提交费用明细，由服务端计算合计", () => {
    global.wx = {
      cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true } })) },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"), {
      id: "booking_1",
      booking: { status: "contacted" },
      quoteForm: {
        baseRentalAmount: "1000",
        protectionAmount: "100",
        serviceFeeAmount: "20",
        deliveryFeeAmount: "0",
        otherFeeAmount: "0",
        depositText: "押金说明",
        validUntil: "2099-12-31",
        customerNote: ""
      }
    })
    page.loadDetail = jest.fn()
    page.handleSaveQuoteDraft()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "bookingQuoteManage",
      data: expect.objectContaining({ action: "saveDraft", bookingId: "booking_1" })
    }))
    expect(global.wx.cloud.callFunction.mock.calls[0][0].data).not.toHaveProperty("totalCents")
  })

  test("发送弹窗打开后草稿更新时不发送未经核对的新金额", () => {
    let modal
    global.wx = { showModal: jest.fn((options) => { modal = options }), showToast: jest.fn(), cloud: { callFunction: jest.fn() } }
    const page = createPage(loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"), { id: "booking_1", booking: { latestQuoteVersion: 0 }, quoteDraft: { id: "booking_1__draft", version: 1, revision: 1 } })
    page.handleSendQuote()
    page.data.quoteDraft = { id: "booking_1__draft", version: 1, revision: 2 }
    modal.success({ confirm: true })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "报价已更新，请核对", icon: "none" })
  })

  test("发送超时后复用原请求和草稿基线，迟到响应不改页面", () => {
    jest.useFakeTimers()
    const requests = []
    global.wx = { showModal: jest.fn(({ success }) => success({ confirm: true })), showToast: jest.fn(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    const page = createPage(loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"), { id: "booking_1", booking: { latestQuoteVersion: 2 }, quoteDraft: { id: "booking_1__draft", version: 3, revision: 4 } })
    page.loadDetail = jest.fn()
    page.handleSendQuote()
    jest.advanceTimersByTime(20000)
    page.handleSendQuote()
    expect(requests[1].data).toEqual(requests[0].data)
    expect(requests[1].data).toMatchObject({ expectedQuoteVersion: 2, expectedDraftRevision: 4 })
    requests[0].success({ result: { ok: true } })
    expect(page.loadDetail).not.toHaveBeenCalled()
    requests[1].success({ result: { ok: true, updated: false, notificationStatus: "skipped" } })
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("保存成功先记住新修订，即使后续详情刷新失败也使用最新基线", () => {
    global.wx = { showToast: jest.fn(), cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, quote: { id: "draft", version: 1, revision: 2 } } })) } }
    const page = createPage(loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"), { id: "booking_1", booking: { latestQuoteVersion: 0 }, quoteDraft: { revision: 1 }, quoteForm: {} })
    page.loadDetail = jest.fn()
    page.handleSaveQuoteDraft()
    expect(page.data.quoteDraft.revision).toBe(2)
    expect(page.buildQuotePayload("saveDraft").expectedDraftRevision).toBe(2)
    page.onUnload()
  })

  test("用户确认报价调用专用响应云函数", () => {
    global.wx = {
      cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true } })) },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/booking-detail/booking-detail"), {
      id: "booking_1",
      booking: { status: "quoted" },
      latestQuote: { id: "quote_1" }
    })
    page.loadDetail = jest.fn()
    page.respondToQuote("confirm")

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "bookingQuoteRespond",
      data: { bookingId: "booking_1", quoteId: "quote_1", action: "confirm", adjustmentNote: "" }
    }))
  })

  test("确认弹窗打开后报价版本变化不能确认未核对的新金额", () => {
    let modal
    global.wx = { showModal: jest.fn((options) => { modal = options }), showToast: jest.fn() }
    const page = createPage(loadPageDefinition("../pages/booking-detail/booking-detail"), { id: "booking_1", booking: { status: "quoted" }, latestQuote: { id: "quote_1" } })
    page.respondToQuote = jest.fn()
    page.handleConfirmQuote()
    page.data.latestQuote = { id: "quote_2" }
    modal.success({ confirm: true })
    expect(page.respondToQuote).not.toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "报价已更新，请核对", icon: "none" })
  })

  test("超过47个占用日期时展示顾问安排提示且不启动确认", () => {
    global.wx = { showModal: jest.fn(), showToast: jest.fn() }
    const page = createPage(loadPageDefinition("../pages/booking-detail/booking-detail"), { id: "booking_1" })
    page.applyBooking({ id: "booking_1", status: "quoted", startDate: "2099-08-01", endDate: "2099-09-17" }, { id: "quote_1" })
    page.handleConfirmQuote()
    expect(page.data.bookingOccupancyTooLong).toBe(true)
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "长租请联系顾问", icon: "none" })
    expect(fs.readFileSync(path.join(__dirname, "../pages/booking-detail/booking-detail.wxml"), "utf8")).toContain("含取还车当天")
  })

  test("用户界面说明报价确认保留档期但不代表付款或签约", () => {
    const wxml = fs.readFileSync(path.join(__dirname, "../pages/booking-detail/booking-detail.wxml"), "utf8")
    expect(wxml).toContain("确认报价（尚未付款）")
    expect(wxml).toContain("确认有效报价成功后，将为您保留所选档期")
    expect(wxml).toContain("不代表已经付款或签署合同")
    expect(wxml).toContain("申请调整报价")
  })

  test("长租或多日租期自动推荐阶梯折扣并支持一键应用", () => {
    global.wx = {
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"), {
      id: "booking_long",
      recommendedDiscount: {
        minDays: 7,
        discountRate: 0.9,
        label: "周租专享 9折",
        discountPercent: 10
      },
      quoteForm: {
        baseRentalAmount: "5000"
      }
    })

    page.handleApplyRecommendedDiscount()

    expect(page.data.quoteForm.baseRentalAmount).toBe("4500.00")
    expect(page.data.quoteDirty).toBe(true)
    expect(global.wx.showToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "已应用周租专享 9折"
    }))
  })

  test("基础租金未输入时点击应用推荐折扣友好提示", () => {
    global.wx = {
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/booking-manage-detail/booking-manage-detail"), {
      id: "booking_long",
      recommendedDiscount: {
        minDays: 7,
        discountRate: 0.9,
        label: "周租专享 9折",
        discountPercent: 10
      },
      quoteForm: {
        baseRentalAmount: ""
      }
    })

    page.handleApplyRecommendedDiscount()

    expect(global.wx.showToast).toHaveBeenCalledWith(expect.objectContaining({
      title: "请先输入基础租金"
    }))
  })

  test("管理端报价界面渲染阶梯立减推荐横幅", () => {
    const wxml = fs.readFileSync(path.join(__dirname, "../pages/booking-manage-detail/booking-manage-detail.wxml"), "utf8")
    expect(wxml).toContain("quote-recommend-banner")
    expect(wxml).toContain("阶梯立减")
    expect(wxml).toContain("handleApplyRecommendedDiscount")
  })
})
