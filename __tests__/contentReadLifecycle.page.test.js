jest.mock("../shared/analytics", () => ({ trackEvent: jest.fn() }))

function loadPage(route) {
  let definition
  global.Page = (value) => { definition = value }
  jest.isolateModules(() => require(`../${route}`))
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  return page
}

describe("content reads recover from failure without stale page writes", () => {
  let requests
  beforeEach(() => {
    jest.useFakeTimers()
    requests = []
    global.wx = {
      cloud: { callFunction: jest.fn((request) => requests.push(request)) },
      getStorageSync: jest.fn(), setStorageSync: jest.fn(), removeStorageSync: jest.fn(),
      setNavigationBarTitle: jest.fn()
    }
  })
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); delete global.wx; delete global.Page; delete global.getCurrentPages })

  const guideResult = (id) => ({ result: { ok: true, guide: { id, slug: id, title: id, summary: "概要", body: "正文", scenario: "business" }, vehicles: [{ id: "car", status: "idle" }] } })

  test("a background guide response cannot replace the foreground page title", () => {
    const page = loadPage("pages/content-page/content-page")
    page.loadGuide("guide-a")
    global.getCurrentPages = () => [page, { route: "pages/car-detail/car-detail" }]
    requests[0].success(guideResult("guide-a"))
    expect(page.data.guide.title).toBe("guide-a")
    expect(wx.setNavigationBarTitle).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({ title: "guide-a" })
    page.onUnload()
  })

  test("a request without callbacks times out and retry ignores the late response", () => {
    const page = loadPage("pages/content-page/content-page")
    page.data.attribution.contentId = "guide-a"
    page.loadGuide("guide-a")
    expect(page.data.guideLoading).toBe(true)
    jest.advanceTimersByTime(15000)
    expect(page.data.guideLoading).toBe(false)
    expect(page.data.guideError).toBeTruthy()
    page.handleGuideRetry()
    requests[0].success(guideResult("old"))
    expect(page.data.guide).toBeNull()
    requests[1].success(guideResult("guide-a"))
    expect(page.data.guide.title).toBe("guide-a")
    expect(page.data.relatedVehicles[0].statusText).toBe("可预约")
    expect(jest.getTimerCount()).toBe(0)
    page.onUnload()
  })

  test("an unpublished guide is removed from cached display and linked actions", () => {
    wx.getStorageSync.mockReturnValue({ guide: guideResult("guide-a").result.guide, vehicles: [{ id: "car" }] })
    const page = loadPage("pages/content-page/content-page")
    page.loadGuide("guide-a")
    expect(page.data.guide).not.toBeNull()
    requests[0].success({ result: { ok: false, code: "NOT_FOUND" } })
    expect(page.data.guide).toBeNull()
    expect(page.data.relatedVehicles).toEqual([])
    expect(page.data.content).toBe("")
    expect(page.data.guideError).toContain("下线")
    expect(wx.removeStorageSync).toHaveBeenCalledWith("guide_guide-a")
    page.onUnload()
  })

  test("a transient failure retains cached content with an explicit stale notice", () => {
    wx.getStorageSync.mockReturnValue({ guide: guideResult("guide-a").result.guide })
    const page = loadPage("pages/content-page/content-page")
    page.loadGuide("guide-a")
    requests[0].fail({ errMsg: "network" })
    expect(page.data.guide.title).toBe("guide-a")
    expect(page.data.guideLoading).toBe(false)
    expect(page.data.guideNotice).toContain("上次保存")
    page.onUnload()
  })

  test("replacement and unload cancel both view changes and cache writes", () => {
    const page = loadPage("pages/content-page/content-page")
    page.loadGuide("guide-a")
    page.loadGuide("guide-b")
    requests[1].success(guideResult("guide-b"))
    requests[0].success(guideResult("guide-a"))
    expect(page.data.guide.title).toBe("guide-b")
    page.loadGuide("guide-c")
    page.onUnload()
    page.setData.mockClear()
    wx.setStorageSync.mockClear()
    requests[2].success(guideResult("guide-c"))
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.setStorageSync).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each([
    ["pages/garage/garage", "loadContentGuides", "contentGuides"],
    ["pages/car-detail/car-detail", "loadRelatedGuides", "relatedGuides"]
  ])("%s recommendations reject superseded and unloaded responses", (route, method, field) => {
    const page = loadPage(route)
    page[method]("vehicle-a")
    page[method]("vehicle-b")
    requests[1].success({ result: { ok: true, list: [{ id: "new" }] } })
    requests[0].success({ result: { ok: true, list: [{ id: "old" }] } })
    expect(page.data[field]).toEqual([{ id: "new" }])
    page[method]("vehicle-c")
    page.onUnload()
    page.setData.mockClear()
    requests[2].success({ result: { ok: true, list: [{ id: "unloaded" }] } })
    expect(page.setData).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
})
