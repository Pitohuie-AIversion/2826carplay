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
      stat: jest.fn(({ path, success, fail }) => files.has(path) ? success({ stats: { size: Buffer.byteLength(files.get(path)) } }) : fail(new Error("file unavailable"))),
      readFile: jest.fn(({ filePath, success }) => success({ data: files.get(filePath) })),
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

  test.each(["timeout", "unload"])("%s cancels a stalled write and cleans partial data without waiting for a native reply", async (end) => {
    files.set("/data/previous.csv", "previous")
    Object.assign(page.data, { exportFilePath: "/data/previous.csv", exportFileName: "previous.csv" })
    page.handleExport()
    respond(0)
    const abandonedPath = writes[0].filePath
    files.set(abandonedPath, "partial personal data")
    if (end === "unload") page.onUnload()
    else jest.advanceTimersByTime(20000)
    await flushPromises()
    expect(files.has(abandonedPath)).toBe(false)
    expect(files.get("/data/previous.csv")).toBe("previous")
    expect(page.data.exportFilePath).toBe("/data/previous.csv")
    wx.showToast.mockClear()
    files.set(abandonedPath, "late partial data")
    writes[0].fail(new Error("late write failure"))
    await flushPromises()
    expect(files.has(abandonedPath)).toBe(false)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("duplicate cloud successes start only one save and preserve its published file", async () => {
    page.handleExport()
    respond(0, "same exported content")
    respond(0, "unexpected duplicate content")
    expect(writes).toHaveLength(1)
    await finishWrite(0)
    const publishedPath = page.data.exportFilePath
    wx.showToast.mockClear()
    respond(0, "late duplicate content")
    writes[0].success()
    writes[0].fail(new Error("duplicate native failure"))
    await flushPromises()
    expect(writes).toHaveLength(1)
    expect(page.data.exportFilePath).toBe(publishedPath)
    expect(files.get(publishedPath)).toBe("same exported content")
    expect(files.size).toBe(1)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data[busyField]).toBe(false)
  })

  test.each(["fail", "business failure", "throw"])("a cloud %s after accepted CSV cannot cancel its pending save", async (reply) => {
    if (reply === "throw") {
      wx.cloud.callFunction.mockImplementationOnce((options) => {
        requests.push(options)
        respond(0, "accepted content")
        throw new Error("late transport error")
      })
    }
    page.handleExport()
    if (reply !== "throw") {
      respond(0, "accepted content")
      files.set(writes[0].filePath, "partial accepted content")
      if (reply === "fail") requests[0].fail(new Error("late transport error"))
      else requests[0].success({ result: { ok: false, message: "late business error" } })
    }
    await flushPromises()
    expect(page.data[busyField]).toBe(true)
    expect(fileSystem.unlink).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(writes).toHaveLength(1)

    await finishWrite(0)
    expect(page.data.exportFilePath).toBe(writes[0].filePath)
    expect(files.get(writes[0].filePath)).toBe("accepted content")
    expect(page.data[busyField]).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "CSV 已生成", icon: "none" })
    expect(jest.getTimerCount()).toBe(0)
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
    fileSystem.stat.mockImplementationOnce(({ fail }) => fail(new Error("file unavailable")))
    page.handleOpenExportedFile()
    await flushPromises()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "文件打开失败", icon: "none" })
    expect(fileSystem.stat).toHaveBeenCalledWith(expect.objectContaining({ path: "/data/old.csv" }))
    expect(wx.openDocument).not.toHaveBeenCalled()
    wx.showToast.mockClear()
    wx.openDocument.mockClear()
    wx.shareFileMessage.mockImplementationOnce(({ fail }) => fail({ errMsg: "shareFileMessage:fail cancel" }))
    page.handleShareExportedFile()
    await flushPromises()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.openDocument).not.toHaveBeenCalled()
  })
})


describe("booking-manage CSV export error path", () => {
  let page, pages, files, writes, fileSystem, requests
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    files = new Map()
    writes = []
    requests = []
    fileSystem = {
      writeFile: jest.fn((options) => writes.push(options)),
      unlink: jest.fn(({ filePath, success }) => { files.delete(filePath); if (success) success() })
    }
    global.wx = {
      env: { USER_DATA_PATH: "/data" },
      getFileSystemManager: () => fileSystem,
      cloud: { callFunction: jest.fn((options) => requests.push(options)) },
      showToast: jest.fn(),
      showModal: jest.fn(({ success }) => { if (success) success({ confirm: true }) }),
    }
    global.getApp = () => ({})
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require(`../pages/booking-manage/booking-manage`)
    pages = [page]
    global.getCurrentPages = () => pages
    page.onLoad()
  })
  afterEach(() => {
    page.onUnload()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve() }

  test("synchronous saveExportedCsv failure is caught and reported", async () => {
    page.handleExport()
    page.saveExportedCsv = jest.fn(() => { throw new Error("synchronous mock error") })

    const request = requests.find(req => req.name === "bookingExportCsv")
    request.success({
      result: { ok: true, csvText: "1,2,3", fileName: "test.csv" }
    })

    await flush()

    expect(page.saveExportedCsv).toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "保存失败", icon: "none" })
    expect(page.data.loading).toBe(false)
  })
})
