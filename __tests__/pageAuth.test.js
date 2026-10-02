describe("permission cache request lifecycle", () => {
  let auth, requests, pages
  const allowed = { ok: true, canManageVehicles: true }
  const denied = { ok: true, canManageVehicles: false }

  function createPage() {
    const page = { data: {}, setData: jest.fn(function (patch) { Object.assign(this.data, patch) }) }
    pages.push(page)
    return page
  }
  function check(page, options = {}) {
    auth.requirePagePermission(page, { required: "canManageVehicles", ...options })
  }
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    pages = []
    global.wx = {
      cloud: { callFunction: jest.fn((request) => requests.push(request)) },
      showToast: jest.fn(), redirectTo: jest.fn(), reLaunch: jest.fn()
    }
    auth = require("../shared/pageAuth")
  })
  afterEach(() => {
    pages.forEach(auth.cancelPagePermissionCheck)
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.wx
    delete global.getCurrentPages
  })

  test.each(["cancel", "timeout"])("a %s response cannot populate the next page's cache", (kind) => {
    const first = createPage()
    check(first)
    if (kind === "cancel") auth.cancelPagePermissionCheck(first)
    else jest.advanceTimersByTime(12000)
    requests[0].success({ result: allowed })
    const next = createPage()
    check(next)
    expect(requests).toHaveLength(2)
    expect(first.data.pageAuthorized).toBe(false)
    expect(next.data.pageAuthorized).toBe(false)
  })

  test("clearing roles while a check is pending requires a fresh server result", () => {
    const page = createPage()
    const onAuthorized = jest.fn()
    check(page, { onAuthorized })
    auth.clearPagePermissionCache()
    requests[0].success({ result: allowed })
    expect(requests).toHaveLength(2)
    expect(page.data.pageAuthorized).toBe(false)
    expect(onAuthorized).not.toHaveBeenCalled()
    requests[1].success({ result: denied })
    const next = createPage()
    check(next)
    expect(requests).toHaveLength(2)
    expect(next.data.pageAuthorized).toBe(false)
  })

  test("an older parallel result cannot overwrite a newer denial", () => {
    const older = createPage()
    const newer = createPage()
    check(older, { force: true })
    check(newer, { force: true })
    requests[1].success({ result: denied })
    requests[0].success({ result: allowed })
    expect(older.data.pageAuthorized).toBe(false)
    const next = createPage()
    check(next)
    expect(requests).toHaveLength(2)
    expect(next.data.pageAuthorized).toBe(false)
  })

  test("a successful active check is cached until explicitly invalidated", () => {
    const first = createPage()
    check(first)
    requests[0].success({ result: allowed })
    const next = createPage()
    check(next)
    expect(requests).toHaveLength(1)
    expect(next.data.pageAuthorized).toBe(true)
    auth.clearPagePermissionCache()
    check(next)
    expect(next.data.pageAuthorized).toBe(false)
    expect(requests).toHaveLength(2)
  })

  test("a delayed permission redirect cannot close a different foreground page", () => {
    const page = createPage()
    global.getCurrentPages = () => [page]
    check(page)
    requests[0].success({ result: denied })
    global.getCurrentPages = () => [page, { route: "pages/garage/garage" }]
    jest.advanceTimersByTime(700)
    expect(global.wx.redirectTo).not.toHaveBeenCalled()
    expect(global.wx.reLaunch).not.toHaveBeenCalled()
  })
})
