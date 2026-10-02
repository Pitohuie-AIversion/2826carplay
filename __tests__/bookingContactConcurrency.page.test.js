describe("客户联系信息编辑基线与保存回填", () => {
  let page
  let requests
  let stack
  const original = { id: "booking_1", status: "pending", userName: "张三", phone: "13800000000", city: "杭州", note: "旧备注", pickupLocation: "旧取车点", location: "历史地址", returnLocation: "旧还车点" }
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    global.wx = { cloud: { callFunction: jest.fn((options) => requests.push(options)) }, showToast: jest.fn(), setStorageSync: jest.fn() }
    global.Page = (definition) => {
      page = { ...definition, data: { ...definition.data, id: original.id } }
      page.setData = jest.fn((patch) => {
        for (const [key, value] of Object.entries(patch)) {
          if (key.startsWith("editForm.")) page.data.editForm[key.slice(9)] = value
          else page.data[key] = value
        }
      })
    }
    require("../pages/booking-detail/booking-detail")
    stack = [page]
    global.getCurrentPages = () => stack
    page.applyBooking({ ...original })
    page.handleStartEdit()
    page.handleEditInput({ currentTarget: { dataset: { field: "phone" } }, detail: { value: "13900000000" } })
  })
  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test("保存冲突保留原基线和草稿，不自动刷新后覆盖其他编辑", () => {
    page.loadDetail = jest.fn()
    page.handleSaveEdit()
    expect(requests[0].data).toMatchObject({ phone: "13900000000", expectedValues: { userName: "张三", phone: "13800000000", city: "杭州", note: "旧备注" } })
    requests[0].success({ result: { ok: false, code: "CONTACT_CONFLICT", message: "联系信息已修改，请取消编辑后刷新核对" } })
    expect(page.data.editing).toBe(true)
    expect(page.data.editForm.phone).toBe("13900000000")
    expect(page.data.contactSaveError).toContain("刷新核对")
    expect(page.loadDetail).not.toHaveBeenCalled()
    page.handleSaveEdit()
    expect(requests[1].data.expectedValues).toEqual(requests[0].data.expectedValues)
    requests[1].fail({ errMsg: "network" })
  })

  test.each(["network", "server", "timeout", "success"])("后台保存%s不向其他页面弹提示，成功按服务端地点回填", (result) => {
    page.loadDetail = jest.fn()
    page.handleSaveEdit()
    stack = [page, {}]
    if (result === "network") requests[0].fail({ errMsg: "network" })
    else if (result === "timeout") jest.advanceTimersByTime(12000)
    else requests[0].success({ result: result === "success" ? {
      ok: true, updated: true, status: "contacted",
      contact: { userName: "张三", phone: "13900000000", city: "杭州", note: "旧备注", pickupLocation: "顾问最新取车点", location: "", returnLocation: "顾问最新还车点" }
    } : { ok: false, code: "CONTACT_CONFLICT" } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.loadDetail).not.toHaveBeenCalled()
    expect(page.data.saving).toBe(false)
    if (result === "success") {
      expect(page.data.editing).toBe(false)
      expect(page.data.booking).toMatchObject({ status: "contacted", pickupLocation: "顾问最新取车点", returnLocation: "顾问最新还车点", location: "" })
      expect(wx.setStorageSync.mock.calls.at(-1)[1].booking.returnLocation).toBe("顾问最新还车点")
    } else expect(page.data.editing).toBe(true)
  })

  test("切换预约后旧保存回执不能改写新预约", () => {
    page.handleSaveEdit()
    page.data.id = "booking_2"
    page.applyBooking({ ...original, id: "booking_2", city: "上海" })
    page.setData.mockClear()
    requests[0].success({ result: { ok: true, updated: true } })
    expect(page.setData).not.toHaveBeenCalled()
    expect(page.data.booking.city).toBe("上海")
    expect(wx.showToast).not.toHaveBeenCalled()
  })
})
