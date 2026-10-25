describe("favorites comparison poster lifecycle", () => {
  let page
  let currentPages

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    global.wx = {
      showToast: jest.fn(),
      vibrateShort: jest.fn(),
      saveImageToPhotosAlbum: jest.fn(),
      canvasToTempFilePath: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: { ...definition.data } }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages/favorites/favorites")
    page.data.compareCars = [{ id: "a", name: "A" }, { id: "b", name: "B" }]
    currentPages = [page]
    global.getCurrentPages = () => currentPages
  })

  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test("leaving before rendering cancels the timer and returning recovers the pending modal", () => {
    page.renderComparePoster = jest.fn()
    page.handleOpenComparePosterModal()
    page.onHide()
    currentPages = [page, {}]
    jest.advanceTimersByTime(80)
    expect(page.renderComparePoster).not.toHaveBeenCalled()
    currentPages = [page]
    page.onShow()
    expect(page.data.comparePosterVisible).toBe(false)
    expect(page.data.comparePosterGenerating).toBe(false)
    page.handleOpenComparePosterModal()
    jest.advanceTimersByTime(80)
    expect(page.renderComparePoster).toHaveBeenCalledTimes(1)
  })

  function startPosterExport() {
    const context = new Proxy({
      createLinearGradient: () => ({ addColorStop: jest.fn() })
    }, { get: (target, key) => key in target ? target[key] : (target[key] = jest.fn()) })
    const canvas = { getContext: () => context }
    const query = {
      in: () => query,
      select: () => query,
      fields: () => query,
      exec: (callback) => callback([{ node: canvas }])
    }
    wx.createSelectorQuery = () => query
    page.handleOpenComparePosterModal()
    jest.advanceTimersByTime(80)
    return wx.canvasToTempFilePath.mock.calls[0][0]
  }

  test.each(["success", "fail"])("old export %s cannot finish a new poster after leaving and returning", (outcome) => {
    const previousExport = startPosterExport()
    page.onHide()
    currentPages = [page, {}]
    currentPages = [page]
    page.onShow()
    page.handleOpenComparePosterModal()
    page.setData.mockClear()
    previousExport[outcome]({ tempFilePath: "wxfile://old.png" })
    expect(page.setData).not.toHaveBeenCalled()
    expect(page.data.comparePosterGenerating).toBe(true)
    expect(page.data.comparePosterImagePath).toBe("")
  })

  test.each(["success", "fail"])("old save %s cannot affect a reopened poster", async (outcome) => {
    page.setData({ comparePosterVisible: true, comparePosterImagePath: "wxfile://old.png" })
    await page.handleSaveComparePoster()
    const previousSave = wx.saveImageToPhotosAlbum.mock.calls[0][0]
    page.handleCloseComparePosterModal()
    page.handleOpenComparePosterModal()
    wx.vibrateShort.mockClear()
    page.setData.mockClear()
    previousSave[outcome]({ errMsg: "saveImageToPhotosAlbum:fail auth denied" })
    expect(page.data.comparePosterVisible).toBe(true)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.vibrateShort).not.toHaveBeenCalled()
  })

  test("a save callback from before hiding stays invalid after returning", async () => {
    page.setData({ comparePosterVisible: true, comparePosterImagePath: "wxfile://old.png" })
    await page.handleSaveComparePoster()
    const previousSave = wx.saveImageToPhotosAlbum.mock.calls[0][0]
    page.onHide()
    currentPages = [page]
    page.onShow()
    previousSave.success()
    expect(page.data.comparePosterVisible).toBe(true)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("saving the current poster still shows success and closes it", async () => {
    page.setData({ comparePosterVisible: true, comparePosterImagePath: "wxfile://current.png" })
    await page.handleSaveComparePoster()
    wx.saveImageToPhotosAlbum.mock.calls[0][0].success()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "海报已保存相册", icon: "success" })
    expect(page.data.comparePosterVisible).toBe(false)
  })
})
