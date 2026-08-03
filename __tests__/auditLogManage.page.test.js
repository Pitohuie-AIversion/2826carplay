jest.mock("../shared/pageAuth", () => ({
  requirePagePermission: jest.fn()
}))

const fs = require("fs")
const path = require("path")

jest.mock("../shared/csvFile", () => ({
  canShareCsvFile: jest.fn(() => true),
  getErrorMessage: jest.fn(() => ""),
  openCsvFile: jest.fn(),
  removeCsvFile: jest.fn(),
  saveCsvFile: jest.fn(),
  shareCsvFile: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/audit-log-manage/audit-log-manage")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data
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

describe("pages/audit-log-manage 安全摘要展示", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("协调、备注和导出审计展示安全摘要字段", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              page: 0,
              total: 3,
              hasMore: false,
              truncated: false,
              list: [
                {
                  id: "a1",
                  action: "bookingUpdateCoordination",
                  bookingId: "booking_1",
                  fromPriority: "normal",
                  toPriority: "priority",
                  fromCoordinationStatus: "pending",
                  toCoordinationStatus: "coordinating",
                  createdAt: "2026-07-30T08:00:00.000Z"
                },
                {
                  id: "a2",
                  action: "bookingUpdateAdminRemark",
                  bookingId: "booking_2",
                  remarkLength: 18,
                  createdAt: "2026-07-30T08:01:00.000Z"
                },
                {
                  id: "a3",
                  action: "bookingExportCsv",
                  status: "pending",
                  schedulePriority: "standby",
                  coordinationStatus: "resolved",
                  total: 12,
                  createdAt: "2026-07-30T08:02:00.000Z"
                }
              ]
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchList()

    expect(page.data.list[0].summary).toContain("常规 → 优先")
    expect(page.data.list[0].summary).toContain("待协调 → 协调中")
    expect(page.data.list[1].summary).toContain("备注长度：18")
    expect(page.data.list[2].summary).toContain("候补")
    expect(page.data.list[2].summary).toContain("已协调")
    expect(page.data.list[2].summary).toContain("导出条数：12")
  })

  test("审计动作映射为中文事件分组和结构化详情", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              page: 0,
              total: 4,
              hasMore: false,
              truncated: false,
              list: [
                { id: "access", action: "roleUpsert", targetOpenid: "openid_1", toPermissions: ["admin"] },
                { id: "vehicle", action: "vehicleCreate", vehicleId: "vehicle_1", brandModel: "GT" },
                { id: "booking", action: "bookingCreate", bookingId: "booking_1", vehicleId: "vehicle_1" },
                { id: "privacy", action: "privacyRequestCreate", requestId: "request_1", requestType: "access" }
              ]
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchList()

    expect(page.data.list.map((item) => item.eventGroup)).toEqual([
      "权限安全",
      "车辆管理",
      "预约服务",
      "隐私服务"
    ])
    expect(page.data.list[0]).toMatchObject({
      eventLabel: "权限分配",
      eventClass: "audit-event-access",
      eventIconClass: "audit-event-icon-access"
    })
    expect(page.data.list[1].summaryRows).toEqual([
      { label: "车辆", value: "vehicle_1" },
      { label: "车型", value: "GT" }
    ])
  })

  test("审计时间线使用原生图标并支持一键重置筛选", () => {
    const pageDir = path.join(__dirname, "..", "pages", "audit-log-manage")
    const wxml = fs.readFileSync(path.join(pageDir, "audit-log-manage.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "audit-log-manage.wxss"), "utf8")

    expect(wxml).toContain('class="audit-timeline"')
    expect(wxml).toContain("{{item.eventLabel}}")
    expect(wxml).toContain("{{item.summaryRows}}")
    expect(wxml).toContain('class="operator-native-icon"')
    expect(wxml).toContain('class="time-native-icon"')
    expect(wxml).toContain('class="button-native-icon query-native-icon"')
    expect(wxml).toContain('class="export-action-icon delete-native-icon"')
    expect(wxml).toContain('class="load-more-native-icon"')
    expect(wxml).toContain('class="load-complete-native-icon"')
    expect(wxml).toContain('bindtap="handleResetFilters"')
    expect(wxml).toContain('aria-pressed="{{currentAction === item.value}}"')
    expect(wxml).toContain('scroll-into-view="audit-action-{{currentAction}}"')
    expect(wxml).toContain('id="audit-action-{{item.value}}"')
    expect(wxml).toContain("{{exporting ? '正在导出' : '导出 CSV'}}")
    expect(wxml).not.toContain('bindtap="handleLoadMore">加载更多</button>')
    expect(wxml).not.toMatch(/>\s*[✓✔]\s*</)
    expect(wxss).toMatch(/\.audit-page\.management-page \.log-action\s*\{[^}]*-webkit-line-clamp:\s*2/s)
    expect(wxss).toContain(".audit-event-icon-vehicle")
    expect(wxss).toContain(".log-detail-grid")
    expect(wxss).toContain(".filter-result-bar")
    expect(wxss).toContain(".log-action-content")
  })

  test("重置筛选恢复全部操作并重新加载", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({ result: { ok: true, page: 0, total: 0, list: [] } })
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.data.keyword = "booking_1"
    page.data.currentAction = "bookingCreate"
    page.data.currentActionLabel = "预约创建"

    page.handleResetFilters()

    expect(page.data.keyword).toBe("")
    expect(page.data.currentAction).toBe("all")
    expect(page.data.currentActionLabel).toBe("全部操作")
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "auditLogList",
      data: expect.objectContaining({ action: "", keyword: "" })
    }))
  })
})
