const EXPORT_PAGES = [
  ["audit", "../pages-admin/audit-log-manage/audit-log-manage", "exporting"],
  ["error", "../pages-admin/error-log-manage/error-log-manage", "exporting"],
  ["booking", "../pages/booking-manage/booking-manage", "loading"]
]

async function flushPromises() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

describe.each(EXPORT_PAGES)("%s CSV export lifecycle", (label, modulePath, busyField) => {
  let page
  let currentPages
  let writes
  let requests
  let files
  let fileSystem

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    writes = []
    requests = []
    files = new Map()
    fileSystem = {
      writeFile: jest.fn((options) => writes.push(options)),
      unlink: jest.fn(({ filePath, success }) => {
        files.delete(filePath)
        success()
      })
    }
    global.wx = {
      env: { USER_DATA_PATH: "/data" },
      getFileSystemManager: () => fileSystem,
      cloud: { callFunction: jest.fn((options) => requests.push(options)) },
      showToast: jest.fn(),
      showModal: jest.fn(({ success }) => { if (success) success({ confirm: true }) }),
      openDocument: jest.fn(),
      shareFileMessage: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: { ...definition.data } }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require(modulePath)
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

  function respond(index, csvText = "id,value\n1,new") {
    requests[index].success({ result: { ok: true, csvText, fileName: "same.csv" } })
  }

  async function finishWrite(index) {
    const options = writes[index]
    files.set(options.filePath, options.data)
    options.success()
    await flushPromises()
  }

  test("a timed-out write cannot overwrite or delete a successful same-name retry", async () => {
    page.handleExport()
    respond(0, "old content")
    jest.advanceTimersByTime(20 * 1000)
    expect(page.data[busyField]).toBe(false)

    page.handleExport()
    respond(1, "new content")
    expect(writes[0].filePath).not.toBe(writes[1].filePath)
    await finishWrite(1)
    await finishWrite(0)

    expect(page.data.exportFilePath).toBe(writes[1].filePath)
    expect(page.data.exportFileName).toBe("same.csv")
    expect(files.get(writes[1].filePath)).toBe("new content")
    expect(files.has(writes[0].filePath)).toBe(false)
  })

  test("a failed write removes its partial file and preserves the previous export for retry", async () => {
    files.set("/data/previous.csv", "previous")
    Object.assign(page.data, { exportFilePath: "/data/previous.csv", exportFileName: "previous.csv" })
    page.handleExport()
    respond(0)
    files.set(writes[0].filePath, "partial")
    writes[0].fail(new Error("storage full"))
    await flushPromises()

    expect(page.data[busyField]).toBe(false)
    expect(page.data.exportFilePath).toBe("/data/previous.csv")
    expect(files.get("/data/previous.csv")).toBe("previous")
    expect(files.has(writes[0].filePath)).toBe(false)
    page.handleExport()
    respond(1)
    await finishWrite(1)
    expect(page.data.exportFilePath).toBe(writes[1].filePath)
    expect(files.has("/data/previous.csv")).toBe(false)
  })

  test("background export failure stays silent and unlocks retry on return", () => {
    page.handleExport()
    currentPages = [page, {}]
    page.setData.mockClear()
    requests[0].fail(new Error("network failed"))
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    currentPages = [page]
    page.onShow()
    expect(page.data[busyField]).toBe(false)
    page.handleExport()
    expect(requests).toHaveLength(2)
  })

  test("background write completion only cleans its file and unlocks retry on return", async () => {
    page.handleExport()
    respond(0)
    currentPages = [page, {}]
    page.setData.mockClear()
    await finishWrite(0)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(files.has(writes[0].filePath)).toBe(false)
    currentPages = [page]
    page.onShow()
    expect(page.data[busyField]).toBe(false)
    expect(page.data.exportFilePath).toBe("")
  })

  test.each([false, true])("background deletion reconciles on return; replacement=%s", async (replace) => {
    Object.assign(page.data, { exportFilePath: "/data/old.csv", exportFileName: "old.csv" })
    let deletion
    fileSystem.unlink.mockImplementationOnce((options) => { deletion = options })
    page.handleDeleteExportedFile()
    currentPages = [page, {}]
    page.setData.mockClear()
    deletion.success()
    await flushPromises()
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    if (replace) Object.assign(page.data, { exportFilePath: "/data/new.csv", exportFileName: "new.csv" })
    currentPages = [page]
    page.onShow()
    expect(page.data.exportFilePath).toBe(replace ? "/data/new.csv" : "")
    expect(page.data.exportFileName).toBe(replace ? "new.csv" : "")
  })

  test("deletion failure retains the export and can be retried", async () => {
    Object.assign(page.data, { exportFilePath: "/data/old.csv", exportFileName: "old.csv" })
    fileSystem.unlink.mockImplementationOnce(({ fail }) => fail(new Error("busy")))
    page.handleDeleteExportedFile()
    await flushPromises()
    expect(page.data.exportFilePath).toBe("/data/old.csv")
    expect(wx.showToast).toHaveBeenCalledWith({ title: "删除失败", icon: "none" })
    page.handleDeleteExportedFile()
    await flushPromises()
    expect(page.data.exportFilePath).toBe("")
  })

  test("opening failure is reported as a failure and share cancellation stays silent", async () => {
    Object.assign(page.data, { exportFilePath: "/data/old.csv", exportFileName: "old.csv" })
    wx.openDocument.mockImplementationOnce(() => { throw new Error("file unavailable") })
    page.handleOpenExportedFile()
    await flushPromises()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "文件打开失败", icon: "none" })
    wx.showToast.mockClear()
    wx.openDocument.mockClear()
    wx.shareFileMessage.mockImplementationOnce(({ fail }) => fail({ errMsg: "shareFileMessage:fail cancel" }))
    page.handleShareExportedFile()
    await flushPromises()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.openDocument).not.toHaveBeenCalled()
  })
})
