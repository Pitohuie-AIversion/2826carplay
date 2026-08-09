jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))

jest.mock("../shared/csvFile", () => ({
  canShareCsvFile: jest.fn(() => true),
  getErrorMessage: jest.fn((error) => String((error && error.message) || error || "")),
  openCsvFile: jest.fn(() => Promise.resolve()),
  removeCsvFile: jest.fn(() => Promise.resolve()),
  saveCsvFile: jest.fn(() =>
    Promise.resolve({
      filePath: "/user-data/export.csv",
      fileName: "export.csv"
    })
  ),
  shareCsvFile: jest.fn(() => Promise.resolve())
}))

function loadPageDefinition(modulePath) {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require(modulePath)
  return definition
}

function createPage(definition, data) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...(data || {})
    }
  }
  page.setData = jest.fn((patch) => {
    page.data = {
      ...page.data,
      ...patch
    }
  })
  return page
}

function flushPromises() {
  return new Promise((resolve) => setImmediate(resolve))
}

describe("log management CSV export", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("审计日志沿用当前操作和关键词导出", async () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              csvText: "\uFEFFa,b",
              fileName: "audit-logs.csv",
              total: 1,
              matchedTotal: 1,
              truncated: false
            }
          })
        })
      },
      showToast: jest.fn(),
      showModal: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/audit-log-manage/audit-log-manage"),
      {
        currentAction: "vehicleUpdate",
        keyword: "vehicle_1"
      }
    )

    page.handleExport()
    await flushPromises()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "logExportCsv",
        data: {
          logType: "audit",
          filter: "vehicleUpdate",
          keyword: "vehicle_1",
          limit: 500
        }
      })
    )
    expect(page.data.exporting).toBe(false)
    expect(page.data.exportFilePath).toBe("/user-data/export.csv")
  })

  test("错误日志沿用当前云函数筛选导出", async () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              csvText: "\uFEFFa,b",
              fileName: "error-logs.csv",
              total: 1,
              matchedTotal: 1,
              truncated: false
            }
          })
        })
      },
      showToast: jest.fn(),
      showModal: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/error-log-manage/error-log-manage"),
      {
        currentFunc: "bookingCreate",
        keyword: "RATE_LIMIT"
      }
    )

    page.handleExport()
    await flushPromises()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "logExportCsv",
        data: {
          logType: "error",
          filter: "bookingCreate",
          keyword: "RATE_LIMIT",
          limit: 500
        }
      })
    )
    expect(page.data.exportFileName).toBe("export.csv")
  })

  test("管理员确认后可删除当前设备上的导出文件", async () => {
    global.wx = {
      showModal: jest.fn(({ success }) => success({ confirm: true })),
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/audit-log-manage/audit-log-manage"),
      {
        exportFilePath: "/user-data/audit-logs.csv",
        exportFileName: "audit-logs.csv"
      }
    )
    const csvFile = require("../shared/csvFile")

    page.handleDeleteExportedFile()
    await flushPromises()

    expect(csvFile.removeCsvFile).toHaveBeenCalledWith("/user-data/audit-logs.csv")
    expect(page.data.exportFilePath).toBe("")
    expect(page.data.exportFileName).toBe("")
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "本地文件已删除",
      icon: "none"
    })
  })

  test("does not fall back to opening a shared file after page unload", async () => {
    let rejectShare
    global.wx = {
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/audit-log-manage/audit-log-manage"),
      {
        exportFilePath: "/user-data/audit-logs.csv",
        exportFileName: "audit-logs.csv"
      }
    )
    const csvFile = require("../shared/csvFile")
    csvFile.shareCsvFile.mockImplementationOnce(
      () => new Promise((resolve, reject) => {
        rejectShare = reject
      })
    )

    page.handleShareExportedFile()
    page.onUnload()
    rejectShare(new Error("share failed"))
    await flushPromises()

    expect(csvFile.openCsvFile).not.toHaveBeenCalled()
    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("does not show an open failure after the exported file is replaced", async () => {
    let rejectOpen
    global.wx = {
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/error-log-manage/error-log-manage"),
      {
        exportFilePath: "/user-data/error-logs.csv",
        exportFileName: "error-logs.csv"
      }
    )
    const csvFile = require("../shared/csvFile")
    csvFile.openCsvFile.mockImplementationOnce(
      () => new Promise((resolve, reject) => {
        rejectOpen = reject
      })
    )

    page.handleOpenExportedFile()
    page.data.exportFilePath = "/user-data/new-error-logs.csv"
    rejectOpen(new Error("open failed"))
    await flushPromises()

    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("does not clear a replacement file when deletion resolves late", async () => {
    let resolveRemoval
    global.wx = {
      showModal: jest.fn(({ success }) => success({ confirm: true })),
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages/privacy-data-inventory/privacy-data-inventory"),
      {
        exportFilePath: "/user-data/privacy-old.csv",
        exportFileName: "privacy-old.csv"
      }
    )
    const csvFile = require("../shared/csvFile")
    csvFile.removeCsvFile.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveRemoval = resolve
      })
    )

    page.handleDeleteExportedFile()
    page.data.exportFilePath = "/user-data/privacy-new.csv"
    page.data.exportFileName = "privacy-new.csv"
    resolveRemoval()
    await flushPromises()

    expect(page.data.exportFilePath).toBe("/user-data/privacy-new.csv")
    expect(page.data.exportFileName).toBe("privacy-new.csv")
    expect(global.wx.showToast).not.toHaveBeenCalled()
  })
})
