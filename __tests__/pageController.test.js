describe("page controller permission and native lifecycle", () => {
  let createPageController, page, stack, requests, controllers

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    controllers = []
    page = { data: {}, setData: jest.fn(function (patch) { Object.assign(this.data, patch) }) }
    stack = [page]
    global.getCurrentPages = () => stack
    global.wx = {
      cloud: { callFunction: jest.fn((request) => requests.push(request)) },
      showToast: jest.fn(), redirectTo: jest.fn(), navigateBack: jest.fn(), reLaunch: jest.fn()
    }
    ;({ createPageController } = require("../shared/pageController"))
  })

  afterEach(() => {
    controllers.forEach((controller) => controller.dispose())
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.getCurrentPages
    delete global.wx
  })

  function create(options) {
    const controller = createPageController(page, options)
    controllers.push(controller)
    return controller
  }

  test.each([
    ["permission name", "canManageBookings"],
    ["permission predicate", (result) => result.canManageBookings && result.isAdmin]
  ])("allows authorized users via a %s", (_name, requiredPermission) => {
    create({ requiredPermission })
    expect(page.data.pageAuthorized).toBe(false)
    requests[0].success({ result: { ok: true, canManageBookings: true, isAdmin: true } })
    expect(page.data.pageAuthorized).toBe(true)
    jest.runOnlyPendingTimers()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.redirectTo).not.toHaveBeenCalled()
  })

  test("still denies users missing the required permission", () => {
    create({ requiredPermission: "canManageBookings" })
    requests[0].success({ result: { ok: true, canManageBookings: false } })
    expect(page.data.pageAuthorized).toBe(false)
    jest.advanceTimersByTime(700)
    expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({ url: "/pages/mine/mine" }))
  })

  test("dispose cancels outstanding permission checks and their timers", () => {
    const controller = create({ requiredPermission: "canManageBookings" })
    controller.dispose()
    page.setData.mockClear()
    requests[0].success({ result: { ok: true, canManageBookings: true } })
    jest.runOnlyPendingTimers()
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("native actions require the originating page in front by default", () => {
    const controller = create()
    const action = controller.beginAction({ exclusiveKey: "phone" })
    expect(controller.isActionActive(action)).toBe(true)
    stack.push({ route: "pages/mine/mine" })
    expect(controller.isActionActive(action)).toBe(false)
    stack.pop()
    expect(controller.isActionActive(action)).toBe(true)
  })

  test("background-safe actions may explicitly opt out of the foreground check", () => {
    const controller = create()
    const action = controller.beginAction({ requireCurrent: false })
    stack.push({})
    expect(controller.isActionActive(action)).toBe(true)
    controller.dispose()
    expect(controller.isActionActive(action)).toBe(false)
  })

  test.each(["background", "unloaded"])("late toast is suppressed after page becomes %s", (state) => {
    const controller = create()
    controller.showToast("保存成功")
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    if (state === "background") stack.push({})
    else controller.dispose()
    controller.showToast("迟到的结果")
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("disposing an unbound controller preserves the page's own performance helper", () => {
    const original = { dispose: jest.fn() }
    page._perf = original
    create({ autoBindPage: false }).dispose()
    expect(page._perf).toBe(original)
    expect(original.dispose).not.toHaveBeenCalled()
  })
})
