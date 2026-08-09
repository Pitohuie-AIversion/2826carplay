jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))

jest.mock("../shared/csvFile", () => ({
  canShareCsvFile: jest.fn(() => true),
  getErrorMessage: jest.fn(() => ""),
  isUserCancelError: jest.fn(() => false),
  openCsvFile: jest.fn(),
  removeCsvFile: jest.fn(),
  saveCsvFile: jest.fn(),
  shareCsvFile: jest.fn()
}))

const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/error-log-manage/error-log-manage")
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
  page.setData = jest.fn((patch, callback) => {
    page.data = {
      ...page.data,
      ...patch
    }
    if (typeof callback === "function") {
      callback()
    }
  })
  return page
}

describe("pages/error-log-manage 诊断时间线", () => {
  afterEach(() => {
    jest.useRealTimers()
    jest.clearAllMocks()
    delete global.Page
    delete global.wx
  })

  test("错误列表无回调时超时收尾并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    const done = jest.fn()
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const existingList = [{ id: "existing" }]
    const page = createPage(loadPageDefinition(), {
      initialLoading: false,
      list: existingList,
      page: 2,
      hasMore: true,
      total: 60,
      truncated: true
    })

    page.fetchList({ append: true, done })
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.list).toBe(existingList)
    expect(page.data.page).toBe(2)
    expect(page.data.hasMore).toBe(true)
    expect(page.data.total).toBe(60)
    expect(done).toHaveBeenCalledTimes(1)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "加载超时，请重试",
      icon: "none"
    })

    lateSuccess({
      result: {
        ok: true,
        page: 3,
        hasMore: false,
        list: [{ id: "late", function: "roleUpsert" }]
      }
    })
    expect(page.data.list).toBe(existingList)
    expect(page.data.page).toBe(2)
  })

  test("新错误列表请求覆盖旧请求且旧结果不会回写", () => {
    const requests = []
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchList()
    page.fetchList()
    requests[1].success({
      result: {
        ok: true,
        page: 0,
        hasMore: false,
        list: [{ id: "fresh", function: "vehicleCreate", errorMessage: "fresh" }]
      }
    })
    requests[0].success({
      result: {
        ok: true,
        page: 0,
        hasMore: false,
        list: [{ id: "stale", function: "roleUpsert", errorMessage: "stale" }]
      }
    })

    expect(page.data.list).toHaveLength(1)
    expect(page.data.list[0].id).toBe("fresh")
  })

  test("错误日志导出全链路超时后清理迟到生成的文件", async () => {
    jest.useFakeTimers()
    let exportRequest
    let resolveSave
    global.wx = {
      showToast: jest.fn(),
      showModal: jest.fn(),
      cloud: {
        callFunction: jest.fn((options) => {
          exportRequest = options
        })
      }
    }
    const definition = loadPageDefinition()
    const csvFile = require("../shared/csvFile")
    csvFile.saveCsvFile.mockReturnValue(
      new Promise((resolve) => {
        resolveSave = resolve
      })
    )
    csvFile.removeCsvFile.mockResolvedValue()
    const page = createPage(definition, {
      keyword: "DB_TIMEOUT",
      currentFunc: "vehicleUpdate"
    })

    page.handleExport()
    expect(exportRequest.data).toMatchObject({
      logType: "error",
      filter: "vehicleUpdate",
      keyword: "DB_TIMEOUT"
    })
    exportRequest.success({
      result: {
        ok: true,
        csvText: "id,function\ne1,vehicleUpdate",
        fileName: "errors.csv"
      }
    })
    jest.advanceTimersByTime(20 * 1000)

    expect(page.data.exporting).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "导出超时，请重试",
      icon: "none"
    })

    resolveSave({ filePath: "/data/errors.csv", fileName: "errors.csv" })
    await Promise.resolve()
    await Promise.resolve()
    expect(csvFile.removeCsvFile).toHaveBeenCalledWith("/data/errors.csv")
    expect(page.data.exportFilePath).toBe("")
  })

  test("错误日志导出遇到云 SDK 同步异常时安全结束", () => {
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud down")
        })
      }
    }
    const page = createPage(loadPageDefinition())

    expect(() => page.handleExport()).not.toThrow()
    expect(page.data.exporting).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "cloud down",
      icon: "none"
    })
  })

  test("异常来源映射为中文服务分组与排查建议", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              page: 0,
              total: 5,
              hasMore: false,
              truncated: false,
              list: [
                { id: "access", function: "roleUpsert", stage: "permission_write", errorMessage: "权限保存失败" },
                { id: "vehicle", function: "vehicleUpdate", vehicleId: "vehicle_1", errorCode: "DB_TIMEOUT", errorMessage: "车辆更新失败" },
                { id: "booking", function: "bookingCreate", bookingId: "booking_1", errorMessage: "预约创建失败" },
                { id: "privacy", function: "privacyRequestDataInventory", stage: "scan", errorMessage: "核验失败" },
                { id: "system", function: "analyticsCleanup", errorMessage: "清理失败" }
              ]
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchList()

    expect(page.data.list.map((item) => item.sourceGroup)).toEqual([
      "权限安全",
      "车辆管理",
      "预约服务",
      "隐私服务",
      "系统运营"
    ])
    expect(page.data.list[1]).toMatchObject({
      sourceLabel: "车辆编辑",
      eventClass: "error-event-vehicle",
      eventIconClass: "error-event-icon-vehicle",
      errorSignal: "错误码已记录",
      diagnosticHint: "优先按错误码 DB_TIMEOUT 检索云函数日志"
    })
    expect(page.data.list[1].summaryRows).toEqual([
      { label: "车辆", value: "vehicle_1" },
      { label: "错误码", value: "DB_TIMEOUT" }
    ])
    expect(page.data.list[0].diagnosticHint).toContain("permission_write")
  })

  test("异常消息只展示安全长度的摘要", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              page: 0,
              total: 1,
              hasMore: false,
              truncated: false,
              list: [{ id: "long", function: "bookingCreate", errorMessage: "错".repeat(180) }]
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchList()

    expect(page.data.list[0].messagePreview).toHaveLength(141)
    expect(page.data.list[0].messagePreview.endsWith("…")).toBe(true)
  })

  test("错误页使用诊断时间线、结构化详情和原生操作图标", () => {
    const pageDir = path.join(__dirname, "..", "pages", "error-log-manage")
    const wxml = fs.readFileSync(path.join(pageDir, "error-log-manage.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "error-log-manage.wxss"), "utf8")

    expect(wxml).toContain('class="error-timeline"')
    expect(wxml).toContain("{{item.sourceLabel}}")
    expect(wxml).toContain("{{item.summaryRows}}")
    expect(wxml).toContain('class="message-native-icon"')
    expect(wxml).toContain('class="diagnostic-native-icon"')
    expect(wxml).toContain('class="button-native-icon query-native-icon"')
    expect(wxml).toContain('class="export-action-icon delete-native-icon"')
    expect(wxml).toContain('class="load-more-native-icon"')
    expect(wxml).toContain('class="load-complete-native-icon"')
    expect(wxml).toContain('bindtap="handleResetFilters"')
    expect(wxml).toContain('aria-pressed="{{currentFunc === item.value}}"')
    expect(wxml).toContain('scroll-into-view="error-func-{{currentFunc}}"')
    expect(wxml).toContain('id="error-func-{{item.value}}"')
    expect(wxml).toContain("{{exporting ? '正在导出' : '导出 CSV'}}")
    expect(wxml).not.toContain('bindtap="handleLoadMore">加载更多</button>')
    expect(wxml).not.toMatch(/>\s*[✓✔]\s*</)
    expect(wxss).toMatch(/\.error-page\.management-page \.log-func\s*\{[^}]*-webkit-line-clamp:\s*2/s)
    expect(wxss).toContain(".error-event-icon-vehicle")
    expect(wxss).toContain(".diagnostic-hint")
    expect(wxss).toContain(".filter-result-bar")
    expect(wxss).toContain(".log-action-content")
  })

  test("重置筛选恢复全部函数并重新加载", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({ result: { ok: true, page: 0, total: 0, list: [] } })
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.data.keyword = "DB_TIMEOUT"
    page.data.currentFunc = "vehicleUpdate"
    page.data.currentFuncLabel = "车辆编辑"

    page.handleResetFilters()

    expect(page.data.keyword).toBe("")
    expect(page.data.currentFunc).toBe("all")
    expect(page.data.currentFuncLabel).toBe("全部函数")
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "errorLogList",
      data: expect.objectContaining({ func: "", keyword: "" })
    }))
  })
})
