jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))

const VALID_FORM = {
  plateNumber: "浙A12345", vehicleType: "sedan", brandModel: "BMW 740Li",
  registerDate: "2026-01-01", status: "idle", note: "保留未保存备注"
}

function createPage(name, overrides = {}) {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  require(`../pages-admin/${name}/${name}`)
  const page = { ...definition, data: { ...definition.data, ...overrides } }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  return page
}

describe("车辆查询快照及后台写入回执", () => {
  let stack
  beforeEach(() => {
    jest.useFakeTimers()
    stack = []
    global.getCurrentPages = () => stack
    global.wx = {
      cloud: { callFunction: jest.fn() }, showToast: jest.fn(), showModal: jest.fn(),
      showLoading: jest.fn(), hideLoading: jest.fn(), disableAlertBeforeUnload: jest.fn(),
      navigateBack: jest.fn()
    }
  })
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  function respond(index, result) {
    wx.cloud.callFunction.mock.calls[index][0].success({ result })
  }

  test("输入未确认关键词后加载更多仍使用已展示列表的筛选", () => {
    const page = createPage("vehicle-manage", { keyword: "宝马", currentStatus: "idle" })
    page.fetchList()
    respond(0, { ok: true, list: [{ id: "first" }], page: 0, hasMore: true })
    page.handleKeywordInput({ detail: { value: "奥迪" } })
    page.handleLoadMore()
    expect(wx.cloud.callFunction.mock.calls[1][0].data).toMatchObject({ keyword: "宝马", status: "idle", page: 1 })
    respond(1, { ok: true, list: [{ id: "second" }], page: 1, hasMore: false })
    expect(page.data.list.map((item) => item.id)).toEqual(["first", "second"])
  })

  test("追加请求显式改变条件时从第一页替换旧结果", () => {
    const page = createPage("vehicle-manage", { keyword: "宝马" })
    page.fetchList()
    respond(0, { ok: true, list: [{ id: "first" }], page: 0, hasMore: true })
    page.fetchList({ append: true, keyword: "奥迪" })
    expect(wx.cloud.callFunction.mock.calls[1][0].data).toMatchObject({ keyword: "奥迪", page: 0 })
    respond(1, { ok: true, list: [{ id: "replacement" }], page: 0 })
    expect(page.data.list.map((item) => item.id)).toEqual(["replacement"])
  })

  test("清空关键词不等待渲染层回调即使用空关键词检索", () => {
    const page = createPage("vehicle-manage", { keyword: "宝马" })
    page.handleClearKeyword()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction.mock.calls[0][0].data.keyword).toBe("")
  })

  test.each(["updateVehicleStatus", "retireVehicle", "restoreVehicle", "deleteVehicle"])("%s 后台成功只在回到本页后提示并刷新一次", (method) => {
    const page = createPage("vehicle-manage", { pageAuthorized: true })
    stack = [page]
    page.fetchList = jest.fn()
    if (method === "updateVehicleStatus") page[method]("car_1", "active")
    else page[method]("car_1")
    stack = [page, {}]
    if (page.onHide) page.onHide()
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    respond(0, { ok: true })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.fetchList).not.toHaveBeenCalled()
    expect(page.isVehicleMutationBusy()).toBe(true)
    stack = [page]
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(page.fetchList).toHaveBeenCalledTimes(1)
    expect(page.isVehicleMutationBusy()).toBe(false)
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
  })

  test.each(["business", "network", "timeout"])("删除 %s 失败回到本页后才显示重试对话框", (outcome) => {
    const page = createPage("vehicle-manage", { pageAuthorized: true })
    stack = [page]
    page.deleteVehicle("car_1")
    stack = [page, {}]
    if (outcome === "business") respond(0, { ok: false, code: "VEHICLE_HAS_BOOKINGS" })
    if (outcome === "network") wx.cloud.callFunction.mock.calls[0][0].fail({ errMsg: "network failed" })
    if (outcome === "timeout") jest.advanceTimersByTime(20000)
    expect(wx.showModal).not.toHaveBeenCalled()
    stack = [page]
    page.onShow()
    expect(wx.showModal).toHaveBeenCalledTimes(1)
    expect(page.data.deletingId).toBe("")
  })

  test.each(["vehicle-create", "vehicle-edit"])("%s 后台保存成功保留未保存提示直到回到本页", (name) => {
    const page = createPage(name, { id: "car_1", loading: false, form: { ...VALID_FORM } })
    page._hasUnsavedChanges = true
    page._unsavedAlertEnabled = true
    stack = [page]
    page.handleSubmit()
    stack = [page, {}]
    respond(0, { ok: true, id: "car_1", vehicleVersion: 2 })
    expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(page.data.isSubmitting).toBe(true)
    stack = [page]
    page.onShow()
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(name === "vehicle-create" ? wx.showModal : wx.showToast).toHaveBeenCalledTimes(1)
  })

  test.each(["vehicle-create", "vehicle-edit"].flatMap((name) => ["business", "network", "timeout"].map((outcome) => [name, outcome])))("%s 后台 %s 失败返回后解锁并保留表单", (name, outcome) => {
    const page = createPage(name, { id: "car_1", loading: false, form: { ...VALID_FORM } })
    stack = [page]
    page.handleSubmit()
    stack = [page, {}]
    if (outcome === "business") respond(0, { ok: false, message: "保存失败" })
    if (outcome === "network") wx.cloud.callFunction.mock.calls[0][0].fail({ errMsg: "network failed" })
    if (outcome === "timeout") jest.advanceTimersByTime(20000)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data.isSubmitting).toBe(true)
    stack = [page]
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(page.data.isSubmitting).toBe(false)
    expect(page.data.form.note).toBe(VALID_FORM.note)
    page.handleSubmit()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(2)
  })

  test("编辑版本冲突在回到本页后确认重载且仍保留用户草稿", () => {
    const page = createPage("vehicle-edit", { id: "car_1", loading: false, form: { ...VALID_FORM } })
    stack = [page]
    page.handleSubmit()
    stack = [page, {}]
    respond(0, { ok: false, code: "VERSION_CONFLICT" })
    expect(wx.showModal).not.toHaveBeenCalled()
    stack = [page]
    page.onShow()
    expect(wx.showModal).toHaveBeenCalledTimes(1)
    expect(page.data.form.note).toBe(VALID_FORM.note)
    expect(page.data.isSubmitting).toBe(false)
  })

  test("编辑页重新加载档案在后台完成时不清除其他页的未保存提示", () => {
    const page = createPage("vehicle-edit", { id: "car_1", loading: false, form: { ...VALID_FORM } })
    page._hasUnsavedChanges = true
    page._unsavedAlertEnabled = true
    stack = [page]
    page.fetchDetail("car_1")
    stack = [page, {}]
    respond(0, { ok: true, detail: { ...VALID_FORM, note: "云端已更新" } })
    expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled()
    stack = [page]
    page.onShow()
    expect(page.data.form.note).toBe("云端已更新")
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })

  test.each(["business", "network", "timeout"])("编辑档案后台 %s 加载失败显示页内错误而不跨页提示", (outcome) => {
    const page = createPage("vehicle-edit", { id: "car_1" })
    stack = [page]
    page.fetchDetail("car_1")
    stack = [page, {}]
    if (outcome === "business") respond(0, { ok: false, message: "加载失败" })
    if (outcome === "network") wx.cloud.callFunction.mock.calls[0][0].fail({ errMsg: "network failed" })
    if (outcome === "timeout") jest.advanceTimersByTime(15000)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data.loading).toBe(false)
    expect(page.data.loadFailed).toBe(true)
  })

  test.each(["vehicle-create", "vehicle-edit", "vehicle-manage"])("%s 卸载后丢弃后台回执且不再操作当前页", (name) => {
    const page = createPage(name, { id: "car_1", loading: false, form: { ...VALID_FORM } })
    stack = [page]
    if (name === "vehicle-manage") page.deleteVehicle("car_1")
    else page.handleSubmit()
    stack = [page, {}]
    respond(0, { ok: true, id: "car_1" })
    page.onUnload()
    stack = [page]
    page.onShow()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
})
