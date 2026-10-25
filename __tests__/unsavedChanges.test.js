const { clearUnsaved, disposeUnsavedChanges, markUnsaved, syncUnsavedChanges } = require("../shared/unsavedChanges")

const FORM_PAGES = [
  "pages-admin/vehicle-create/vehicle-create.js",
  "pages-admin/vehicle-edit/vehicle-edit.js",
  "pages-admin/role-manage/role-manage.js",
  "pages-admin/config-manage/config-manage.js",
  "pages/booking/booking.js",
  "pages/privacy-request/privacy-request.js",
  "pages/booking-calendar/booking-calendar.js"
]

function createPage(relativePath) {
  let definition
  global.Page = (input) => { definition = input }
  jest.isolateModules(() => require(`../${relativePath}`))
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = (patch) => Object.assign(page.data, patch)
  page.updateBookingNavigationTitle = jest.fn()
  page.loadOperationConfig = jest.fn()
  return page
}

describe("未保存修改提醒", () => {
  beforeEach(() => {
    global.wx = {
      enableAlertBeforeUnload: jest.fn(({ success }) => success()),
      disableAlertBeforeUnload: jest.fn(({ success }) => success())
    }
  })

  afterEach(() => {
    delete global.wx
    delete global.Page
    delete global.getCurrentPages
    delete global.getApp
  })

  test("重复编辑和返回本页只启用一次提醒，保存后解除", () => {
    const page = {}
    markUnsaved(page, "资料尚未保存")
    markUnsaved(page, "资料尚未保存")
    syncUnsavedChanges(page)
    expect(page._unsavedAlertEnabled).toBe(true)
    clearUnsaved(page)
    syncUnsavedChanges(page)

    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledWith(expect.objectContaining({ message: "资料尚未保存" }))
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(page._hasUnsavedChanges).toBe(false)
    expect(page._unsavedAlertEnabled).toBe(false)
  })

  test("后台保存不关闭栈顶编辑页提醒，回到原页后同步已保存状态", () => {
    const savedPage = {}
    const editingPage = {}
    let pages = [savedPage]
    global.getCurrentPages = () => pages
    markUnsaved(savedPage)
    pages = [savedPage, editingPage]
    markUnsaved(editingPage)
    clearUnsaved(savedPage)

    expect(savedPage._hasUnsavedChanges).toBe(false)
    expect(savedPage._unsavedAlertEnabled).toBe(true)
    expect(editingPage._unsavedAlertEnabled).toBe(true)
    expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled()

    pages = [savedPage]
    syncUnsavedChanges(savedPage)
    syncUnsavedChanges(savedPage)
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(savedPage._unsavedAlertEnabled).toBe(false)
  })

  test("后台修改先同步逻辑状态，返回本页才开启对应文案提醒", () => {
    const page = {}
    global.getCurrentPages = () => [page, {}]
    markUnsaved(page, "未保存的权限")
    expect(page._hasUnsavedChanges).toBe(true)
    expect(wx.enableAlertBeforeUnload).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    syncUnsavedChanges(page)
    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledWith(expect.objectContaining({ message: "未保存的权限" }))
  })

  test.each(["enable", "disable"])("原生 %s 失败后返回本页重试，只有成功才更新实际状态", (operation) => {
    const page = {}
    if (operation === "disable") markUnsaved(page)
    const method = operation === "enable" ? "enableAlertBeforeUnload" : "disableAlertBeforeUnload"
    let request
    wx[method].mockImplementation((options) => { request = options })
    if (operation === "enable") markUnsaved(page)
    else clearUnsaved(page)
    expect(Boolean(page._unsavedAlertEnabled)).toBe(operation === "disable")
    syncUnsavedChanges(page)
    expect(wx[method]).toHaveBeenCalledTimes(1)
    request.fail()
    expect(Boolean(page._unsavedAlertEnabled)).toBe(operation === "disable")
    syncUnsavedChanges(page)
    expect(wx[method]).toHaveBeenCalledTimes(2)
    request.success()
    expect(page._unsavedAlertEnabled).toBe(operation === "enable")
    syncUnsavedChanges(page)
    expect(wx[method]).toHaveBeenCalledTimes(2)
  })

  test.each(["enable", "disable"])("原生 %s 同步抛错后仍能重试", (operation) => {
    const page = {}
    if (operation === "disable") markUnsaved(page)
    const method = operation === "enable" ? "enableAlertBeforeUnload" : "disableAlertBeforeUnload"
    wx[method].mockImplementationOnce(() => { throw new Error("native failed") })
    if (operation === "enable") markUnsaved(page)
    else clearUnsaved(page)
    expect(Boolean(page._unsavedAlertEnabled)).toBe(operation === "disable")
    syncUnsavedChanges(page)
    expect(wx[method]).toHaveBeenCalledTimes(2)
    expect(page._unsavedAlertEnabled).toBe(operation === "enable")
  })

  test("开启回调迟到不能覆盖随后关闭成功的状态", () => {
    const page = {}
    let enableRequest
    wx.enableAlertBeforeUnload.mockImplementation((options) => { enableRequest = options })
    markUnsaved(page)
    clearUnsaved(page)
    enableRequest.success()
    enableRequest.fail()
    syncUnsavedChanges(page)
    expect(page._hasUnsavedChanges).toBe(false)
    expect(page._unsavedAlertEnabled).toBe(false)
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })

  test("关闭回调迟到不能覆盖随后重新编辑开启成功的状态", () => {
    const page = {}
    let disableRequest
    markUnsaved(page)
    wx.disableAlertBeforeUnload.mockImplementation((options) => { disableRequest = options })
    clearUnsaved(page)
    markUnsaved(page)
    disableRequest.success()
    disableRequest.fail()
    syncUnsavedChanges(page)
    expect(page._hasUnsavedChanges).toBe(true)
    expect(page._unsavedAlertEnabled).toBe(true)
    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledTimes(2)
  })

  test("开启仍在处理时保存，关闭失败后保留重试资格，不采纳旧开启回调", () => {
    const page = {}
    let enableRequest
    let disableRequest
    wx.enableAlertBeforeUnload.mockImplementation((options) => { enableRequest = options })
    wx.disableAlertBeforeUnload.mockImplementation((options) => { disableRequest = options })
    markUnsaved(page)
    clearUnsaved(page)
    disableRequest.fail()
    enableRequest.success()
    syncUnsavedChanges(page)
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(2)
    disableRequest.success()
    syncUnsavedChanges(page)
    expect(page._hasUnsavedChanges).toBe(false)
    expect(page._unsavedAlertEnabled).toBe(false)
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(2)
  })

  test.each(["success", "fail"])("开启回调 %s 到达后台后不联动原生接口，返回时按已保存状态关闭", (result) => {
    const page = {}
    global.getCurrentPages = () => [page]
    let request
    wx.enableAlertBeforeUnload.mockImplementation((options) => { request = options })
    markUnsaved(page)
    global.getCurrentPages = () => [page, {}]
    clearUnsaved(page)
    request[result]()
    expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled()
    expect(Boolean(page._unsavedAlertEnabled)).toBe(false)
    global.getCurrentPages = () => [page]
    syncUnsavedChanges(page)
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(page._hasUnsavedChanges).toBe(false)
  })

  test("应用切后台时延后同步，回前台后重试", () => {
    const page = {}
    let visible = false
    global.getCurrentPages = () => [page]
    global.getApp = () => ({ globalData: { nativeActionAppVisible: visible } })
    markUnsaved(page)
    expect(wx.enableAlertBeforeUnload).not.toHaveBeenCalled()
    visible = true
    syncUnsavedChanges(page)
    expect(page._unsavedAlertEnabled).toBe(true)
  })

  test("不支持原生接口时保留草稿状态，接口恢复后可同步", () => {
    const page = {}
    const api = global.wx
    delete global.wx
    markUnsaved(page)
    expect(page._hasUnsavedChanges).toBe(true)
    global.wx = {}
    syncUnsavedChanges(page)
    global.wx = api
    syncUnsavedChanges(page)
    expect(page._unsavedAlertEnabled).toBe(true)
  })

  test("卸载不影响下一页提醒，迟到回调和后续同步均失效", () => {
    const page = {}
    let request
    wx.enableAlertBeforeUnload.mockImplementation((options) => { request = options })
    markUnsaved(page)
    disposeUnsavedChanges(page)
    request.success()
    request.fail()
    markUnsaved(page)
    syncUnsavedChanges(page)
    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled()
    expect(page._hasUnsavedChanges).toBe(false)
    expect(page._unsavedAlertEnabled).toBe(false)
  })

  test.each(FORM_PAGES)("%s 在返回时同步后台保存状态，卸载不关闭其他页面提醒", (relativePath) => {
    const page = createPage(relativePath)
    global.getCurrentPages = () => [page]
    markUnsaved(page)
    global.getCurrentPages = () => [page, {}]
    clearUnsaved(page)
    expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    markUnsaved(page)
    global.getCurrentPages = () => [{}]
    page.onUnload()
    expect(page._hasUnsavedChanges).toBe(false)
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    syncUnsavedChanges(page)
    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledTimes(2)
  })

  test.each(FORM_PAGES)("%s 返回时恢复后台草稿提醒，重复显示不重复启用", (relativePath) => {
    const page = createPage(relativePath)
    global.getCurrentPages = () => [page, {}]
    markUnsaved(page, "待保存草稿")
    expect(wx.enableAlertBeforeUnload).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    page.onShow()
    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledWith(expect.objectContaining({ message: "待保存草稿" }))
    page.onUnload()
  })
})
