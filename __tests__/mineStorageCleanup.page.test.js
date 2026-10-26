function setup() {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  const requests = []
  global.wx = {
    cloud: { callFunction: jest.fn((options) => requests.push(options)) },
    showLoading: jest.fn(), hideLoading: jest.fn(), showToast: jest.fn(),
    showModal: jest.fn((options) => {
      if (options.title === "清理存储队列") options.success({ confirm: true })
    })
  }
  require("../pages/mine/mine")
  const page = { ...definition, data: { ...definition.data } }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  let foreground = page
  global.getCurrentPages = () => [foreground]
  const open = () => page.handleMenuTap({ currentTarget: { dataset: { key: "storageCleanup", title: "存储清理" } } })
  return { page, requests, open, leave: () => { foreground = {} } }
}
const fileResult = { ok: true, processed: 3, deleted: 2, failed: 0, preserved: 1, hasMore: true }
const resultModals = () => wx.showModal.mock.calls.map(([options]) => options).filter((options) => options.title !== "清理存储队列")

describe("用户中心管理员存储清理", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test("图片任务成功后清理上传会话，最多调用一批并分别显示两项结果", () => {
    const { requests, open, page } = setup()
    open()
    expect(requests[0]).toMatchObject({ name: "pendingFileDeletionProcess", data: { limit: 5 } })
    requests[0].success({ result: fileResult })
    expect(requests[1]).toMatchObject({ name: "adminImageUpload", data: { action: "cleanup" } })
    expect(page._mineToolActive).toBe(true)
    open()
    expect(requests).toHaveLength(2)
    requests[1].success({ result: { ok: true, removed: 50, hasMore: true } })
    expect(resultModals()).toHaveLength(1)
    expect(resultModals()[0]).toMatchObject({ title: "清理结果", content: expect.stringContaining("图片任务：本次检查 3 条，已清理 2 条") })
    expect(resultModals()[0].content).toContain("上传会话及分块：已清理 50 条过期记录。仍有记录，请再次执行清理。")
    expect(requests).toHaveLength(2)
    expect(page._mineToolActive).toBe(false)
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["business", "network", "timeout"])("第二步%s失败保留图片任务结果并明确提示部分未完成", (kind) => {
    const { requests, open } = setup()
    open()
    requests[0].success({ result: fileResult })
    if (kind === "business") requests[1].success({ result: { ok: false, code: "INTERNAL_ERROR" } })
    if (kind === "network") requests[1].fail({ errMsg: "network offline" })
    if (kind === "timeout") jest.advanceTimersByTime(65000)
    const modal = resultModals()[0]
    expect(modal.title).toBe("部分清理未完成")
    expect(modal.content).toContain("已清理 2 条")
    expect(modal.content).toContain("上传会话及分块：清理")
    expect(modal.content).toContain("请重试")
    expect(modal.content).toContain("图片任务结果已保留")
    requests[1].success({ result: { ok: true, removed: 50 } })
    expect(resultModals()).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("图片队列业务失败时不执行第二步或假报整体成功", () => {
    const { requests, open } = setup()
    open()
    requests[0].success({ result: { ok: false, message: "权限不足" } })
    expect(requests).toHaveLength(1)
    expect(resultModals()).toHaveLength(0)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "权限不足", icon: "none" })
  })

  test("切页后第一步迟到成功不会发起第二步", () => {
    const { requests, open, leave } = setup()
    open()
    leave()
    requests[0].success({ result: fileResult })
    expect(requests).toHaveLength(1)
    expect(resultModals()).toHaveLength(0)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test.each(["background", "unload"])("第二步期间%s后迟到结果与超时均不弹窗", (state) => {
    const { requests, open, leave, page } = setup()
    open()
    requests[0].success({ result: fileResult })
    if (state === "unload") page.onUnload()
    else leave()
    const hiddenBeforeCallback = wx.hideLoading.mock.calls.length
    requests[1].success({ result: { ok: true, removed: 4 } })
    requests[1].fail({ errMsg: "late failure" })
    jest.advanceTimersByTime(65000)
    expect(resultModals()).toHaveLength(0)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.hideLoading).toHaveBeenCalledTimes(hiddenBeforeCallback)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("图片存在删除失败但会话清理成功，也报告部分未完成", () => {
    const { requests, open } = setup()
    open()
    requests[0].success({ result: { ...fileResult, failed: 1 } })
    requests[1].success({ result: { ok: true, removed: 2, hasMore: false } })
    expect(resultModals()[0]).toMatchObject({ title: "部分清理未完成", content: expect.stringContaining("失败 1 条") })
    expect(resultModals()[0].content).toContain("已清理 2 条过期记录")
  })
})
