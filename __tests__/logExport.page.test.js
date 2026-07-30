jest.mock("../shared/pageAuth", () => ({
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
})
