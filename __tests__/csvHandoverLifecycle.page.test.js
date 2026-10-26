const routes = ["booking-detail", "booking-manage-detail"]
const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve() }

describe.each(routes)("%s handover CSV deletion", (route) => {
  let page, pages, fileSystem, pendingRemoval

  beforeEach(() => {
    jest.resetModules()
    pendingRemoval = null
    fileSystem = { unlink: jest.fn((options) => { pendingRemoval = options }) }
    global.wx = {
      env: { USER_DATA_PATH: "/data" },
      getFileSystemManager: jest.fn(() => fileSystem),
      showToast: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
      page.applyState = (patch) => page.setData(patch)
    }
    require(`../pages/${route}/${route}`)
    pages = [page]
    global.getCurrentPages = () => pages
    page.loadDetail = jest.fn()
    page.loadNotificationConfig = jest.fn()
    Object.assign(page.data, {
      exportedHandoverPath: "/data/report.csv",
      exportedHandoverFileName: "report.csv",
      exportedHandoverStage: "pickup"
    })
  })

  afterEach(() => {
    page.onUnload()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test.each([false, true])("background deletion is reconciled on return without clearing a replacement; replacement=%s", async (replace) => {
    page.handleDeleteExportedHandover()
    page.onHide()
    pages = [page, {}]
    page.setData.mockClear()
    pendingRemoval.success()
    await flush()
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    if (replace) Object.assign(page.data, { exportedHandoverPath: "/data/new.csv", exportedHandoverFileName: "new.csv", exportedHandoverStage: "return" })
    pages = [page]
    page.onShow()
    expect(page.data.exportedHandoverPath).toBe(replace ? "/data/new.csv" : "")
    expect(page.data.exportedHandoverFileName).toBe(replace ? "new.csv" : "")
    expect(page.data.exportedHandoverStage).toBe(replace ? "return" : "")
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test.each(["missing-api", "filesystem-throws", "unlink-throws", "unlink-fails"])("%s keeps the file available for a later retry and reports failure", async (mode) => {
    if (mode === "missing-api") fileSystem.unlink = undefined
    if (mode === "filesystem-throws") wx.getFileSystemManager.mockImplementationOnce(() => { throw new Error("filesystem unavailable") })
    if (mode === "unlink-throws") fileSystem.unlink.mockImplementationOnce(() => { throw new Error("bridge unavailable") })
    if (mode === "unlink-fails") fileSystem.unlink.mockImplementationOnce(({ fail }) => fail({ errMsg: "unlink:fail permission denied" }))
    expect(() => page.handleDeleteExportedHandover()).not.toThrow()
    await flush()
    expect(page.data.exportedHandoverPath).toBe("/data/report.csv")
    expect(page.data.exportedHandoverFileName).toBe("report.csv")
    expect(wx.showToast).toHaveBeenCalledWith({ title: "清理失败", icon: "none" })
    fileSystem.unlink = jest.fn(({ success }) => success())
    page.handleDeleteExportedHandover()
    await flush()
    expect(page.data.exportedHandoverPath).toBe("")
  })

  test("an already removed file clears the stale export and its preview", async () => {
    page.data.csvPreview = { rows: [["private"]] }
    page.handleDeleteExportedHandover()
    pendingRemoval.fail({ errMsg: "unlink:fail no such file or directory" })
    await flush()
    expect(page.data.exportedHandoverPath).toBe("")
    expect(page.data.exportedHandoverFileName).toBe("")
    expect(page.data.csvPreview).toBeNull()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "缓存已清理", icon: "none" })
  })

  test("unload discards pending deletion feedback and cannot mutate a new lifecycle", async () => {
    page.handleDeleteExportedHandover()
    page.onUnload()
    page.setData.mockClear()
    pendingRemoval.success()
    await flush()
    page.onShow()
    expect(page.data.exportedHandoverPath).toBe("/data/report.csv")
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })
})
