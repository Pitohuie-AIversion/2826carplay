const fs = require("fs")
const path = require("path")

function createPage() {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  global.getApp = () => ({ globalData: {} })
  global.wx = { showToast: jest.fn(), cloud: { callFunction: jest.fn() } }
  require("../pages/booking-manage-detail/booking-manage-detail")
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => {
    Object.entries(patch).forEach(([key, value]) => {
      const segments = key.split(".")
      let target = page.data
      segments.slice(0, -1).forEach((segment) => { target = target[segment] })
      target[segments[segments.length - 1]] = value
    })
  })
  global.getCurrentPages = () => [page]
  page.data.id = "booking_1"
  page.data.pageAuthorized = true
  return page
}

function loadBooking(page, fields = {}) {
  page.loadDetail()
  wx.cloud.callFunction.mock.calls.at(-1)[0].success({ result: { ok: true, detail: {
    id: page.data.id, status: "contacted", tags: ["老客户"], startDate: "2026-11-01", endDate: "2026-11-10",
    pickupLocation: "机场送车上门", note: "跨城用车", ...fields
  } } })
}

function recommendedClick(page, tag) {
  const wxml = fs.readFileSync(path.resolve(__dirname, "../pages/booking-manage-detail/booking-manage-detail.wxml"), "utf8")
  const button = wxml.match(/<button\b[\s\S]*?<\/button>/g).find((item) => item.includes('class="coordination-recommend-chip"'))
  const handler = button.match(/bindtap="([^"]+)"/)[1]
  const dataset = { tag }
  if (/data-recommended="\{\{true\}\}"/.test(button)) dataset.recommended = true
  return () => page[handler]({ currentTarget: { dataset } })
}

describe("管理员推荐标签与人工标签交互", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  test("添加建议标签成功后，视图移除前已派发的第二次添加点击不会反向删除", () => {
    const page = createPage()
    loadBooking(page)
    const click = recommendedClick(page, "长租意向")
    click()
    const request = wx.cloud.callFunction.mock.calls[1][0]
    expect(request.data).toMatchObject({ id: "booking_1", tags: ["老客户", "长租意向"], expectedValues: { tags: ["老客户"] } })
    request.success({ result: { ok: true, tags: ["老客户", "长租意向"] } })
    // The second native tap was dispatched from the still-rendered add chip.
    click()
    const unintendedWrite = wx.cloud.callFunction.mock.calls[2] && wx.cloud.callFunction.mock.calls[2][0]
    if (unintendedWrite) unintendedWrite.success({ result: { ok: true, tags: unintendedWrite.data.tags } })
    expect(page.data.booking.tags).toEqual(["老客户", "长租意向"])
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(2)
    expect(page.data.recommendedTags).toEqual(["需要送车", "跨城用车"])
    page.onUnload()
  })

  test("多个建议依次添加保留人工标签，旧建议事件幂等而普通标签仍可取消", () => {
    const page = createPage()
    loadBooking(page, { tags: ["老客户", "高意向"] })
    const tags = ["长租意向", "需要送车", "跨城用车"]
    const clicks = tags.map((tag) => recommendedClick(page, tag))
    let saved = ["老客户", "高意向"]
    clicks.forEach((click, index) => {
      click()
      const request = wx.cloud.callFunction.mock.calls.at(-1)[0]
      expect(request.data.expectedValues.tags).toEqual(saved)
      saved = [...saved, tags[index]]
      expect(request.data.tags).toEqual(saved)
      request.success({ result: { ok: true, tags: saved.slice() } })
      clicks.slice(0, index + 1).forEach((previousClick) => previousClick())
      expect(wx.cloud.callFunction).toHaveBeenCalledTimes(index + 2)
    })
    expect(page.data.booking.tags).toEqual(["老客户", "高意向", ...tags])
    expect(page.data.recommendedTags).toEqual([])
    page.handleToggleCustomerTag({ currentTarget: { dataset: { tag: "长租意向" } } })
    const removal = wx.cloud.callFunction.mock.calls.at(-1)[0]
    expect(removal.data.tags).toEqual(["老客户", "高意向", "需要送车", "跨城用车"])
    removal.success({ result: { ok: true, tags: removal.data.tags } })
    expect(page.data.recommendedTags).toEqual(["长租意向"])
    page.onUnload()
  })

  test("单个建议与一键应用交错时只补缺少项，完成后的旧建议点击不撤销一键结果", () => {
    const page = createPage()
    loadBooking(page)
    const longRent = recommendedClick(page, "长租意向")
    const delivery = recommendedClick(page, "需要送车")
    const crossCity = recommendedClick(page, "跨城用车")
    longRent()
    page.handleApplyAllRecommendedTags()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(2)
    wx.cloud.callFunction.mock.calls[1][0].success({ result: { ok: true, tags: ["老客户", "长租意向"] } })
    page.handleApplyAllRecommendedTags()
    const applyAll = wx.cloud.callFunction.mock.calls[2][0]
    expect(applyAll.data).toMatchObject({ tags: ["老客户", "长租意向", "需要送车", "跨城用车"], expectedValues: { tags: ["老客户", "长租意向"] } })
    delivery()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(3)
    applyAll.success({ result: { ok: true, tags: applyAll.data.tags } })
    delivery()
    crossCity()
    longRent()
    page.handleApplyAllRecommendedTags()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(3)
    expect(page.data.booking.tags).toEqual(applyAll.data.tags)
    expect(page.data.booking.tagBaseline).toEqual(applyAll.data.tags)
    expect(page.data.recommendedTags).toEqual([])
    page.onUnload()
  })

  test.each(["network", "conflict", "timeout"])("建议保存 %s 后不假保存，刷新后重试保留其他管理员新增的标签", (outcome) => {
    const page = createPage()
    loadBooking(page)
    const click = recommendedClick(page, "长租意向")
    click()
    const first = wx.cloud.callFunction.mock.calls[1][0]
    if (outcome === "network") first.fail({ errMsg: "offline" })
    else if (outcome === "conflict") first.success({ result: { ok: false, code: "VERSION_CONFLICT", message: "请刷新核对" } })
    else jest.advanceTimersByTime(20000)
    expect(page.data.booking.tags).toEqual(["老客户"])
    expect(page.data.recommendedTags).toEqual(["长租意向", "需要送车", "跨城用车"])
    expect(page.data.coordinationLoading).toBe(false)
    loadBooking(page, { tags: ["老客户", "高意向"] })
    click()
    const retry = wx.cloud.callFunction.mock.calls.at(-1)[0]
    expect(retry.data).toMatchObject({ tags: ["老客户", "高意向", "长租意向"], expectedValues: { tags: ["老客户", "高意向"] } })
    if (outcome === "timeout") {
      first.success({ result: { ok: true, tags: ["老客户", "长租意向"] } })
      expect(page.data.booking.tags).toEqual(["老客户", "高意向"])
      expect(page.data.coordinationLoading).toBe(true)
    }
    retry.success({ result: { ok: true, tags: retry.data.tags } })
    expect(page.data.booking.tags).toEqual(["老客户", "高意向", "长租意向"])
    expect(page.data.coordinationLoading).toBe(false)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("进入另一预约后旧页建议保存回执只暂存，返回交付一次且不污染新页人工标签", () => {
    const page = createPage()
    loadBooking(page)
    page.handleApplyAllRecommendedTags()
    const request = wx.cloud.callFunction.mock.calls[1][0]
    const nextPage = { data: { id: "booking_2", booking: { tags: ["车损敏感"] } } }
    global.getCurrentPages = () => [page, nextPage]
    page.onHide()
    request.success({ result: { ok: true, tags: request.data.tags } })
    expect(page.data.booking.tags).toEqual(["老客户"])
    expect(nextPage.data.booking.tags).toEqual(["车损敏感"])
    expect(wx.showToast).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.booking.tags).toEqual(request.data.tags)
    expect(page.data.recommendedTags).toEqual([])
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(nextPage.data.booking.tags).toEqual(["车损敏感"])
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("预约页卸载后建议保存迟到结果不更新已卸载实例或新预约", () => {
    const page = createPage()
    loadBooking(page)
    page.handleApplyAllRecommendedTags()
    const request = wx.cloud.callFunction.mock.calls[1][0]
    page.onUnload()
    const updates = page.setData.mock.calls.length
    const nextPage = { data: { id: "booking_2", booking: { tags: ["车损敏感"] } } }
    global.getCurrentPages = () => [nextPage]
    request.success({ result: { ok: true, tags: request.data.tags } })
    expect(page.setData).toHaveBeenCalledTimes(updates)
    expect(page.data.booking.tags).toEqual(["老客户"])
    expect(nextPage.data.booking.tags).toEqual(["车损敏感"])
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
})
