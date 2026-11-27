function createPage() {
  jest.resetModules()
  let definition
  global.Page = (input) => { definition = input }
  require("../pages/favorites/favorites")
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => { Object.assign(page.data, patch) })
  page.loadOperationConfig = jest.fn()
  page.applyFavoriteList([{ id: "car", name: "收藏车辆", status: "idle" }])
  page.data.initialLoading = false
  page.data.loadedOnce = true
  global.getCurrentPages = () => [page]
  return page
}

describe("收藏撤销窗口在页面恢复与读取期间保留", () => {
  let requests
  let page

  beforeEach(() => {
    jest.useFakeTimers()
    requests = []
    global.wx = {
      cloud: { callFunction: jest.fn((options) => requests.push(options)) },
      showToast: jest.fn(),
      setStorageSync: jest.fn(),
      stopPullDownRefresh: jest.fn()
    }
    page = createPage()
  })

  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  function confirmRemoval() {
    page.removeFavorite("car")
    requests[0].success({ result: { ok: true, favorited: false } })
  }

  function completeRefresh() {
    requests[requests.length - 1].success({ result: { ok: true, list: [], page: 0, hasMore: false } })
  }

  function undoAndVerify() {
    page.handleUndoRemove()
    expect(requests[requests.length - 1]).toMatchObject({ name: "favoriteSet", data: { vehicleId: "car", favorited: true } })
    requests[requests.length - 1].success({ result: { ok: true, favorited: true } })
    expect(page.data.list.map((car) => car.id)).toEqual(["car"])
    expect(page.data.undoFavorite).toBeNull()
  }

  test("取消收藏在后台完成，返回并结束刷新后仍有可点击的撤销入口", () => {
    page.removeFavorite("car")
    page.onHide()
    global.getCurrentPages = () => [page, {}]
    requests[0].success({ result: { ok: true, favorited: false } })
    jest.advanceTimersByTime(6000)
    expect(wx.showToast).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    completeRefresh()
    expect(page.data.undoFavorite && page.data.undoFavorite.car.id).toBe("car")
    undoAndVerify()
  })

  test("返回自动刷新耗时超过五秒，读取期间不消耗被禁用的撤销窗口", () => {
    confirmRemoval()
    jest.advanceTimersByTime(1000)
    page.onHide()
    page.onShow()
    expect(page.data.loading).toBe(true)
    page.handleUndoRemove()
    expect(requests).toHaveLength(2)
    jest.advanceTimersByTime(6000)
    completeRefresh()
    expect(page.data.undoFavorite && page.data.undoFavorite.car.id).toBe("car")
    undoAndVerify()
  })

  test("主动下拉刷新耗时超过五秒，刷新结束后仍可撤销", () => {
    confirmRemoval()
    page.onPullDownRefresh()
    jest.advanceTimersByTime(6000)
    completeRefresh()
    expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
    expect(page.data.undoFavorite && page.data.undoFavorite.car.id).toBe("car")
    undoAndVerify()
  })

  test.each(["network", "server", "timeout", "throw", "missing-cloud"])("刷新 %s 后保留撤销并恢复可操作计时", (failure) => {
    confirmRemoval()
    jest.advanceTimersByTime(2000)
    if (failure === "throw") wx.cloud.callFunction.mockImplementationOnce(() => { throw new Error("offline") })
    if (failure === "missing-cloud") delete wx.cloud
    page.onPullDownRefresh()
    if (failure === "timeout") jest.advanceTimersByTime(15000)
    else if (failure === "network" || failure === "server") {
      jest.advanceTimersByTime(6000)
      if (failure === "network") requests[1].fail({ errMsg: "offline" })
      else requests[1].success({ result: { ok: false, message: "读取失败" } })
    }
    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).not.toBe("")
    expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(2999)
    expect(page.data.undoFavorite && page.data.undoFavorite.car.id).toBe("car")
    jest.advanceTimersByTime(1)
    expect(page.data.undoFavorite).toBeNull()
  })

  test("缓存写入失败不影响刷新后的撤销", () => {
    confirmRemoval()
    wx.setStorageSync.mockImplementation(() => { throw new Error("storage full") })
    page.onPullDownRefresh()
    jest.advanceTimersByTime(6000)
    completeRefresh()
    expect(page.data.loading).toBe(false)
    undoAndVerify()
  })

  test("保留剩余可操作时间，重复 onShow 不延长窗口或累积定时器", () => {
    confirmRemoval()
    jest.advanceTimersByTime(2000)
    page.onHide()
    jest.advanceTimersByTime(6000)
    page.onShow()
    completeRefresh()
    expect(jest.getTimerCount()).toBe(1)
    for (let index = 0; index < 2; index += 1) {
      jest.advanceTimersByTime(1000)
      page.onShow()
      completeRefresh()
      expect(jest.getTimerCount()).toBe(1)
    }
    jest.advanceTimersByTime(999)
    expect(page.data.undoFavorite && page.data.undoFavorite.car.id).toBe("car")
    jest.advanceTimersByTime(1)
    expect(page.data.undoFavorite).toBeNull()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("新取消替换旧目标，旧撤销超时后的迟到回执不清除新目标", () => {
    page.applyFavoriteList([{ id: "car", status: "idle" }, { id: "other", status: "idle" }])
    confirmRemoval()
    page.handleUndoRemove()
    const lateUndo = requests[1]
    jest.advanceTimersByTime(12000)
    page.removeFavorite("other")
    requests[2].success({ result: { ok: true, favorited: false } })
    lateUndo.fail({ errMsg: "late offline" })
    expect(page.data.undoFavorite.car.id).toBe("other")
    page.handleUndoRemove()
    expect(requests[3]).toMatchObject({ name: "favoriteSet", data: { vehicleId: "other", favorited: true } })
    requests[3].success({ result: { ok: true, favorited: true } })
    expect(page.data.list.map((car) => car.id)).toEqual(["other"])
  })

  test("其他车辆取消失败后恢复原撤销目标的剩余窗口", () => {
    page.applyFavoriteList([{ id: "car", status: "idle" }, { id: "other", status: "idle" }])
    confirmRemoval()
    jest.advanceTimersByTime(2000)
    page.removeFavorite("other")
    jest.advanceTimersByTime(6000)
    requests[1].success({ result: { ok: false, message: "更新失败" } })
    jest.advanceTimersByTime(2999)
    expect(page.data.undoFavorite && page.data.undoFavorite.car.id).toBe("car")
    jest.advanceTimersByTime(1)
    expect(page.data.undoFavorite).toBeNull()
  })

  test.each(["network", "server", "timeout"])("撤销在后台 %s 失败，返回后保留新的重试窗口", (failure) => {
    confirmRemoval()
    page.handleUndoRemove()
    page.onHide()
    if (failure === "network") requests[1].fail({ errMsg: "offline" })
    else if (failure === "server") requests[1].success({ result: { ok: false, message: "更新失败" } })
    else jest.advanceTimersByTime(12000)
    jest.advanceTimersByTime(6000)
    page.onShow()
    completeRefresh()
    jest.advanceTimersByTime(4999)
    expect(page.data.undoFavorite && page.data.undoFavorite.car.id).toBe("car")
    undoAndVerify()
  })

  test.each(["remove", "refresh", "undo"])("%s 在途时卸载，迟到回执不能恢复撤销计时或写页面", (operation) => {
    if (operation === "remove") page.removeFavorite("car")
    else {
      confirmRemoval()
      if (operation === "refresh") page.onPullDownRefresh()
      else page.handleUndoRemove()
    }
    const lateRequest = requests[requests.length - 1]
    page.onUnload()
    page.setData.mockClear()
    wx.showToast.mockClear()
    lateRequest.success({ result: { ok: true, list: [], page: 0, hasMore: false } })
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
})
