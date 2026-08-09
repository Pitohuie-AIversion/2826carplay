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

  test("用户界面明确说明确认不等于付款或锁车", () => {
    const wxml = fs.readFileSync(path.join(__dirname, "../pages/booking-detail/booking-detail.wxml"), "utf8")
    expect(wxml).toContain("确认报价（尚未付款）")
    expect(wxml).toContain("不代表已经付款、签署合同或锁定车辆")
    expect(wxml).toContain("申请调整报价")
  })
})
