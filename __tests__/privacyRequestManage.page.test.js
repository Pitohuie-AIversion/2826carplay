const fs = require("fs")
const path = require("path")

jest.mock("../shared/pageAuth", () => ({
  requirePagePermission: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/privacy-request-manage/privacy-request-manage")
  return definition
}

function createPage(definition, list = []) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      list
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

describe("pages/privacy-request-manage", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("未生成个人数据的查询申请不提供完成操作", () => {
    global.wx = {
      showActionSheet: jest.fn()
    }
    const item = {
      id: "request_1",
      type: "access",
      status: "pending",
      canHandle: true,
      dataExportedAt: ""
    }
    const page = createPage(loadPageDefinition(), [item])

    page.handleRequestAction({
      currentTarget: {
        dataset: { id: "request_1" }
      }
    })

    expect(global.wx.showActionSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        alertText: "选择申请处理结果",
        itemList: ["标记为处理中", "驳回申请"],
        itemColor: "#528fff"
      })
    )
  })

  test("首次加载使用管理申请卡片骨架", () => {
    const pageDir = path.resolve(__dirname, "../pages/privacy-request-manage")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "privacy-request-manage.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "privacy-request-manage.wxss"), "utf8")

    expect(wxmlSource).toContain('class="manage-request-skeleton"')
    expect(wxmlSource).toContain("manage-request-skeleton-card")
    expect(wxmlSource).toContain('aria-hidden="true"')
    expect(wxmlSource).not.toContain("正在加载申请…")
    expect(wxssSource).toContain(".manage-request-skeleton-actions")
  })

  test("已生成个人数据的查询申请允许完成", () => {
    global.wx = {
      showActionSheet: jest.fn()
    }
    const item = {
      id: "request_1",
      type: "access",
      status: "processing",
      canHandle: true,
      dataExportedAt: "2026-07-30T08:00:00.000Z"
    }
    const page = createPage(loadPageDefinition(), [item])

    page.handleRequestAction({
      currentTarget: {
        dataset: { id: "request_1" }
      }
    })

    expect(global.wx.showActionSheet).toHaveBeenCalledWith(
      expect.objectContaining({
        alertText: "选择申请处理结果",
        itemList: ["完成申请", "驳回申请"],
        itemColor: "#528fff"
      })
    )
  })

  test("申请状态映射为三阶段处理轨迹和下一步提示", () => {
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
                { id: "pending", type: "correction", status: "pending" },
                { id: "processing", type: "access", status: "processing", dataExportedAt: "" },
                { id: "completed", type: "access", status: "completed", dataExportedAt: "2026-08-01T08:00:00.000Z" },
                { id: "rejected", type: "deletion", status: "rejected" },
                { id: "cancelled", type: "correction", status: "cancelled" }
              ]
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchList()

    expect(page.data.list[0]).toMatchObject({
      typeLabel: "更正信息",
      typeIconClass: "request-type-icon-correction",
      journeyStage: 1,
      journeyProgress: 33,
      journeyClass: "request-journey-pending"
    })
    expect(page.data.list[1]).toMatchObject({
      journeyStage: 2,
      journeyProgress: 67,
      journeyHint: "下一步：核验并导出个人数据"
    })
    expect(page.data.list[2]).toMatchObject({
      journeyStage: 3,
      journeyProgress: 100,
      journeyClass: "request-journey-completed"
    })
    expect(page.data.list[3].journeyClass).toBe("request-journey-rejected")
    expect(page.data.list[4].journeyHint).toBe("用户已撤回，无需继续处理")
  })

  test("申请卡片使用原生图标、分层内容和独立处理轨迹", () => {
    const pageDir = path.resolve(__dirname, "../pages/privacy-request-manage")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "privacy-request-manage.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "privacy-request-manage.wxss"), "utf8")

    expect(wxmlSource).toContain('class="request-journey {{item.journeyClass}}"')
    expect(wxmlSource).toContain('aria-pressed="{{currentStatus === item.value}}"')
    expect(wxmlSource).toContain('aria-pressed="{{currentType === item.value}}"')
    expect(wxmlSource).toContain('scroll-into-view="privacy-status-{{currentStatus}}"')
    expect(wxmlSource).toContain('scroll-into-view="privacy-type-{{currentType}}"')
    expect(wxmlSource).toContain('id="privacy-status-{{item.value}}"')
    expect(wxmlSource).toContain('id="privacy-type-{{item.value}}"')
    expect(wxmlSource).toContain('class="request-type-icon {{item.typeIconClass}}"')
    expect(wxmlSource).toContain('class="identity-native-icon"')
    expect(wxmlSource).toContain('class="copy-native-icon"')
    expect(wxmlSource).toContain('class="description-native-icon"')
    expect(wxmlSource).toContain('class="delivery-native-icon {{item.dataExportedAt ?')
    expect(wxmlSource).toContain('class="inventory-native-icon"')
    expect(wxmlSource).toContain('class="handle-native-icon"')
    expect(wxmlSource).toContain("{{updatingId === item.id ? '处理中…' : '处理申请'}}")
    expect(wxmlSource).toContain("{{loading ? '正在加载' : '加载更多'}}")
    expect(wxmlSource).toContain('bindtap="handleResetFilters"')
    expect(wxmlSource).not.toMatch(/>\s*[✓✔]\s*</)
    expect(wxssSource).toContain(".request-journey-progress")
    expect(wxssSource).toContain(".request-status-rejected::before")
    expect(wxssSource).toContain(".filter-result-bar")
  })

  test("重置筛选恢复默认待处理队列并重新加载", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({ result: { ok: true, page: 0, total: 0, list: [] } })
        })
      }
    }
    const page = createPage(loadPageDefinition())
    page.data.keyword = "request_1"
    page.data.currentType = "deletion"
    page.data.currentStatus = "completed"
    page.data.currentTypeLabel = "删除"
    page.data.currentStatusLabel = "已完成"

    page.handleResetFilters()

    expect(page.data.keyword).toBe("")
    expect(page.data.currentType).toBe("all")
    expect(page.data.currentStatus).toBe("pending")
    expect(page.data.currentTypeLabel).toBe("全部类型")
    expect(page.data.currentStatusLabel).toBe("待处理")
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "privacyRequestList",
      data: expect.objectContaining({ type: "", status: "pending", keyword: "" })
    }))
  })
})
