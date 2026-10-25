jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))

const CASES = [
  { name: "audit-log-manage", filter: "action", dataKey: "currentAction", value: "bookingCreate", other: "roleUpsert" },
  { name: "error-log-manage", filter: "func", dataKey: "currentFunc", value: "vehicleUpdate", other: "bookingCreate" },
  { name: "privacy-request-manage", filter: "type", dataKey: "currentType", value: "access", other: "deletion" }
]

function createPage(config) {
  jest.resetModules()
  let definition
  global.Page = (input) => { definition = input }
  global.wx = { showToast: jest.fn(), cloud: { callFunction: jest.fn() } }
  require(`../pages-admin/${config.name}/${config.name}`)
  const page = {
    ...definition,
    data: { ...definition.data, keyword: "submitted", [config.dataKey]: config.value }
  }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  global.getCurrentPages = () => [page]
  return page
}

function respond(index, page = 0, id = "first") {
  wx.cloud.callFunction.mock.calls[index][0].success({
    result: { ok: true, list: [{ id }], page, hasMore: true, total: 60, truncated: true }
  })
}

describe.each(CASES)("$name 已提交查询快照", (config) => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test("未提交的搜索草稿不影响下一页，确认搜索从新首页开始", () => {
    const page = createPage(config)
    page.fetchList()
    respond(0)
    page.handleKeywordInput({ detail: { value: "draft" } })
    page.handleLoadMore()
    expect(wx.cloud.callFunction.mock.calls[1][0].data).toMatchObject({
      keyword: "submitted", [config.filter]: config.value, page: 1
    })
    respond(1, 1, "second")
    expect(page.data.list.map((item) => item.id)).toEqual(["first", "second"])
    expect(page.data.keyword).toBe("draft")
    page.handleSearchConfirm({ detail: { value: "draft" } })
    expect(wx.cloud.callFunction.mock.calls[2][0].data).toMatchObject({ keyword: "draft", page: 0 })
    respond(2, 0, "new-query")
    expect(page.data.list.map((item) => item.id)).toEqual(["new-query"])
  })

  test.each(["business", "network"])("分页 %s 失败后保留页码及筛选并可重试", (kind) => {
    const page = createPage(config)
    page.fetchList()
    respond(0)
    page.handleLoadMore()
    respond(1, 1, "second")
    page.handleKeywordInput({ detail: { value: "draft" } })
    page.handleLoadMore()
    const request = wx.cloud.callFunction.mock.calls[2][0]
    if (kind === "business") request.success({ result: { ok: false, message: "加载失败" } })
    else request.fail({ errMsg: "offline" })
    expect(page.data).toMatchObject({ page: 1, hasMore: true, total: 60, truncated: true })
    expect(page.data.list.map((item) => item.id)).toEqual(["first", "second"])
    page.handleLoadMore()
    expect(wx.cloud.callFunction.mock.calls[3][0].data).toMatchObject({ keyword: "submitted", page: 2 })
  })

  test.each(["keyword", "filter"])("显式修改 %s 的追加请求自动从首页替换结果", (kind) => {
    const page = createPage(config)
    page.fetchList()
    respond(0)
    const changed = kind === "keyword" ? { keyword: "new-query" } : { [config.filter]: config.other }
    page.fetchList({ append: true, ...changed })
    expect(wx.cloud.callFunction.mock.calls[1][0].data).toMatchObject({ ...changed, page: 0 })
    respond(1, 0, "replacement")
    expect(page.data.list.map((item) => item.id)).toEqual(["replacement"])
  })

  test("清空及重置立即提交，不依赖渲染回调触发请求", () => {
    const page = createPage(config)
    page.handleClearKeyword()
    expect(wx.cloud.callFunction.mock.calls[0][0].data.keyword).toBe("")
    page.handleResetFilters()
    expect(wx.cloud.callFunction.mock.calls[1][0].data).toMatchObject({
      keyword: "", [config.filter]: "", page: 0,
      ...(config.filter === "type" ? { status: "pending" } : {})
    })
  })

  if (config.filter !== "type") {
    test("CSV 导出使用当前列表筛选，提交搜索后切换到新筛选", () => {
      const page = createPage(config)
      page.fetchList()
      respond(0)
      page.handleKeywordInput({ detail: { value: "draft" } })
      page.handleExport()
      const firstExport = wx.cloud.callFunction.mock.calls[1][0]
      expect(firstExport.data).toMatchObject({ keyword: "submitted", filter: config.value })
      firstExport.fail({ errMsg: "offline" })
      page.handleSearchConfirm({ detail: { value: "draft" } })
      respond(2)
      page.handleExport()
      expect(wx.cloud.callFunction.mock.calls[3][0].data.keyword).toBe("draft")
    })
  }
})
