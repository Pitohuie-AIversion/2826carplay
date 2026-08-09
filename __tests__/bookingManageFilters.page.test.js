const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/booking-manage/booking-manage")
  return definition
}

function createPage(definition, overrides) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...(overrides || {})
    }
  }
  page.setData = jest.fn((patch) => {
    Object.assign(page.data, patch)
  })
  return page
}

describe("pages/booking-manage workflow filters", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("ignores share callbacks after the booking management page unloads", () => {
    let shareOptions
    global.wx = {
      shareFileMessage: jest.fn((options) => {
        shareOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      exportFilePath: "/user-data/bookings.csv",
      exportFileName: "bookings.csv"
    })

    page.handleShareExportedFile()
    page.onUnload()
    shareOptions.success()
    shareOptions.fail(new Error("share failed"))

    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("预约管理列表无回调时超时收尾并忽略迟到结果", () => {
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
      list: existingList,
      page: 2,
      hasMore: true,
      total: 60
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
        list: [{ id: "late" }]
      }
    })
    expect(page.data.list).toBe(existingList)
    expect(page.data.page).toBe(2)
  })

  test("新预约筛选请求覆盖旧请求且固定筛选快照", () => {
    const requests = []
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition(), { currentStatus: "pending" })

    page.fetchList()
    page.data.currentStatus = "contacted"
    page.fetchList()
    expect(requests[0].data.status).toBe("pending")
    expect(requests[1].data.status).toBe("contacted")

    requests[1].success({
      result: {
        ok: true,
        page: 0,
        hasMore: false,
        list: [{ id: "fresh", status: "contacted" }]
      }
    })
    requests[0].success({
      result: {
        ok: true,
        page: 0,
        hasMore: false,
        list: [{ id: "stale", status: "pending" }]
      }
    })

    expect(page.data.list).toHaveLength(1)
    expect(page.data.list[0].id).toBe("fresh")
  })

  test("预约导出全链路超时后删除迟到写入的文件", () => {
    jest.useFakeTimers()
    let exportRequest
    let writeOptions
    const unlink = jest.fn(({ success }) => success())
    const fileSystem = {
      writeFile: jest.fn((options) => {
        writeOptions = options
      }),
      unlink
    }
    global.wx = {
      env: { USER_DATA_PATH: "/data" },
      getFileSystemManager: jest.fn(() => fileSystem),
      showToast: jest.fn(),
      showModal: jest.fn(),
      cloud: {
        callFunction: jest.fn((options) => {
          exportRequest = options
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      currentStatus: "pending",
      keyword: "booking_1"
    })

    page.handleExport()
    expect(exportRequest.data).toMatchObject({
      status: "pending",
      keyword: "booking_1"
    })
    exportRequest.success({
      result: {
        ok: true,
        fileName: "bookings.csv",
        csvText: "id,status\nb1,pending"
      }
    })
    jest.advanceTimersByTime(20 * 1000)

    expect(page.data.loading).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "导出超时，请重试",
      icon: "none"
    })

    writeOptions.success()
    expect(unlink).toHaveBeenCalledWith(expect.objectContaining({
      filePath: "/data/bookings.csv"
    }))
    expect(page.data.exportFilePath).toBe("")
  })

  test("列表分页请求携带优先级和协调进度", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              list: [],
              total: 0,
              page: 0,
              hasMore: false
            }
          })
          if (complete) {
            complete()
          }
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      currentStatus: "contacted",
      currentPriority: "standby",
      currentCoordination: "coordinating",
      keyword: "杭州",
      pageSize: 20
    })

    page.fetchList()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingList",
      data: {
        status: "contacted",
        schedulePriority: "standby",
        coordinationStatus: "coordinating",
        keyword: "杭州",
        limit: 2000,
        page: 0,
        pageSize: 20
      },
      success: expect.any(Function),
      fail: expect.any(Function)
    })
  })

  test("导出沿用筛选，重置会清空三个筛选组", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      currentStatus: "pending",
      currentPriority: "priority",
      currentCoordination: "pending",
      keyword: "MX-5"
    })

    page.handleExport()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingExportCsv",
      data: {
        status: "pending",
        schedulePriority: "priority",
        coordinationStatus: "pending",
        keyword: "MX-5",
        limit: 500
      },
      success: expect.any(Function),
      fail: expect.any(Function)
    })
    global.wx.cloud.callFunction.mock.calls[0][0].fail({
      errMsg: "bookingExportCsv:fail test"
    })

    page.fetchList = jest.fn()
    page.handleReset()
    expect(page.data).toEqual(expect.objectContaining({
      keyword: "",
      currentStatus: "all",
      currentPriority: "all",
      currentCoordination: "all"
    }))
    expect(page.fetchList).toHaveBeenCalledTimes(1)
    page.onUnload()
  })

  test("预约状态映射为三阶段跟进轨迹与下一步提示", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              list: [
                { id: "pending", status: "pending" },
                { id: "contacted", status: "contacted" },
                { id: "completed", status: "completed" },
                { id: "cancelled", status: "cancelled" }
              ],
              total: 4,
              page: 0,
              hasMore: false
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchList()

    expect(page.data.list[0]).toMatchObject({
      journeyStage: 1,
      journeyProgress: 33,
      journeyHint: "下一步：联系客户确认需求"
    })
    expect(page.data.list[1]).toMatchObject({
      journeyStage: 2,
      journeyProgress: 67
    })
    expect(page.data.list[2]).toMatchObject({
      journeyStage: 3,
      journeyProgress: 100,
      journeyClass: "booking-journey-completed"
    })
    expect(page.data.list[3]).toMatchObject({
      journeyStage: 0,
      journeyProgress: 0,
      journeyClass: "booking-journey-cancelled"
    })
  })

  test("预约卡片使用结构化资料、原生图标和独立危险操作区", () => {
    const pageDir = path.resolve(__dirname, "../pages/booking-manage")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "booking-manage.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "booking-manage.wxss"), "utf8")

    expect(wxmlSource).toContain("booking-journey-track")
    expect(wxmlSource).toContain('aria-pressed="{{currentStatus === item.value}}"')
    expect(wxmlSource).toContain('aria-pressed="{{currentPriority === item.value}}"')
    expect(wxmlSource).toContain('aria-pressed="{{currentCoordination === item.value}}"')
    expect(wxmlSource).toContain('hover-class="workflow-chip-pressed"')
    expect(wxmlSource).toContain("booking-meta-grid")
    expect(wxmlSource).toContain("call-native-icon")
    expect(wxmlSource).toContain("detail-native-icon")
    expect(wxmlSource).toContain("save-native-icon")
    expect(wxmlSource).toContain("complete-native-icon")
    expect(wxmlSource).toContain("op-danger-row")
    expect(wxmlSource).toContain("reset-native-icon")
    expect(wxmlSource).toContain("query-native-icon")
    expect(wxmlSource).toContain("export-native-icon")
    expect(wxmlSource).toContain("export-file-native-icon")
    expect(wxmlSource).toContain("share-native-icon")
    expect(wxmlSource).toContain("open-native-icon")
    expect(wxmlSource).toContain("export-delete-native-icon")
    expect(wxmlSource).toContain("load-more-native-icon")
    expect(wxmlSource).toContain("booking-date-route-chevron")
    expect(wxmlSource).toContain("booking-recent-empty-native-icon")
    expect(wxmlSource).toContain("新预约提交后会显示在这里")
    expect(wxmlSource).toContain('class="recent-entry-chevron"')
    expect(wxmlSource).toContain('hover-class="recent-item-pressed"')
    expect(wxmlSource).toContain('aria-label="查看 {{item.vehicleName}}，{{item.userName}} 的预约详情"')
    expect(wxmlSource).not.toContain("{{item.startDate || '—'}} → {{item.endDate || '—'}}")
    expect(wxmlSource).not.toContain(">✓<")
    expect(wxssSource).toContain(".booking-journey-completed")
    expect(wxssSource).toContain(".workflow-chip-pressed")
    expect(wxssSource).toContain(".booking-meta-icon-route")
    expect(wxssSource).toContain(".booking-date-route")
    expect(wxssSource).toContain(".export-tip-title")
    expect(wxssSource).toContain(".recent-empty-native-icon")
    expect(wxssSource).toContain(".recent-item-pressed")
  })
})
