jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  clearPagePermissionCache: jest.fn(),
  requirePagePermission: jest.fn()
}))

describe("role list recovery", () => {
  let page
  let requests
  const savedList = [{ id: "role_1", openid: "member_1", permissions: ["vehicle_manage"] }]

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    global.wx = {
      showToast: jest.fn(), stopPullDownRefresh: jest.fn(),
      cloud: { callFunction: jest.fn((options) => requests.push(options)) }
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages-admin/role-manage/role-manage")
    global.getCurrentPages = () => [page]
    Object.assign(page.data, { pageAuthorized: true, initialLoading: false, list: savedList, page: 2, hasMore: true, formOpenid: "draft_member", selectedPermissions: ["booking_manage"] })
  })

  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test.each(["network", "server", "timeout", "malformed", "malformedItem"])("刷新 %s 失败保留角色和草稿，重试从首页重新加载", (failure) => {
    page.onPullDownRefresh()
    if (failure === "network") requests[0].fail({ errMsg: "网络不可用" })
    else if (failure === "server") requests[0].success({ result: { ok: false, message: "服务暂不可用" } })
    else if (failure === "malformed") requests[0].success({ result: { ok: true, list: null } })
    else if (failure === "malformedItem") requests[0].success({ result: { ok: true, list: [null] } })
    else jest.advanceTimersByTime(15000)
    expect(page.data.list).toBe(savedList)
    expect(page.data).toMatchObject({ page: 2, hasMore: true, loading: false, initialLoading: false, formOpenid: "draft_member", selectedPermissions: ["booking_manage"] })
    expect(page.data.listError).toBeTruthy()
    expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
    page.handleRetryRoleList()
    expect(requests[1].data.page).toBe(0)
    requests[1].success({ result: { ok: true, list: [{ id: "role_2", openid: "member_2", permissions: [] }], page: 0, hasMore: false } })
    expect(page.data.list.map((item) => item.openid)).toEqual(["member_2"])
    expect(page.data.listError).toBe("")
    expect(page.data.formOpenid).toBe("draft_member")
  })

  test("追加失败重试原页，重复点击与旧失败不会打断新请求", () => {
    page.handleLoadMore()
    requests[0].fail({ errMsg: "读取中断" })
    expect(page.data.listError).toBeTruthy()
    page.handleRetryRoleList()
    page.handleRetryRoleList()
    requests[0].fail({ errMsg: "旧失败" })
    expect(requests).toHaveLength(2)
    expect(requests[1].data.page).toBe(3)
    expect(page.data.loading).toBe(true)
    requests[1].success({ result: { ok: true, list: [{ id: "role_2", openid: "member_2", permissions: [] }], page: 3, hasMore: false } })
    expect(page.data.list.map((item) => item.openid)).toEqual(["member_1", "member_2"])
    expect(page.data.listError).toBe("")
  })

  test("初次后台加载失败保留可见错误，返回后可重试且空列表成功清除错误", () => {
    Object.assign(page.data, { initialLoading: true, list: [], page: 0, hasMore: false })
    page.fetchRoleList()
    global.getCurrentPages = () => [page, {}]
    requests[0].fail({ errMsg: "读取中断" })
    expect(page.data.listError).toBe("读取中断")
    expect(wx.showToast).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    page.handleRetryRoleList()
    requests[1].success({ result: { ok: true, list: [], page: 0, hasMore: false } })
    expect(page.data).toMatchObject({ list: [], listError: "", loading: false })
  })

  test("服务端拒绝访问时清除旧角色，不显示为成功的空列表", () => {
    page.fetchRoleList()
    requests[0].success({ result: { ok: false, code: "FORBIDDEN", message: "权限不足" } })
    expect(page.data).toMatchObject({ list: [], hasMore: false, page: 0, listError: "权限不足" })
  })

  test("部分名单的提示在刷新失败后保留，完整加载成功后清除", () => {
    page.fetchRoleList()
    requests[0].success({ result: { ok: true, list: savedList, page: 0, hasMore: false, truncated: true } })
    expect(page.data.listTruncated).toBe(true)
    page.fetchRoleList()
    requests[1].fail({ errMsg: "网络不可用" })
    expect(page.data.listTruncated).toBe(true)
    page.handleRetryRoleList()
    requests[2].success({ result: { ok: true, list: savedList, page: 0, hasMore: false, truncated: false } })
    expect(page.data.listTruncated).toBe(false)
  })
})
