jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))

const fs = require("fs")
const path = require("path")

const mockCanShareCsvFile = jest.fn(() => true)
const mockGetErrorMessage = jest.fn((error) => String((error && error.message) || ""))
const mockOpenCsvFile = jest.fn(() => Promise.resolve())
const mockRemoveCsvFile = jest.fn(() => Promise.resolve())
const mockSaveCsvFile = jest.fn(() =>
  Promise.resolve({
    filePath: "wxfile://usr/privacy-data-request_1.csv",
    fileName: "privacy-data-request_1.csv"
  })
)
const mockShareCsvFile = jest.fn(() => Promise.resolve())

jest.mock("../shared/csvFile", () => ({
  canShareCsvFile: mockCanShareCsvFile,
  getErrorMessage: mockGetErrorMessage,
  openCsvFile: mockOpenCsvFile,
  removeCsvFile: mockRemoveCsvFile,
  saveCsvFile: mockSaveCsvFile,
  shareCsvFile: mockShareCsvFile
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/privacy-data-inventory/privacy-data-inventory")
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

describe("pages/privacy-data-inventory", () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("页面格式化三类数据并展示部分失败提示", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              partial: true,
              unavailable: ["favorites"],
              truncated: ["bookings"],
              request: {
                id: "request_1",
                openid: "user_openid",
                type: "access",
                status: "processing",
                createdAt: "2026-07-30T08:00:00.000Z"
              },
              categories: {
                bookings: {
                  count: 1,
                  truncated: false,
                  list: [
                    {
                      id: "booking_1",
                      vehicleName: "示例车辆",
                      status: "pending",
                      startDate: "2026-08-01",
                      endDate: "2026-08-02"
                    }
                  ]
                },
                quotes: { count: 0, truncated: false, list: [] },
                favorites: {
                  count: 0,
                  truncated: false,
                  list: []
                },
                privacyRequests: {
                  count: 1,
                  truncated: false,
                  list: [{ id: "request_1", type: "access", status: "processing" }]
                }
              }
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      requestId: "request_1"
    })

    page.loadInventory()

    expect(page.data.loading).toBe(false)
    expect(page.data.partial).toBe(true)
    expect(page.data.unavailableText).toBe("收藏数据")
    expect(page.data.issueText).toBe("收藏数据暂不可用；预约数据超过单类 200 条展示上限")
    expect(page.data.request.typeLabel).toBe("查询信息")
    expect(page.data.bookings.list[0]).toMatchObject({
      statusLabel: "待联系",
      dateText: "2026-08-01 至 2026-08-02"
    })
    expect(page.data.privacyRequests.list[0].statusLabel).toBe("处理中")
    expect(page.data.verifiedCategoryCount).toBe(3)
    expect(page.data.inventoryProgress).toBe(60)
    expect(page.data.inventoryStatusClass).toBe("inventory-status-partial")
    expect(page.data.totalRecordCount).toBe(2)
    expect(page.data.bookings).toMatchObject({
      stateLabel: "展示受限",
      stateClass: "metric-state-truncated",
      iconClass: "metric-native-icon-booking"
    })
    expect(page.data.favorites.stateLabel).toBe("暂不可用")
    expect(page.data.privacyRequests.stateLabel).toBe("核验完整")
    expect(page.data.request).toMatchObject({
      typeClass: "request-type-access",
      typeIconClass: "request-type-icon-access",
      statusClass: "request-status-processing"
    })
  })

  test("云函数失败时显示明确错误", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: false,
              message: "隐私申请不存在"
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      requestId: "missing_request"
    })

    page.loadInventory()

    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("隐私申请不存在")
  })

  test("数据核验无响应时退出骨架屏并结束下拉刷新", () => {
    jest.useFakeTimers()
    let lateSuccess
    const done = jest.fn()
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const page = createPage(loadPageDefinition(), { requestId: "request_timeout" })

    page.loadInventory({ refreshing: true, done })
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.refreshing).toBe(false)
    expect(page.data.loadError).toBe("相关数据核验超时，请检查网络后重试")
    expect(done).toHaveBeenCalledTimes(1)

    lateSuccess({ result: { ok: true, request: { id: "request_timeout" }, categories: {} } })
    expect(page.data.request).toEqual({})
  })

  test("重新核验后忽略旧请求的迟到结果", () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition(), { requestId: "request_race" })

    page.loadInventory()
    page.loadInventory({ refreshing: true })
    requests[1].success({
      result: {
        ok: true,
        request: { id: "request_race", type: "access", status: "pending" },
        categories: {},
        unavailable: ["favorites"]
      }
    })
    requests[0].success({
      result: {
        ok: true,
        request: { id: "stale_request", type: "deletion", status: "completed" },
        categories: {}
      }
    })

    expect(page.data.request.id).toBe("request_race")
    expect(page.data.partial).toBe(false)
    expect(page.data.unavailable).toEqual(["favorites"])
  })

  test("数据核验调用同步异常时安全进入重试状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud sdk crashed")
        })
      }
    }
    const page = createPage(loadPageDefinition(), { requestId: "request_error" })

    expect(() => page.loadInventory()).not.toThrow()
    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("cloud sdk crashed")
  })

  test("完整的查询申请可生成并保存个人数据 CSV", async () => {
    const callFunction = jest.fn(({ data, success }) => {
      expect(data).toEqual({
        requestId: "request_1",
        mode: "export"
      })
      success({
        result: {
          ok: true,
          fileName: "privacy-data-request_1.csv",
          csvText: "\ufeff数据类别"
        }
      })
    })
    global.wx = {
      cloud: { callFunction },
      showModal: jest.fn(({ success }) => success({ confirm: true })),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      requestId: "request_1",
      partial: false,
      request: { type: "access" }
    })

    page.handleExport()
    await Promise.resolve()
    await Promise.resolve()

    expect(callFunction).toHaveBeenCalledTimes(1)
    expect(mockSaveCsvFile).toHaveBeenCalledWith({
      fileName: "privacy-data-request_1.csv",
      fallbackFileName: "privacy-data-request_1.csv",
      csvText: "\ufeff数据类别"
    })
    expect(page.data.exporting).toBe(false)
    expect(page.data.exportFilePath).toBe("wxfile://usr/privacy-data-request_1.csv")
    expect(page.data.exportFileName).toBe("privacy-data-request_1.csv")
  })

  test("个人数据导出无响应时恢复按钮并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      },
      showModal: jest.fn(({ success }) => success({ confirm: true })),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      requestId: "request_export_timeout",
      partial: false,
      request: { type: "access" }
    })

    page.handleExport()
    expect(page.data.exporting).toBe(true)

    jest.advanceTimersByTime(20 * 1000)
    expect(page.data.exporting).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({ title: "导出超时，请重试", icon: "none" })

    lateSuccess({ result: { ok: true, fileName: "late.csv", csvText: "敏感数据" } })
    expect(mockSaveCsvFile).not.toHaveBeenCalled()
    expect(page.data.exportFilePath).toBe("")
  })

  test("个人数据导出同步异常时安全恢复可重试状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud sdk crashed")
        })
      },
      showModal: jest.fn(({ success }) => success({ confirm: true })),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      requestId: "request_export_error",
      partial: false,
      request: { type: "access" }
    })

    expect(() => page.handleExport()).not.toThrow()
    expect(page.data.exporting).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({ title: "导出失败", icon: "none" })
  })

  test("导出超时后清理迟到生成的敏感文件", async () => {
    jest.useFakeTimers()
    let resolveSave
    mockSaveCsvFile.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveSave = resolve
      })
    )
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({ result: { ok: true, fileName: "privacy-late.csv", csvText: "敏感数据" } })
        })
      },
      showModal: jest.fn(({ success }) => success({ confirm: true })),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      requestId: "request_export_late_file",
      partial: false,
      request: { type: "access" }
    })

    page.handleExport()
    jest.advanceTimersByTime(20 * 1000)
    resolveSave({ filePath: "wxfile://usr/privacy-late.csv", fileName: "privacy-late.csv" })
    await Promise.resolve()
    await Promise.resolve()

    expect(page.data.exportFilePath).toBe("")
    expect(mockRemoveCsvFile).toHaveBeenCalledWith("wxfile://usr/privacy-late.csv")
  })

  test("清单不完整时页面不会请求导出", () => {
    global.wx = {
      cloud: { callFunction: jest.fn() },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      requestId: "request_1",
      partial: true,
      request: { type: "access" }
    })

    page.handleExport()

    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "数据未就绪",
      icon: "none"
    })
  })

  test("四类数据完整时显示百分百核验覆盖", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              partial: false,
              unavailable: [],
              truncated: [],
              request: { id: "request_2", type: "deletion", status: "pending" },
              categories: {
                bookings: { count: 2, list: [] },
                quotes: { count: 2, list: [] },
                favorites: { count: 1, list: [] },
                privacyRequests: { count: 3, list: [] }
              }
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition(), { requestId: "request_2" })

    page.loadInventory()

    expect(page.data.verifiedCategoryCount).toBe(5)
    expect(page.data.inventoryProgress).toBe(100)
    expect(page.data.inventoryStatusLabel).toBe("核验完整")
    expect(page.data.inventoryStatusClass).toBe("inventory-status-complete")
    expect(page.data.totalRecordCount).toBe(8)
    expect(page.data.request.typeIconClass).toBe("request-type-icon-deletion")
  })

  test("清单页面使用覆盖进度、分类图标和原生文件操作", () => {
    const pageDir = path.resolve(__dirname, "../pages/privacy-data-inventory")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "privacy-data-inventory.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "privacy-data-inventory.wxss"), "utf8")

    expect(wxmlSource).toContain('class="inventory-progress-card ui-card {{inventoryStatusClass}}"')
    expect(wxmlSource).toContain('aria-disabled="{{refreshing}}"')
    expect(wxmlSource).toContain('hover-class="{{refreshing ? \'none\' : \'refresh-link-pressed\'}}"')
    expect(wxmlSource).toContain("{{inventoryProgress}}%")
    expect(wxmlSource).toContain('class="inventory-skeleton"')
    expect(wxmlSource).toContain("inventory-skeleton-request")
    expect(wxmlSource).toContain("inventory-skeleton-progress")
    expect(wxmlSource).toContain("inventory-skeleton-metrics")
    expect(wxmlSource).not.toContain('class="state-loader"')
    expect(wxmlSource).toContain('class="metric-native-icon {{bookings.iconClass}}"')
    expect(wxmlSource).toContain('class="request-type-icon {{request.typeIconClass}}"')
    expect(wxmlSource).toContain('class="copy-native-icon"')
    expect(wxmlSource).toContain('class="export-native-icon"')
    expect(wxmlSource).toContain('class="export-action-icon delete-native-icon"')
    expect(wxmlSource).toContain('class="record-native-chevron"')
    expect(wxmlSource).toContain('hover-class="record-link-pressed"')
    expect(wxmlSource).toContain('aria-label="查看预约 {{item.vehicleName || item.vehicleId || \'未命名车辆\'}}')
    expect(wxmlSource.match(/class="inventory-empty-native-icon"/g)).toHaveLength(5)
    expect(`${wxmlSource}\n${wxssSource}`).not.toMatch(/[›✓✔]/)
    expect(wxssSource).toContain(".inventory-progress-value")
    expect(wxssSource).toContain(".metric-state-unavailable")
    expect(wxssSource).toContain(".privacy-note-native-icon")
    expect(wxssSource).toContain(".inventory-empty-native-icon")
    expect(wxssSource).toContain(".inventory-skeleton-request")
    expect(wxssSource).toContain(".inventory-skeleton-metric")
    expect(wxssSource).toContain(".record-link-pressed")
    expect(wxssSource).toContain(".refresh-link-pressed")
  })
})
