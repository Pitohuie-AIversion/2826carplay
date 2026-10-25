function loadWorkbench(overrides = {}) {
  jest.resetModules()
  let definition
  global.Page = (input) => { definition = input }
  global.wx = {
    showToast: jest.fn(),
    showModal: jest.fn(),
    cloud: { callFunction: jest.fn() }
  }
  require("../pages/booking-workbench/booking-workbench")
  const page = { ...definition, data: { ...definition.data, loading: false, pageAuthorized: true, ...overrides } }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  global.getCurrentPages = () => [page]
  return page
}

describe("工作台后台写入结果恢复", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.wx
    delete global.Page
    delete global.getCurrentPages
  })

  test.each(["成功", "业务失败", "网络失败", "超时"])("备注%s在切页后不修改表单或弹提示，返回后只处理一次", (outcome) => {
    const page = loadWorkbench({
      allBookings: [{ id: "booking_1", status: "pending", adminRemark: "旧备注" }],
      editingRemarkId: "booking_1",
      remarkDraft: "新备注"
    })
    page.handleSaveRemark()
    const request = wx.cloud.callFunction.mock.calls[0][0]
    global.getCurrentPages = () => [{}]
    page.setData.mockClear()
    if (outcome === "成功") request.success({ result: { ok: true } })
    if (outcome === "业务失败") request.success({ result: { ok: false, message: "备注已被其他管理员修改" } })
    if (outcome === "网络失败") request.fail({ errMsg: "网络不可用" })
    if (outcome === "超时") jest.advanceTimersByTime(20000)

    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)

    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.savingRemark).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(page.data.remarkDraft).toBe(outcome === "成功" ? "" : "新备注")
    if (outcome === "成功") {
      expect(wx.cloud.callFunction.mock.calls[1][0].name).toBe("bookingList")
    }
    request.success({ result: { ok: true } })
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("已联系的订阅失败提醒等返回后显示，提醒回调切页后也延迟刷新", () => {
    const page = loadWorkbench()
    page.updateContactedStatus("booking_1")
    const request = wx.cloud.callFunction.mock.calls[0][0]
    global.getCurrentPages = () => [{}]
    page.setData.mockClear()
    request.success({ result: { ok: true, notificationStatus: "failed" } })
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(page.setData).not.toHaveBeenCalled()

    global.getCurrentPages = () => [page]
    page.onShow()
    expect(wx.showModal).toHaveBeenCalledTimes(1)
    expect(page.data.statusUpdatingId).toBe("booking_1")
    const feedback = wx.showModal.mock.calls[0][0]
    global.getCurrentPages = () => [{}]
    page.setData.mockClear()
    feedback.complete()
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)

    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.statusUpdatingId).toBe("")
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(2)
    expect(wx.cloud.callFunction.mock.calls[1][0].name).toBe("bookingList")
    feedback.complete()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(2)
    page.onUnload()
  })

  test("后台完成的写入在卸载后丢弃，不重放提示或请求", () => {
    const page = loadWorkbench()
    page.updateCoordination({ id: "booking_1", coordinationStatus: "coordinating" })
    global.getCurrentPages = () => [{}]
    const request = wx.cloud.callFunction.mock.calls[0][0]
    request.success({ result: { ok: true } })
    page.onUnload()
    page.setData.mockClear()
    request.success({ result: { ok: true } })
    expect(page._workbenchWriteResume).toBeNull()
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("空工作台重新显示也拉取新预约，请求期间不重复拉取", () => {
    const page = loadWorkbench()
    page.onShow()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    page.onShow()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, list: [{ id: "new_booking", status: "pending" }] } })
    expect(page.data.queue.map((item) => item.id)).toEqual(["new_booking"])
    page.onUnload()
  })
})
