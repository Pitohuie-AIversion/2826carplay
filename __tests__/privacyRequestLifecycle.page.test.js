const fs = require("fs")
const path = require("path")

describe("privacy request mutation lifecycle", () => {
  let page, stack, requests
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    global.wx = {
      cloud: { callFunction: jest.fn((request) => requests.push(request)) },
      showToast: jest.fn(), enableAlertBeforeUnload: jest.fn(), disableAlertBeforeUnload: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages/privacy-request/privacy-request")
    stack = [page]
    global.getCurrentPages = () => stack
    page.handleDescriptionInput({ detail: { value: "查询我的个人信息" } })
  })
  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.wx
    delete global.Page
    delete global.getCurrentPages
  })

  function start(kind) {
    if (kind === "submit") page.handleSubmit()
    else page.cancelRequest("request_1")
    return requests[0]
  }

  test("submit and cancel cannot overlap in either order", () => {
    start("cancel")
    page.handleSubmit()
    expect(requests).toHaveLength(1)
    expect(page.data.submitting).toBe(false)
    requests[0].fail({ errMsg: "offline" })
    page.handleSubmit()
    page.cancelRequest("request_2")
    expect(requests).toHaveLength(2)
    expect(requests[1].name).toBe("privacyRequestCreate")

    const markup = fs.readFileSync(path.resolve(__dirname, "../pages/privacy-request/privacy-request.wxml"), "utf8")
    expect(markup).toContain('disabled="{{submitting || cancellingId || !formReady}}"')
  })

  test.each(["submit", "cancel"])("%s success waits for return and only refreshes once", (kind) => {
    const request = start(kind)
    stack.push({})
    page.setData.mockClear()
    request.success({ result: { ok: true } })
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    stack.pop()
    page.onShow()
    expect(page.data.submitting).toBe(false)
    expect(page.data.cancellingId).toBe("")
    expect(page.data.description).toBe(kind === "submit" ? "" : "查询我的个人信息")
    expect(requests).toHaveLength(2)
    expect(requests[1].name).toBe("privacyRequestMyList")
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    page.onShow()
    request.success({ result: { ok: true } })
    expect(requests).toHaveLength(2)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test.each([
    ["submit", "business"], ["submit", "network"], ["submit", "timeout"],
    ["cancel", "business"], ["cancel", "network"], ["cancel", "timeout"]
  ])("%s %s failure preserves the form and is shown only after return", (kind, outcome) => {
    const request = start(kind)
    stack.push({})
    page.setData.mockClear()
    if (outcome === "business") request.success({ result: { ok: false, message: "服务暂不可用" } })
    else if (outcome === "network") request.fail({ errMsg: "offline" })
    else jest.advanceTimersByTime(12000)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
    stack.pop()
    page.onShow()
    expect(page.data.description).toBe("查询我的个人信息")
    expect(page.data.submitting).toBe(false)
    expect(page.data.cancellingId).toBe("")
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(requests).toHaveLength(1)
    expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled()
    if (kind === "submit") {
      page.handleSubmit()
      expect(requests[1].data.requestId).toBe(request.data.requestId)
    }
  })

  test.each(["submit", "cancel"])("deferred %s result is discarded on unload", (kind) => {
    const request = start(kind)
    stack.push({})
    request.success({ result: { ok: true } })
    page.onUnload()
    page.setData.mockClear()
    wx.showToast.mockClear()
    request.success({ result: { ok: true } })
    expect(page._privacyMutationDeferredResult).toBeNull()
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(requests).toHaveLength(1)
  })
})
