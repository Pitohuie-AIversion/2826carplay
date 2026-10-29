describe("booking-detail page lifecycle error paths", () => {
  let page

  beforeEach(() => {
    jest.resetModules()
    global.wx = {
      showToast: jest.fn(),
      getFileSystemManager: jest.fn(),
      removeStorageSync: jest.fn(),
      cloud: { callFunction: jest.fn() },
      shareFileMessage: jest.fn()
    }
    let pageDef = {}
    global.Page = (def) => { pageDef = def }
    require("../pages/booking-detail/booking-detail.js")
    page = { ...pageDef, data: JSON.parse(JSON.stringify(pageDef.data)) }
    page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  })

  afterEach(() => {
    delete global.wx
    delete global.Page
  })

  test("onUnload ignores errors from _perf.dispose", () => {
    page.cancelOperationConfigRequest = jest.fn()
    page.clearDetailLoadTimer = jest.fn()
    page.clearSaveRequestTimer = jest.fn()
    page.clearCancelRequestTimer = jest.fn()
    page.clearSubscriptionRequestTimer = jest.fn()
    page.clearQuoteResponseTimer = jest.fn()
    page.clearHandoverResponseTimer = jest.fn()
    page.finishDetailLoadEffects = jest.fn()
    page._perf = { dispose: () => { throw new Error("test error") } }
    expect(() => {
      page.onUnload()
    }).not.toThrow()
  })

  test("finishDetailLoadEffects ignores errors from detailLoadDone", () => {
    page._detailLoadDone = () => { throw new Error("test error") }
    expect(() => {
      page.finishDetailLoadEffects()
    }).not.toThrow()
  })

  test("loadDetail ignores errors from done callback", () => {
    page.data.editing = true
    expect(() => {
      page.loadDetail({ done: () => { throw new Error("test error") } })
    }).not.toThrow()
  })

  test("loadDetail success callback ignores errors from wx.removeStorageSync", () => {
    jest.useFakeTimers()
    page.data.id = "booking_1"
    global.wx.cloud = {
      callFunction: jest.fn((options) => {
        global.wx.removeStorageSync.mockImplementation(() => { throw new Error("test error") })
        options.success({ result: { ok: false, code: "NOT_FOUND" } })
      })
    }
    expect(() => {
      page.loadDetail()
    }).not.toThrow()
    jest.useRealTimers()
  })

  test("handleShareExportedHandover ignores errors from wx.shareFileMessage", () => {
    page.data.exportedHandoverPath = "wxfile://usr/test.csv"
    global.wx.shareFileMessage = jest.fn(() => { throw new Error("share error") })

    // Mock the external pageNativeAction utilities used in handleShareExportedHandover
    jest.doMock("../shared/pageNativeAction", () => ({
      beginPageNativeAction: jest.fn(() => "action_1"),
      isPageNativeActionActive: jest.fn(() => true),
      isUserCancelError: jest.fn(() => false)
    }))

    // We need to re-require the page after mocking its dependencies
    jest.resetModules()
    let newPageDef = {}
    global.Page = (def) => { newPageDef = def }
    require("../pages/booking-detail/booking-detail.js")
    const newPage = { ...newPageDef, data: JSON.parse(JSON.stringify(newPageDef.data)) }
    newPage.data.exportedHandoverPath = "wxfile://usr/test.csv"

    expect(() => {
      newPage.handleShareExportedHandover()
    }).not.toThrow()

    expect(global.wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "分享文件失败" }))
  })

  test("handleExportHandoverReport ignores errors from fs.writeFile", () => {
    jest.useFakeTimers()
    jest.doMock("../shared/pageNativeAction", () => ({
      beginPageNativeAction: jest.fn(() => "action_1"),
      isPageNativeActionActive: jest.fn(() => true)
    }))
    jest.doMock("../shared/handoverReport", () => ({
      formatHandoverCsvContent: jest.fn(() => "csv content"),
      getHandoverFileName: jest.fn(() => "file.csv")
    }))

    jest.resetModules()
    let newPageDef = {}
    global.Page = (def) => { newPageDef = def }
    require("../pages/booking-detail/booking-detail.js")
    const newPage = { ...newPageDef, data: JSON.parse(JSON.stringify(newPageDef.data)) }
    newPage.setData = jest.fn((patch) => Object.assign(newPage.data, patch))

    newPage.data.handovers = { pickup: { id: "h1", version: 1 } }
    newPage.data.booking = { id: "b1", vehicleName: "V1" }
    global.wx = {
      env: { USER_DATA_PATH: "wxfile://usr" },
      showToast: jest.fn(),
      getFileSystemManager: jest.fn(() => ({ writeFile: jest.fn(() => { throw new Error("write error") }) }))
    }
    newPage._bookingDetailUnloaded = false

    expect(() => {
      newPage.handleExportHandoverReport({ currentTarget: { dataset: { stage: "pickup", id: "h1" } } })
    }).not.toThrow()
    expect(global.wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "留证单导出失败" }))
    jest.useRealTimers()
  })

  test("handleExportHandoverReport ignores errors from wx.getFileSystemManager", () => {
    jest.useFakeTimers()
    jest.doMock("../shared/pageNativeAction", () => ({
      beginPageNativeAction: jest.fn(() => "action_1"),
      isPageNativeActionActive: jest.fn(() => true)
    }))

    jest.resetModules()
    let newPageDef = {}
    global.Page = (def) => { newPageDef = def }
    require("../pages/booking-detail/booking-detail.js")
    const newPage = { ...newPageDef, data: JSON.parse(JSON.stringify(newPageDef.data)) }
    newPage.setData = jest.fn((patch) => Object.assign(newPage.data, patch))

    newPage.data.handovers = { pickup: { id: "h1", version: 1 } }
    global.wx = {
      env: { USER_DATA_PATH: "wxfile://usr" },
      showToast: jest.fn(),
      getFileSystemManager: () => { throw new Error("fs error") }
    }

    expect(() => {
      newPage.handleExportHandoverReport({ currentTarget: { dataset: { stage: "pickup", id: "h1" } } })
    }).not.toThrow()
    expect(global.wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "系统暂不支持文件导出" }))
    jest.useRealTimers()
  })

  test("handleExportHandoverReport success ignores errors from fs.unlink", () => {
    jest.useFakeTimers()
    jest.doMock("../shared/pageNativeAction", () => ({
      beginPageNativeAction: jest.fn(() => "action_1"),
      isPageNativeActionActive: jest.fn(() => true)
    }))

    jest.resetModules()
    let newPageDef = {}
    global.Page = (def) => { newPageDef = def }
    require("../pages/booking-detail/booking-detail.js")
    const newPage = { ...newPageDef, data: JSON.parse(JSON.stringify(newPageDef.data)) }
    newPage.setData = jest.fn((patch) => Object.assign(newPage.data, patch))

    newPage.data.handovers = { pickup: { id: "h1", version: 1 } }
    newPage.data.exportedHandoverPath = "wxfile://usr/old.csv"

    let successCallback
    const fs = {
      writeFile: jest.fn((options) => { successCallback = options.success }),
      unlink: jest.fn(() => { throw new Error("unlink error") })
    }
    global.wx = {
      env: { USER_DATA_PATH: "wxfile://usr" },
      showToast: jest.fn(),
      getFileSystemManager: () => fs
    }
    newPage._bookingDetailUnloaded = false

    newPage.handleExportHandoverReport({ currentTarget: { dataset: { stage: "pickup", id: "h1" } } })

    expect(() => {
      successCallback()
    }).not.toThrow()

    jest.useRealTimers()
  })
})
