jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))

describe("隐私申请管理的已确认处理结果与列表恢复", () => {
  let page
  let stack
  let requests
  const request = { id: "request_a", openid: "openid_a", type: "correction", status: "pending", description: "更正联系信息" }
  const other = { ...request, id: "request_b" }

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    global.wx = {
      cloud: { callFunction: jest.fn((options) => requests.push(options)) },
      showToast: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages-admin/privacy-request-manage/privacy-request-manage")
    stack = [page]
    global.getCurrentPages = () => stack
    Object.assign(page.data, { pageAuthorized: true, currentStatus: "all", keyword: "openid_a" })
    page.fetchList()
    requests[0].success({ result: { ok: true, page: 0, list: [request, other], total: 4, hasMore: true } })
    requests = []
  })

  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  function completeWrite(background = false) {
    page.updateStatus(page.data.list[0], "completed", "  已核验并更正  ")
    if (background) {
      page.onHide()
      stack = [page, {}]
    }
    page.setData.mockClear()
    wx.showToast.mockClear()
    requests[0].success({ result: { ok: true, id: request.id, status: "completed", updated: true } })
    if (background) {
      expect(page.setData).not.toHaveBeenCalled()
      expect(wx.showToast).not.toHaveBeenCalled()
      expect(requests).toHaveLength(1)
      stack = [page]
      page.onShow()
    }
  }

  test.each([false, true].flatMap((background) => ["network", "business", "malformed", "timeout"].map((failure) => [background, failure])))(
    "处理结果在刷新失败后保持且重试接受权威列表；后台=%s，失败=%s", (background, failure) => {
      completeWrite(background)
      const confirmed = { id: request.id, status: "completed", resolutionNote: "已核验并更正", canHandle: false, journeyStage: 3 }
      expect(page.data.list[0]).toMatchObject(confirmed)
      expect(page.data.total).toBe(4)
      expect(requests[1].data).toMatchObject({ keyword: "openid_a", status: "", page: 0 })
      if (failure === "network") requests[1].fail(new Error("offline"))
      else if (failure === "business") requests[1].success({ result: { ok: false, message: "服务暂不可用" } })
      else if (failure === "malformed") requests[1].success({ result: { ok: true, list: null } })
      else jest.advanceTimersByTime(15000)
      expect(page.data.list[0]).toMatchObject(confirmed)
      expect(page.data.total).toBe(4)
      expect(page.data.loading).toBe(false)
      expect(page.data.updatingId).toBe("")
      page.handleLoadMore()
      expect(requests[2].data.page).toBe(0)
      requests[2].success({ result: { ok: true, page: 0, list: [{ ...request, status: "completed", resolutionNote: "服务端最新说明" }], total: 1, hasMore: false } })
      expect(page.data.list).toHaveLength(1)
      expect(page.data.list[0].resolutionNote).toBe("服务端最新说明")
      expect(page.data.total).toBe(1)
    }
  )

  test("待处理队列移除已完成申请，幂等重复回调不重复扣减数量", () => {
    page.handleStatusTap({ currentTarget: { dataset: { value: "pending" } } })
    requests[0].success({ result: { ok: true, page: 0, list: [request, other], total: 4, hasMore: true } })
    requests = []
    completeWrite()
    expect(page.data.list.map((item) => item.id)).toEqual([other.id])
    expect(page.data.total).toBe(3)
    requests[0].success({ result: { ok: true, id: request.id, status: "completed", updated: false } })
    expect(requests).toHaveLength(2)
    expect(page.data.total).toBe(3)
    requests[1].fail(new Error("offline"))
    expect(page.data.list.map((item) => item.id)).toEqual([other.id])
    expect(page.data.total).toBe(3)
  })

  test("处理后的自动刷新使用已提交筛选，保留尚未搜索的关键词草稿", () => {
    page.handleKeywordInput({ detail: { value: "未提交的搜索" } })
    completeWrite()
    expect(requests[1].data.keyword).toBe("openid_a")
    expect(page.data.keyword).toBe("未提交的搜索")
  })

  test("切换筛选后失败不会在新队列中保留旧队列及数量", () => {
    completeWrite()
    requests[1].fail(new Error("offline"))
    page.handleStatusTap({ currentTarget: { dataset: { value: "rejected" } } })
    expect(requests[2].data).toMatchObject({ status: "rejected", page: 0 })
    requests[2].fail(new Error("offline"))
    expect(page.data.list).toEqual([])
    expect(page.data.total).toBe(0)
    expect(page.data.page).toBe(0)
    expect(page.data.hasMore).toBe(false)
  })

  test("读取返回权限拒绝时清除已确认敏感记录及计数", () => {
    completeWrite()
    requests[1].success({ result: { ok: false, code: "FORBIDDEN", message: "权限不足" } })
    expect(page.data.list).toEqual([])
    expect(page.data.total).toBe(0)
    expect(page.data.hasMore).toBe(false)
  })

  test("已确认结果保留期间下一次处理返回权限拒绝也清除敏感记录", () => {
    completeWrite()
    requests[1].fail(new Error("offline"))
    page.updateStatus(page.data.list[1], "processing", "")
    requests[2].success({ result: { ok: false, code: "FORBIDDEN", message: "权限不足" } })
    expect(page.data.list).toEqual([])
    expect(page.data.total).toBe(0)
    expect(page.data.hasMore).toBe(false)
    expect(page.data.updatingId).toBe("")
  })

  test("幂等重试成功确认相同状态和说明，不插入或增加队列总数", () => {
    page.updateStatus(page.data.list[0], "completed", "  已更正  ")
    requests[0].success({ result: { ok: true, id: request.id, status: "completed", updated: false } })
    requests[1].fail(new Error("offline"))
    expect(page.data.list).toHaveLength(2)
    expect(page.data.list[0]).toMatchObject({ id: request.id, status: "completed", resolutionNote: "已更正", canHandle: false })
    expect(page.data.total).toBe(4)
  })

  test.each([
    {},
    { id: "another_id", status: "completed" },
    { id: request.id },
    { id: request.id, status: "unknown" },
    { id: request.id, status: "processing" }
  ])("成功回执缺少对应的真实 id/status 时不伪造已确认状态：%j", (result) => {
    page.updateStatus(page.data.list[0], "completed", "已更正")
    requests[0].success({ result: { ok: true, ...result } })
    expect(page.data.list[0].status).toBe("pending")
    expect(page.data.list[0].resolutionNote).toBeUndefined()
    expect(requests[1].name).toBe("privacyRequestList")
  })

  test("首次授权读取尚未完成时 onShow 不重复请求", () => {
    page.data.hasLoaded = false
    page.fetchList()
    page.onShow()
    expect(requests).toHaveLength(1)
  })

  test.each([false, true])("返回页面替换离开前的在途读取，旧回执不再覆盖数据；追加=%s", (append) => {
    const done = jest.fn()
    page.fetchList({ append, done })
    page.handleKeywordInput({ detail: { value: "搜索草稿" } })
    page.onHide()
    stack = [page, {}]
    stack = [page]
    page.onShow()
    expect(requests).toHaveLength(2)
    expect(requests[1].data).toMatchObject({ keyword: "openid_a", page: 0 })
    expect(done).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
    requests[1].success({ result: { ok: true, page: 0, list: [{ ...request, dataExportedAt: "2026-10-27T08:00:00.000Z" }], total: 1, hasMore: false } })
    requests[0].success({ result: { ok: true, page: append ? 1 : 0, list: [other], total: 4, hasMore: true } })
    requests[0].fail(new Error("stale failure"))
    expect(page.data.list).toHaveLength(1)
    expect(page.data.list[0]).toMatchObject({ id: request.id, dataExportedAt: "2026-10-27T08:00:00.000Z" })
    expect(page.data.keyword).toBe("搜索草稿")
    expect(page.data.total).toBe(1)
    expect(done).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("返回后的替代读取卸载时只收尾一次，迟到回执不写页面", () => {
    const done = jest.fn()
    page.fetchList({ done })
    page.onHide()
    page.onShow()
    page.onUnload()
    page.setData.mockClear()
    requests[0].success({ result: { ok: true, list: [other] } })
    requests[1].success({ result: { ok: true, list: [other] } })
    requests[1].fail(new Error("late failure"))
    expect(page.setData).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })
})
