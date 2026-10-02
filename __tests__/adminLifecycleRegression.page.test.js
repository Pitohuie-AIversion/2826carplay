function loadPage(name, overrides = {}) {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  require(`../pages-admin/${name}/${name}`)
  const page = { ...definition, data: { ...JSON.parse(JSON.stringify(definition.data)), ...overrides } }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  global.getCurrentPages = () => [page]
  return page
}

describe("管理员实际输入与跨页原生回调", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    global.wx = { cloud: { callFunction: jest.fn() }, showModal: jest.fn(), showToast: jest.fn(), showLoading: jest.fn(), hideLoading: jest.fn(), navigateBack: jest.fn(), redirectTo: jest.fn() }
  })
  afterEach(() => {
    jest.useRealTimers()
    delete global.wx
    delete global.Page
    delete global.getCurrentPages
  })

  test.each(["audit-log-manage", "error-log-manage", "privacy-request-manage", "vehicle-manage"])("%s 软键盘确认立即使用事件中的最新关键词", (name) => {
    const page = loadPage(name, { loading: false, keyword: "旧关键词" })
    page.handleSearchConfirm({ detail: { value: "最新关键词" } })
    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ keyword: "最新关键词", page: 0 }) }))
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("车辆详情从编辑页返回时重读已保存资料，上传中不打断现有操作", () => {
    const page = loadPage("vehicle-detail-manage", { pageAuthorized: true, loading: false, id: "car_1", detail: { id: "car_1" } })
    page.fetchDetail = jest.fn()
    page.onShow()
    expect(page.fetchDetail).toHaveBeenCalledWith("car_1")
    page.data.uploading = true
    page.onShow()
    expect(page.fetchDetail).toHaveBeenCalledTimes(1)
  })

  test.each(["audit-log-manage", "error-log-manage", "privacy-data-inventory"])("%s 删除确认在另一个页面上返回时不删文件", (name) => {
    const unlink = jest.fn()
    wx.getFileSystemManager = () => ({ unlink })
    const page = loadPage(name, { loading: false, exportFilePath: "/tmp/report.csv", exportFileName: "report.csv" })
    page.handleDeleteExportedFile()
    const modal = wx.showModal.mock.calls[0][0]
    global.getCurrentPages = () => [page, {}]
    modal.success({ confirm: true })
    expect(unlink).not.toHaveBeenCalled()
    expect(page.data.exportFilePath).toBe("/tmp/report.csv")
    page.onUnload()
  })

  test("清理结果弹窗的完成回调等回到本页再刷新，不留下清理锁", () => {
    const page = loadPage("analytics-manage", { loading: false, canCleanup: true })
    page.fetchOverview = jest.fn()
    page.runCleanup()
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, processed: 1, deleted: 1 } })
    const modal = wx.showModal.mock.calls[0][0]
    global.getCurrentPages = () => [page, {}]
    modal.complete()
    expect(page.fetchOverview).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.cleanupLoading).toBe(false)
    expect(page.fetchOverview).toHaveBeenCalledTimes(1)
    page.onUnload()
  })

  test("新增车辆成功时若已切页，返回后才提示，迟到确认不跳转另一页", () => {
    const page = loadPage("vehicle-create", { form: { plateNumber: "京A12345", vehicleType: "sedan", brandModel: "Toyota", registerDate: "2020-01-01", status: "idle" } })
    page.handleSubmit()
    global.getCurrentPages = () => [page, {}]
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, id: "car_1" } })
    expect(wx.showModal).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    const modal = wx.showModal.mock.calls[0][0]
    global.getCurrentPages = () => [page, {}]
    modal.success({ confirm: true })
    expect(wx.redirectTo).not.toHaveBeenCalled()
    expect(wx.navigateBack).not.toHaveBeenCalled()
    page.onUnload()
  })
})
