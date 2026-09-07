function loadPageDefinition(modulePath) {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require(modulePath)
  return definition
}

function createPage(definition, data) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...(data || {})
    }
  }
  page.setData = jest.fn((patch) => {
    Object.assign(page.data, patch)
  })
  return page
}

describe("multi-level navigation lifecycle", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
    delete global.getApp
  })

  test.each([
    ["booking", "../pages/booking/booking", "handleBackGarage"],
    ["car detail", "../pages/car-detail/car-detail", "handleBackGarage"],
    ["booking management detail", "../pages/booking-manage-detail/booking-manage-detail", "handleBackManage"],
    ["vehicle detail management", "../pages-admin/vehicle-detail-manage/vehicle-detail-manage", "handleBackList"],
    ["vehicle edit", "../pages-admin/vehicle-edit/vehicle-edit", "handleBackList"]
  ])("does not redirect after %s unloads during navigateBack", (label, modulePath, handler) => {
    let backOptions
    global.getCurrentPages = jest.fn(() => [{ route: "from" }, { route: "current" }])
    global.wx = {
      navigateBack: jest.fn((options) => {
        backOptions = options
      }),
      redirectTo: jest.fn(),
      reLaunch: jest.fn(),
      showToast: jest.fn(),
      hideLoading: jest.fn()
    }
    const page = createPage(loadPageDefinition(modulePath))

    page[handler]()
    page.onUnload()
    backOptions.fail(new Error("navigateBack failed"))

    expect(global.wx.redirectTo).not.toHaveBeenCalled()
    expect(global.wx.reLaunch).not.toHaveBeenCalled()
    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("does not relaunch after the bookings page unloads during redirect", () => {
    let redirectOptions
    global.wx = {
      redirectTo: jest.fn((options) => {
        redirectOptions = options
      }),
      reLaunch: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/bookings/bookings"))

    page.handleBackGarage()
    page.onUnload()
    redirectOptions.fail(new Error("redirect failed"))

    expect(global.wx.reLaunch).not.toHaveBeenCalled()
    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("stops a booking fallback chain when the page unloads between redirect and relaunch", () => {
    let backOptions
    let redirectOptions
    global.getCurrentPages = jest.fn(() => [{ route: "from" }, { route: "booking" }])
    global.wx = {
      navigateBack: jest.fn((options) => {
        backOptions = options
      }),
      redirectTo: jest.fn((options) => {
        redirectOptions = options
      }),
      reLaunch: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/booking/booking"))

    page.handleBackGarage()
    backOptions.fail(new Error("navigateBack failed"))
    expect(global.wx.redirectTo).toHaveBeenCalledTimes(1)

    page.onUnload()
    redirectOptions.fail(new Error("redirect failed"))

    expect(global.wx.reLaunch).not.toHaveBeenCalled()
    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("does not show the terminal error after unloading during relaunch", () => {
    let redirectOptions
    let relaunchOptions
    global.wx = {
      redirectTo: jest.fn((options) => {
        redirectOptions = options
      }),
      reLaunch: jest.fn((options) => {
        relaunchOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/bookings/bookings"))

    page.handleBackGarage()
    redirectOptions.fail(new Error("redirect failed"))
    expect(global.wx.reLaunch).toHaveBeenCalledTimes(1)

    page.onUnload()
    relaunchOptions.fail(new Error("relaunch failed"))

    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("does not emit detail data or show an error after the bookings page unloads", () => {
    let navigateOptions
    const emit = jest.fn()
    global.wx = {
      navigateTo: jest.fn((options) => {
        navigateOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/bookings/bookings"), {
      list: [{ id: "booking-route-unload" }]
    })

    page.handleViewDetail({
      currentTarget: { dataset: { id: "booking-route-unload" } }
    })
    page.onUnload()
    navigateOptions.success({ eventChannel: { emit } })
    navigateOptions.fail(new Error("navigate failed"))

    expect(emit).not.toHaveBeenCalled()
    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test.each([
    ["booking detail", "../pages/booking-detail/booking-detail", "acceptBookingDetail", false],
    [
      "booking management detail",
      "../pages/booking-manage-detail/booking-manage-detail",
      "acceptManageBookingDetail",
      true
    ]
  ])("unsubscribes and ignores late %s opener events", (_label, modulePath, eventName, protectedPage) => {
    let eventHandler
    const eventChannel = {
      on: jest.fn((name, handler) => {
        expect(name).toBe(eventName)
        eventHandler = handler
      }),
      off: jest.fn()
    }
    global.getApp = jest.fn(() => ({ globalData: {} }))
    global.wx = protectedPage
      ? {
          cloud: { callFunction: jest.fn() },
          showToast: jest.fn()
        }
      : {}
    const page = createPage(loadPageDefinition(modulePath))
    page.getOpenerEventChannel = jest.fn(() => eventChannel)
    if (!protectedPage) {
      page.loadNotificationConfig = jest.fn()
    }

    page.onLoad({ id: "booking-event-unload" })
    page.data.pageAuthorized = true
    page.applyBooking = jest.fn()
    page.onUnload()
    eventHandler({ booking: { id: "booking-event-unload" } })

    expect(eventChannel.off).toHaveBeenCalledWith(eventName, eventHandler)
    expect(page.applyBooking).not.toHaveBeenCalled()
  })
})
