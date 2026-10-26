const flush = async () => { for (let index = 0; index < 10; index += 1) await Promise.resolve() }

describe("privacy export preparation and confirmation", () => {
  let page, pages, requests, writes, files
  const response = { ok: true, csvText: "name,request\nprivate,access", fileName: "privacy.csv", exportToken: "a".repeat(40) }
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    writes = []
    files = new Map()
    global.wx = {
      env: { USER_DATA_PATH: "/data" },
      cloud: { callFunction: jest.fn((options) => requests.push(options)) },
      getFileSystemManager: () => ({
        writeFile: (options) => writes.push(options),
        unlink: ({ filePath, success }) => { files.delete(filePath); if (success) success() },
        stat: ({ path, success }) => success({ stats: { size: Buffer.byteLength(files.get(path) || "") } }),
        readFile: ({ filePath, success }) => success({ data: files.get(filePath) })
      }),
      showModal: jest.fn(({ success }) => { if (success) success({ confirm: true }) }),
      showToast: jest.fn(),
      shareFileMessage: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages-admin/privacy-data-inventory/privacy-data-inventory")
    Object.assign(page.data, { pageAuthorized: true, loading: false, requestId: "request_1", request: { type: "access", status: "processing" } })
    pages = [page]
    global.getCurrentPages = () => pages
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
    files.set(writes[index].filePath, writes[index].data)
    writes[index].success()
  }

  test.each([
    [{ ok: false, message: "申请已撤回" }, "申请已撤回"],
    [null, "导出失败"],
    [{ ok: true, csvText: "incomplete response" }, "导出失败"]
  ])("background preparation error %p is reported once on return", (result, title) => {
    page.handleExport()
    pages = [page, {}]
    requests[0].success({ result })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(writes).toHaveLength(0)
    pages = [page]
    page.onShow()
    expect(page.data.exporting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title, icon: "none" })
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(1)
  })

  test("duplicate preparation replies save and confirm exactly one file", async () => {
    page.handleExport()
    requests[0].success({ result: response })
    requests[0].success({ result: response })
    expect(writes).toHaveLength(1)
    completeWrite(0)
    await flush()
    requests[0].success({ result: response })
    expect(writes).toHaveLength(1)
    expect(requests.filter(({ data }) => data.mode === "confirmExport")).toHaveLength(1)
    requests[1].success({ result: { ok: true } })
    expect(page.data.exportConfirmationPending).toBe(false)
    expect(files.get(page.data.exportFilePath)).toBe(response.csvText)
  })

  test("a duplicate preparation failure cannot cancel an accepted save or misreport confirmation", async () => {
    page.handleExport()
    requests[0].success({ result: response })
    requests[0].fail(new Error("late network error"))
    completeWrite(0)
    await flush()
    expect(requests.filter(({ data }) => data.mode === "confirmExport")).toHaveLength(1)
    requests[1].success({ result: { ok: true } })
    expect(page.data.exportConfirmationPending).toBe(false)
    expect(files.get(page.data.exportFilePath)).toBe(response.csvText)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "个人数据已生成", icon: "none" })
  })

  test("a synchronous confirmation exception keeps the saved file and identifies confirmation failure", async () => {
    wx.cloud.callFunction.mockImplementation((options) => {
      if (options.data.mode === "confirmExport") throw new Error("internal confirmation bridge failed")
      requests.push(options)
    })
    page.handleExport()
    requests[0].success({ result: response })
    completeWrite(0)
    await flush()
    expect(page.data.exporting).toBe(false)
    expect(page.data.exportConfirmationPending).toBe(true)
    expect(files.get(page.data.exportFilePath)).toBe(response.csvText)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "导出确认失败", icon: "none" })
  })

  test.each(["timeout", "unload"])("%s removes an unfinished sensitive write without a native callback", async (end) => {
    files.set("/data/previous.csv", "previous confirmed contents")
    Object.assign(page.data, { exportFilePath: "/data/previous.csv", exportFileName: "previous.csv", exportConfirmationPending: true })
    page.handleExport()
    requests[0].success({ result: response })
    const abandonedPath = writes[0].filePath
    files.set(abandonedPath, "partial private contents")
    if (end === "unload") page.onUnload()
    else jest.advanceTimersByTime(20000)
    await flush()
    expect(files.has(abandonedPath)).toBe(false)
    expect(files.get("/data/previous.csv")).toBe("previous confirmed contents")
    expect(page.data.exportFilePath).toBe("/data/previous.csv")
    expect(requests.filter(({ data }) => data.mode === "confirmExport")).toHaveLength(0)
    wx.showToast.mockClear()
    files.set(abandonedPath, "late partial contents")
    writes[0].fail(new Error("late write failure"))
    await flush()
    expect(files.has(abandonedPath)).toBe(false)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("confirmation timeout preserves the already saved file for preview and retry", async () => {
    page.handleExport()
    requests[0].success({ result: response })
    completeWrite(0)
    await flush()
    const savedPath = page.data.exportFilePath
    expect(requests[1].data.mode).toBe("confirmExport")
    jest.advanceTimersByTime(20000)
    await flush()
    expect(page.data).toMatchObject({ exporting: false, exportConfirmationPending: true, exportFilePath: savedPath })
    expect(files.get(savedPath)).toBe(response.csvText)
    page.handleOpenExportedFile()
    await flush()
    expect(page.data.csvPreview.rows).toEqual([["name", "request"], ["private", "access"]])
  })

  test("a share failure for the previous file cannot open the newly retried export", async () => {
    page.handleExport()
    requests[0].success({ result: response })
    completeWrite(0)
    await flush()
    requests[1].fail(new Error("confirmation unavailable"))
    page.handleShareExportedFile()
    const oldShare = wx.shareFileMessage.mock.calls[0][0]
    page.handleExport()
    requests[2].success({ result: { ...response, csvText: "new,content", exportToken: "b".repeat(40) } })
    completeWrite(1)
    await flush()
    requests[3].success({ result: { ok: true } })
    wx.showToast.mockClear()
    oldShare.fail({ errMsg: "shareFileMessage:fail unavailable" })
    await flush()
    expect(page.data.csvPreview).toBeNull()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(files.get(page.data.exportFilePath)).toBe("new,content")
    page.handleOpenExportedFile()
    await flush()
    expect(page.data.csvPreview.rows).toEqual([["new", "content"]])
  })
})
