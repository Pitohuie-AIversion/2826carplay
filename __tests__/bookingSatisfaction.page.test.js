const fs = require("fs")
const path = require("path")

function createPage() {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  require("../pages/booking-detail/booking-detail")
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  page.data.id = "review-booking"
  page.data.booking = { id: "review-booking", status: "completed" }
  return page
}

describe("预约体验评价", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    global.wx = { setStorageSync: jest.fn(), getStorageSync: jest.fn(), showToast: jest.fn() }
  })

  afterEach(() => {
    jest.useRealTimers()
    delete global.wx
    delete global.Page
    delete global.getCurrentPages
  })

  test("标签的默认、切换及缓存恢复选择态可直接供 WXML 渲染", () => {
    const page = createPage()
    const selectedLabels = () => page.data.satisfactionTags.filter((tag) => tag.selected).map((tag) => tag.label)
    expect(selectedLabels()).toEqual(["车况极佳", "体验尊享"])

    page.handleSatisfactionTagTap({ currentTarget: { dataset: { tag: "车况极佳" } } })
    page.handleSatisfactionTagTap({ currentTarget: { dataset: { tag: "准时交付" } } })
    expect(selectedLabels()).toEqual(["准时交付", "体验尊享"])
    expect(page.data.selectedSatisfactionTags).toEqual(["体验尊享", "准时交付"])

    wx.getStorageSync.mockReturnValue({ rating: 4, tags: ["管家专业"], note: "服务很好" })
    page.applyBooking(page.data.booking)
    expect(selectedLabels()).toEqual(["管家专业"])
    expect(page.data.reviewSubmitted).toBe(true)

    const wxml = fs.readFileSync(path.resolve(__dirname, "../pages/booking-detail/booking-detail.wxml"), "utf8")
    expect(wxml).toContain("item.selected ? 'satisfaction-tag-active'")
    expect(wxml).toContain('data-tag="{{item.label}}"')
    expect(wxml).not.toContain(".includes(")
  })

  test("本地保存完成后立即确认且不会留下切页后弹提示的定时器", () => {
    const page = createPage()
    let stack = [page]
    global.getCurrentPages = () => stack
    page.handleSatisfactionNoteInput({ detail: { value: "服务很好" } })
    page.handleSubmitSatisfactionReview()

    expect(wx.setStorageSync).toHaveBeenCalledWith("booking_review_review-booking", expect.objectContaining({
      rating: 5, tags: ["车况极佳", "体验尊享"], note: "服务很好"
    }))
    expect(page.data.reviewSubmitted).toBe(true)
    expect(page.data.reviewSubmitting).toBe(false)
    expect(jest.getTimerCount()).toBe(0)

    page.handleSubmitSatisfactionReview()
    expect(wx.setStorageSync).toHaveBeenCalledTimes(1)
    stack = [page, { route: "pages/mine/mine" }]
    wx.showToast.mockClear()
    page.setData.mockClear()
    jest.runOnlyPendingTimers()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.setData).not.toHaveBeenCalled()
  })

  test("存储失败保留草稿并允许重试，不能显示已评价", () => {
    const page = createPage()
    page.handleSatisfactionNoteInput({ detail: { value: "请保留草稿" } })
    wx.setStorageSync.mockImplementationOnce(() => { throw new Error("storage full") })
    page.handleSubmitSatisfactionReview()
    jest.runOnlyPendingTimers()

    expect(page.data.reviewSubmitted).toBe(false)
    expect(page.data.reviewSubmitting).toBe(false)
    expect(page.data.satisfactionNote).toBe("请保留草稿")
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "评价保存失败，请重试", icon: "none" })

    page.handleSubmitSatisfactionReview()
    expect(page.data.reviewSubmitted).toBe(true)
    expect(wx.setStorageSync).toHaveBeenCalledTimes(2)
  })

  test.each(["applyBooking", "onShow", "onPullDownRefresh"])("保存失败后 %s 刷新同一预约保留评分、标签和备注", (refreshMethod) => {
    const page = createPage()
    const booking = page.data.booking
    page.handleRatingTap({ currentTarget: { dataset: { rating: 2 } } })
    page.handleSatisfactionTagTap({ currentTarget: { dataset: { tag: "管家专业" } } })
    page.handleSatisfactionNoteInput({ detail: { value: "需要保留的未提交评价" } })
    wx.setStorageSync.mockImplementationOnce(() => { throw new Error("storage full") })
    page.handleSubmitSatisfactionReview()
    expect(page.data.reviewSubmitted).toBe(false)

    page.loadNotificationConfig = jest.fn()
    wx.stopPullDownRefresh = jest.fn()
    page.loadDetail = jest.fn((options) => {
      page.applyBooking({ ...booking })
      if (options && options.done) options.done()
    })
    if (refreshMethod === "applyBooking") page.applyBooking({ ...booking })
    else {
      page[refreshMethod]()
      expect(page.loadDetail).toHaveBeenCalledTimes(1)
    }

    expect(page.data.satisfactionRating).toBe(2)
    expect(page.data.satisfactionNote).toBe("需要保留的未提交评价")
    expect(page.data.selectedSatisfactionTags).toEqual(["车况极佳", "体验尊享", "管家专业"])
    expect(page.data.satisfactionTags.find((tag) => tag.label === "管家专业").selected).toBe(true)
    expect(page.data.reviewSubmitted).toBe(false)
    page.handleSubmitSatisfactionReview()
    expect(wx.setStorageSync).toHaveBeenLastCalledWith("booking_review_review-booking", expect.objectContaining({
      rating: 2, tags: ["车况极佳", "体验尊享", "管家专业"], note: "需要保留的未提交评价"
    }))
    expect(page.data.reviewSubmitted).toBe(true)
  })

  test("切换预约清除上一预约未提交的评价，首次加载仍恢复存储", () => {
    const page = createPage()
    page.handleRatingTap({ currentTarget: { dataset: { rating: 1 } } })
    page.handleSatisfactionTagTap({ currentTarget: { dataset: { tag: "管家专业" } } })
    page.handleSatisfactionNoteInput({ detail: { value: "原预约草稿" } })
    page.data.id = "another-booking"
    page.applyBooking({ id: "another-booking", status: "completed" })
    expect(page.data.satisfactionRating).toBe(5)
    expect(page.data.satisfactionNote).toBe("")
    expect(page.data.selectedSatisfactionTags).toEqual(["车况极佳", "体验尊享"])
    expect(page.data.reviewSubmitted).toBe(false)

    wx.getStorageSync.mockReturnValue({ rating: 3, tags: ["准时交付"], note: "此前保存的评价" })
    const freshPage = createPage()
    freshPage.applyBooking(freshPage.data.booking)
    expect(freshPage.data.satisfactionRating).toBe(3)
    expect(freshPage.data.selectedSatisfactionTags).toEqual(["准时交付"])
    expect(freshPage.data.satisfactionNote).toBe("此前保存的评价")
    expect(freshPage.data.reviewSubmitted).toBe(true)
  })

  test("刷新发现已保存评价时优先采用已保存结果，清除当前未提交草稿", () => {
    const page = createPage()
    page.handleRatingTap({ currentTarget: { dataset: { rating: 1 } } })
    page.handleSatisfactionNoteInput({ detail: { value: "旧草稿" } })
    wx.getStorageSync.mockReturnValue({ rating: 4, tags: ["管家专业"], note: "另一页面已保存" })
    page.applyBooking({ ...page.data.booking })
    expect(page.data.satisfactionRating).toBe(4)
    expect(page.data.selectedSatisfactionTags).toEqual(["管家专业"])
    expect(page.data.satisfactionNote).toBe("另一页面已保存")
    expect(page.data.reviewSubmitted).toBe(true)
  })

  test("缺少存储能力时仍允许重试", () => {
    const page = createPage()
    delete wx.setStorageSync
    page.handleSubmitSatisfactionReview()
    expect(page.data.reviewSubmitted).toBe(false)
    expect(page.data.reviewSubmitting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "评价保存失败，请重试", icon: "none" })
  })

  test.each(["background", "unloaded"])("页面 %s 时不再接受评价提交", (state) => {
    const page = createPage()
    global.getCurrentPages = () => state === "background" ? [page, {}] : [page]
    if (state === "unloaded") page.onUnload()
    page.setData.mockClear()
    page.handleSubmitSatisfactionReview()
    expect(wx.setStorageSync).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.setData).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
})
