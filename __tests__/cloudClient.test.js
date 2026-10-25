const { callCloud } = require("../shared/cloudClient")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions
} = require("../shared/pageNativeAction")

describe("shared/cloudClient lifecycle", () => {
  let request
  let page
  let callbacks

  beforeEach(() => {
    jest.useFakeTimers()
    global.wx = {
      cloud: { callFunction: jest.fn((options) => { request = options }) },
      showToast: jest.fn()
    }
    page = {}
    activatePageNativeActions(page)
    callbacks = { onSuccess: jest.fn(), onFail: jest.fn(), onComplete: jest.fn() }
  })

  afterEach(() => {
    jest.useRealTimers()
    delete global.wx
    delete global.getCurrentPages
  })

  async function expectCancelled(promise) {
    // Avoid awaiting a permanently pending Promise when checking cancellation regressions.
    const pending = Symbol("pending")
    const result = await Promise.race([promise, Promise.resolve(pending)])
    expect(result).toEqual({ ok: false, code: "CANCELLED", message: "页面请求已失效" })
    expect(callbacks.onSuccess).not.toHaveBeenCalled()
    expect(callbacks.onFail).not.toHaveBeenCalled()
    expect(callbacks.onComplete).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  }

  test.each(["success", "fail", "timeout"])("页面卸载后 %s 仍结束 Promise 且静默丢弃回调", async (outcome) => {
    const promise = callCloud("load", {}, {
      pageContext: page,
      timeoutMs: 1000,
      showErrorToast: true,
      ...callbacks
    })
    cancelPageNativeActions(page)
    if (outcome === "success") request.success({ result: { ok: true, data: "old" } })
    if (outcome === "fail") request.fail({ errMsg: "network failure" })
    if (outcome === "timeout") jest.advanceTimersByTime(1000)
    await expectCancelled(promise)
  })

  test("未传 action 时也隔离同一实例重新激活前的旧响应", async () => {
    const promise = callCloud("load", {}, { pageContext: page, ...callbacks })
    cancelPageNativeActions(page)
    activatePageNativeActions(page)
    request.success({ result: { ok: true, data: "old lifecycle" } })
    await expectCancelled(promise)
  })

  test("显式前台 action 离开栈顶后静默取消", async () => {
    global.getCurrentPages = () => [page]
    const action = beginPageNativeAction(page, { requireCurrent: true })
    const promise = callCloud("load", {}, { pageContext: page, action, ...callbacks })
    global.getCurrentPages = () => [page, {}]
    request.success({ result: { ok: true, data: "old page" } })
    await expectCancelled(promise)
  })

  test("同一互斥动作被替换后旧请求静默取消", async () => {
    const action = beginPageNativeAction(page, { exclusiveKey: "load" })
    const promise = callCloud("load", {}, { pageContext: page, action, ...callbacks })
    beginPageNativeAction(page, { exclusiveKey: "load" })
    request.success({ result: { ok: true, data: "superseded" } })
    await expectCancelled(promise)
  })

  test("默认生命周期守卫保留非栈顶页面读取结果的能力", async () => {
    global.getCurrentPages = () => [page, {}]
    const promise = callCloud("load", {}, { pageContext: page, ...callbacks })
    request.success({ result: { ok: true, data: "background data" } })
    const result = await promise
    expect(result).toMatchObject({ ok: true, data: "background data" })
    expect(callbacks.onSuccess).toHaveBeenCalledWith("background data", result)
    expect(callbacks.onComplete).toHaveBeenCalledWith(result)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("取消完成后忽略重复或迟到的原生回调", async () => {
    const promise = callCloud("load", {}, { pageContext: page, showErrorToast: true, ...callbacks })
    cancelPageNativeActions(page)
    request.success({ result: { ok: true } })
    await expectCancelled(promise)
    activatePageNativeActions(page)
    request.fail({ errMsg: "network failure" })
    request.success({ result: { ok: true } })
    await expectCancelled(promise)
  })
})
