describe("booking-detail page lifecycle error paths", () => {
  let page
  let fileSystem

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    fileSystem = {
      writeFile: jest.fn(),
      unlink: jest.fn(({ success }) => { if (success) success() })
    }
    global.wx = {
      env: { USER_DATA_PATH: "wxfile://usr" },
      showToast: jest.fn(),
      getFileSystemManager: jest.fn(() => fileSystem),
      removeStorageSync: jest.fn(),
      cloud: { callFunction: jest.fn() },
      shareFileMessage: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages/booking-detail/booking-detail.js")
    global.getCurrentPages = () => [page]
  })

  afterEach(() => {
    try {
      if (!page._bookingDetailUnloaded) page.onUnload()
      expect(jest.getTimerCount()).toBe(0)
    } finally {
      jest.useRealTimers()
      delete global.wx
      delete global.Page
      delete global.getCurrentPages
    }
  })

  function exportHandover() {
    page.data.booking = { id: "booking_1", vehicleName: "BMW M4" }
    page.data.handovers = { pickup: { id: "handover_1", stage: "pickup", version: 1 } }
    page.handleExportHandoverReport({ currentTarget: { dataset: { stage: "pickup", id: "handover_1" } } })
  }

  test("onUnload disposes helpers and cancels pending work even when dispose throws", () => {
    page._detailLoadTimer = setTimeout(() => {}, 1000)
    page._handoverExportTimer = setTimeout(() => {}, 1000)
    page._perf = { dispose: jest.fn(() => { throw new Error("dispose failed") }) }
    expect(() => page.onUnload()).not.toThrow()
    expect(page._perf.dispose).toHaveBeenCalledTimes(1)
    expect(page._bookingDetailUnloaded).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("finishDetailLoadEffects calls a throwing completion once and clears its timer", () => {
    const done = jest.fn(() => { throw new Error("done failed") })
    page._detailLoadDone = done
    page._detailLoadTimer = setTimeout(() => {}, 1000)
    expect(() => page.finishDetailLoadEffects()).not.toThrow()
    expect(done).toHaveBeenCalledTimes(1)
    expect(page._detailLoadDone).toBeNull()
    expect(jest.getTimerCount()).toBe(0)
    page.finishDetailLoadEffects()
    expect(done).toHaveBeenCalledTimes(1)
  })

  test("loadDetail invokes a throwing done callback without starting a request while editing", () => {
    page.data.editing = true
    const done = jest.fn(() => { throw new Error("done failed") })
    expect(() => page.loadDetail({ done })).not.toThrow()
    expect(done).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(page.data.editing).toBe(true)
  })

  test("a missing booking clears loading even when cached detail removal throws", () => {
    page.data.id = "booking_1"
    wx.removeStorageSync.mockImplementation(() => { throw new Error("storage failed") })
    page.loadDetail()
    const request = wx.cloud.callFunction.mock.calls[0][0]
    expect(() => request.success({ result: { ok: false, code: "NOT_FOUND" } })).not.toThrow()
    expect(wx.removeStorageSync).toHaveBeenCalledWith("booking_detail_booking_1")
    expect(page.data).toMatchObject({ initialLoading: false, loading: false, loadFailed: false })
    expect(wx.showToast).toHaveBeenCalledWith({ title: "预约不存在", icon: "none" })
    expect(jest.getTimerCount()).toBe(0)
  })

  test("a synchronous share error shows feedback through the real page action guard", () => {
    page.data.exportedHandoverPath = "wxfile://usr/test.csv"
    wx.shareFileMessage.mockImplementation(() => { throw new Error("share failed") })
    expect(() => page.handleShareExportedHandover()).not.toThrow()
    expect(wx.shareFileMessage).toHaveBeenCalledWith(expect.objectContaining({ filePath: "wxfile://usr/test.csv" }))
    expect(wx.showToast).toHaveBeenCalledWith({ title: "分享文件失败", icon: "none" })
    wx.showToast.mockClear()
    page.onUnload()
    page.handleShareExportedHandover()
    expect(wx.shareFileMessage).toHaveBeenCalledTimes(1)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("a synchronous file write error unlocks export and clears its timeout", () => {
    fileSystem.writeFile.mockImplementation(() => { throw new Error("write failed") })
    expect(exportHandover).not.toThrow()
    expect(fileSystem.writeFile).toHaveBeenCalledTimes(1)
    expect(page.data.exportingHandover).toBe(false)
    expect(page.data.exportedHandoverPath).toBe("")
    expect(wx.showToast).toHaveBeenCalledWith({ title: "留证单导出失败", icon: "none" })
    expect(jest.getTimerCount()).toBe(0)
  })

  test("an unavailable file system unlocks export without attempting a write", () => {
    wx.getFileSystemManager.mockImplementation(() => { throw new Error("file system failed") })
    expect(exportHandover).not.toThrow()
    expect(wx.getFileSystemManager).toHaveBeenCalledTimes(1)
    expect(fileSystem.writeFile).not.toHaveBeenCalled()
    expect(page.data.exportingHandover).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "系统暂不支持文件导出", icon: "none" })
  })

  test("failure to unlink the old export preserves the newly exported file", () => {
    const oldPath = "wxfile://usr/old.csv"
    page.data.exportedHandoverPath = oldPath
    fileSystem.unlink.mockImplementation(() => { throw new Error("unlink failed") })
    exportHandover()
    const write = fileSystem.writeFile.mock.calls[0][0]
    expect(() => write.success()).not.toThrow()
    expect(fileSystem.unlink).toHaveBeenCalledWith(expect.objectContaining({ filePath: oldPath }))
    expect(page.data.exportedHandoverPath).toBe(write.filePath)
    expect(page.data.exportedHandoverPath).not.toBe(oldPath)
    expect(page.data.exportingHandover).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "留证单已导出", icon: "success" })
    expect(jest.getTimerCount()).toBe(0)
  })
})
