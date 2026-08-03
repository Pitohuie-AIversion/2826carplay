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
    delete global.Page
    delete global.wx
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

    page.fetchList = jest.fn()
    page.handleReset()
    expect(page.data).toEqual(expect.objectContaining({
      keyword: "",
      currentStatus: "all",
      currentPriority: "all",
      currentCoordination: "all"
    }))
    expect(page.fetchList).toHaveBeenCalledTimes(1)
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
