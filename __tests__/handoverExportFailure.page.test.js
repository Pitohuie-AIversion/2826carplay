const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve() }

describe.each([["booking-detail", 15000], ["booking-manage-detail", 20000]])("%s export file failures", (name, timeout) => {
  let page, pages, files, writes, fileSystem
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    files = new Map()
    writes = []
    fileSystem = {
      writeFile: jest.fn((options) => writes.push(options)),
      unlink: jest.fn(({ filePath, success }) => { files.delete(filePath); if (success) success() })
    }
    global.wx = {
      env: { USER_DATA_PATH: "/data" },
      getFileSystemManager: () => fileSystem,
      showToast: jest.fn(),
      shareFileMessage: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
      page.applyState = (patch) => page.setData(patch)
    }
    require(`../pages/${name}/${name}`)
    pages = [page]
    global.getCurrentPages = () => pages
    page.loadDetail = jest.fn()
    page.loadNotificationConfig = jest.fn()
    const handover = { id: "handover_1", stage: "pickup", mileageKm: 15, damageNote: "已记录" }
    Object.assign(page.data, {
      booking: { id: "booking_1" }, handoverList: [handover], handoverHistory: [handover]
    })
  })
  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  function completeWrite(index) {
    const write = writes[index]
    files.set(write.filePath, write.data)
    write.success()
  }

  test.each(["callback", "throw", "timeout", "background", "unload"])("%s write failure removes its partial file and retains the published export", async (failure) => {
    page.handleExportHandoverReport()
    completeWrite(0)
    const previousPath = page.data.exportedHandoverPath
    wx.showToast.mockClear()
    if (failure === "throw") {
      fileSystem.writeFile.mockImplementationOnce((options) => {
        writes.push(options)
        files.set(options.filePath, "partial personal data")
        throw new Error("native write failed")
      })
    }
    page.handleExportHandoverReport()
    const failedPath = writes[1].filePath
    if (failure !== "throw") {
      files.set(failedPath, "partial personal data")
      if (failure === "background") { page.onHide(); pages = [page, {}] }
      if (failure === "unload") page.onUnload()
      if (failure === "timeout") jest.advanceTimersByTime(timeout)
      else writes[1].fail(new Error("storage unavailable"))
    }
    await flush()
    expect(files.has(failedPath)).toBe(false)
    expect(files.get(previousPath)).toBe(writes[0].data)
    expect(page.data.exportedHandoverPath).toBe(previousPath)
    if (failure === "background" || failure === "unload") expect(wx.showToast).not.toHaveBeenCalled()
    else expect(wx.showToast).toHaveBeenCalledWith({ title: "留证单导出失败", icon: "none" })
    if (failure === "background") { pages = [page]; page.onShow(); expect(page.data.exportingHandover).toBe(false) }
  })

  test("a late write cleanup exception never escapes the native callback", async () => {
    page.handleExportHandoverReport()
    jest.advanceTimersByTime(timeout)
    fileSystem.unlink.mockImplementationOnce(() => { throw new Error("cleanup bridge unavailable") })
    expect(() => completeWrite(0)).not.toThrow()
    await flush()
    expect(page.data.exportedHandoverPath).toBe("")
  })

  test("a native failure after timeout cleans newly written partial data without touching the successful retry", async () => {
    page.handleExportHandoverReport()
    jest.advanceTimersByTime(timeout)
    page.handleExportHandoverReport()
    completeWrite(1)
    const publishedPath = page.data.exportedHandoverPath
    files.set(writes[0].filePath, "late partial personal data")
    wx.showToast.mockClear()
    writes[0].fail(new Error("late storage failure"))
    await flush()
    expect(files.has(writes[0].filePath)).toBe(false)
    expect(files.get(publishedPath)).toBe(writes[1].data)
    expect(page.data.exportedHandoverPath).toBe(publishedPath)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("a failure callback after successful delivery cannot delete the published file", async () => {
    page.handleExportHandoverReport()
    completeWrite(0)
    const publishedPath = page.data.exportedHandoverPath
    wx.showToast.mockClear()
    writes[0].fail(new Error("duplicate failure"))
    await flush()
    expect(files.get(publishedPath)).toBe(writes[0].data)
    expect(fileSystem.unlink).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test.each(["throw", "callback"])("native share %s becomes one failure message and leaves the export available", (failure) => {
    page.data.exportedHandoverPath = "/data/report.csv"
    if (failure === "throw") wx.shareFileMessage.mockImplementationOnce(() => { throw new Error("native share unavailable") })
    expect(() => page.handleShareExportedHandover()).not.toThrow()
    const options = wx.shareFileMessage.mock.calls[0][0]
    options.fail({ errMsg: "shareFileMessage:fail unavailable" })
    options.fail({ errMsg: "shareFileMessage:fail unavailable" })
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "分享文件失败", icon: "none" })
    expect(page.data.exportedHandoverPath).toBe("/data/report.csv")
  })

  test.each(["success", "replacement", "unload", "cancel"])("%s prevents stale share failure feedback", (state) => {
    page.data.exportedHandoverPath = "/data/report.csv"
    page.handleShareExportedHandover()
    const options = wx.shareFileMessage.mock.calls[0][0]
    if (state === "success" && options.success) options.success()
    if (state === "replacement") page.data.exportedHandoverPath = "/data/new.csv"
    if (state === "unload") page.onUnload()
    options.fail(state === "cancel" ? new Error("shareFileMessage:fail cancel") : new Error("shareFileMessage:fail unavailable"))
    expect(wx.showToast).not.toHaveBeenCalled()
  })
})
