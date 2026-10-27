describe("my bookings cancellation and returning list requests", () => {
  let page
  let stack
  let requests
  let modals
  let storage
  const booking = { id: "booking_1", status: "pending", vehicleName: "预约车辆", city: "杭州" }

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    modals = []
    storage = new Map()
    global.getApp = () => ({ globalData: {} })
    global.wx = {
      cloud: { callFunction: jest.fn((options) => requests.push(options)) },
      showToast: jest.fn(),
      showModal: jest.fn((options) => modals.push(options)),
      navigateTo: jest.fn(),
      stopPullDownRefresh: jest.fn(),
      getStorageSync: (key) => storage.get(key),
      setStorageSync: jest.fn((key, value) => storage.set(key, value))
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages/bookings/bookings")
    stack = [page]
    global.getCurrentPages = () => stack
    page.loadList()
    requests[0].success({ result: { ok: true, list: [{ ...booking }], page: 0, hasMore: true } })
    requests = []
    wx.cloud.callFunction.mockClear()
  })

  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  test.each([false, true])("returning from detail replaces the pending list read; append=%s", (append) => {
    const done = jest.fn()
    page.loadList({ append, done })
    page.handleViewDetail({ currentTarget: { dataset: { id: booking.id } } })
    stack = [page, {}]
    stack = [page]
    page.onShow()
    expect(requests).toHaveLength(2)
    expect(requests[1].data.page).toBe(0)
    expect(done).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(1)
    requests[1].success({ result: { ok: true, list: [{ ...booking, status: "cancelled" }], page: 0, hasMore: false } })
    requests[0].success({ result: { ok: true, list: [{ ...booking }], page: append ? 1 : 0, hasMore: true } })
    expect(page.data.list).toHaveLength(1)
    expect(page.data.list[0]).toMatchObject({ status: "cancelled", canCancel: false })
    expect(page.data.listSummary).toEqual({ ongoing: 0, completed: 0, cancelled: 1 })
    expect(page.data.page).toBe(0)
    expect(page.data.hasMore).toBe(false)
    expect(storage.get("bookings_last_snapshot")[0].status).toBe("cancelled")
    expect(done).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each([
    [false, "network"], [true, "network"],
    [false, "business"], [true, "business"],
    [false, "timeout"], [true, "timeout"]
  ])("successful cancellation survives failed refresh and updates the snapshot; background=%s failure=%s", (background, failure) => {
    page.handleFilterTap({ currentTarget: { dataset: { filter: "ongoing" } } })
    page.handleCancel({ currentTarget: { dataset: { id: booking.id } } })
    modals[0].success({ confirm: true })
    expect(requests[0].name).toBe("bookingCancel")
    if (background) stack = [page, {}]
    requests[0].success({ result: { ok: true, id: booking.id, status: "cancelled" } })
    expect(page.data.list[0]).toMatchObject({ status: "cancelled", canCancel: false })
    expect(page.data.visibleList).toEqual([])
    expect(page.data.listSummary).toEqual({ ongoing: 0, completed: 0, cancelled: 1 })
    expect(storage.get("bookings_last_snapshot")[0].status).toBe("cancelled")
    if (background) {
      expect(wx.showToast).not.toHaveBeenCalled()
      expect(requests).toHaveLength(1)
      stack = [page]
      page.onShow()
    }
    expect(wx.showToast).toHaveBeenCalledWith({ title: "预约已取消", icon: "none" })
    expect(requests[1].name).toBe("bookingMyList")
    if (failure === "network") requests[1].fail(new Error("refresh unavailable"))
    else if (failure === "business") requests[1].success({ result: { ok: false, message: "服务暂不可用" } })
    else jest.advanceTimersByTime(15000)
    expect(page.data.list[0]).toMatchObject({ status: "cancelled", canCancel: false })
    expect(page.data.visibleList).toEqual([])
    expect(page.data.loading).toBe(false)
    expect(page.data.loadFailed).toBe(true)
    expect(storage.get("bookings_last_snapshot")[0].status).toBe("cancelled")
    page.handleRetryLoad()
    expect(requests[2].data.page).toBe(0)
    requests[2].success({ result: { ok: true, page: 0, hasMore: false, list: [{ ...booking, status: "cancelled", note: "最新详情" }] } })
    expect(page.data.list[0]).toMatchObject({ status: "cancelled", note: "最新详情" })
    expect(page.data.loadFailed).toBe(false)
    expect(storage.get("bookings_last_snapshot")[0].note).toBe("最新详情")
  })

  test("cancelling an appended page preserves the row but keeps only the first page in the snapshot", () => {
    page.data.pageSize = 1
    page.handleLoadMore()
    requests[0].success({ result: { ok: true, page: 1, hasMore: false, list: [{ ...booking, id: "booking_2" }] } })
    expect(page.data.list).toHaveLength(2)
    page.cancelBooking("booking_2")
    requests[1].success({ result: { ok: true, id: "booking_2", status: "cancelled" } })
    expect(page.data.list[1]).toMatchObject({ id: "booking_2", status: "cancelled", canCancel: false })
    expect(storage.get("bookings_last_snapshot").map((item) => item.id)).toEqual(["booking_1"])
    expect(requests[2].data.page).toBe(0)
    requests[2].fail(new Error("refresh unavailable"))
    expect(page.data.list[1].status).toBe("cancelled")
    expect(page.data.page).toBe(1)
    expect(page.data.hasMore).toBe(false)
    expect(storage.get("bookings_last_snapshot").map((item) => item.id)).toEqual(["booking_1"])
  })

  test("an automatic reload cannot unlock a cancellation still awaiting its server result", () => {
    page.data.loadFailed = true
    page.cancelBooking(booking.id)
    const done = jest.fn()
    page.loadList({ done })
    expect(requests).toHaveLength(1)
    expect(done).toHaveBeenCalledTimes(1)
    expect(page.data.loading).toBe(true)
    page.cancelBooking(booking.id)
    expect(requests).toHaveLength(1)
  })

  test.each(["network", "server", "timeout"])("background cancellation %s failure is reported once after return", (failure) => {
    page.cancelBooking(booking.id)
    stack = [page, {}]
    if (failure === "network") requests[0].fail(new Error("网络中断"))
    else if (failure === "server") requests[0].success({ result: { ok: false, message: "状态已更新" } })
    else jest.advanceTimersByTime(12000)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data.loading).toBe(false)
    expect(page.data.list[0].status).toBe("pending")
    stack = [page]
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: failure === "network" ? "网络中断" : failure === "server" ? "状态已更新" : "取消预约超时，请重试", icon: "none" })
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test.each(["dismiss", "failed request"])("a consumed cancellation dialog cannot submit again after %s", (end) => {
    page.handleCancel({ currentTarget: { dataset: { id: booking.id } } })
    modals[0].success({ confirm: end !== "dismiss" })
    if (end === "failed request") requests[0].fail(new Error("response lost"))
    const count = requests.length
    modals[0].success({ confirm: true })
    expect(requests).toHaveLength(count)
    page.handleCancel({ currentTarget: { dataset: { id: booking.id } } })
    modals[1].success({ confirm: true })
    expect(requests).toHaveLength(count + 1)
  })
})
