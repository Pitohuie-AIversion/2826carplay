const {
  OPERATION_CONFIG_TIMEOUT_MS,
  OPERATION_CONFIG_CACHE_TTL_MS,
  requestOperationConfig,
  clearOperationConfigCache
} = require("../shared/operationConfigRequest")

describe("shared/operationConfigRequest", () => {
  test.each([false, true])("缓存排期跨过有效期后重新读取，取消状态=%s仍有效", (cancelled) => {
    jest.useFakeTimers()
    const requests = []
    const ticks = []
    global.wx = { nextTick: (callback) => ticks.push(callback), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    requestOperationConfig({})
    requests[0].success({ result: { ok: true, config: { servicePhone: "old" } } })
    jest.advanceTimersByTime(OPERATION_CONFIG_CACHE_TTL_MS - 1)
    const onSuccess = jest.fn()
    const cancel = requestOperationConfig({ onSuccess })
    jest.advanceTimersByTime(2)
    ticks.shift()()
    expect(requests).toHaveLength(2)
    expect(onSuccess).not.toHaveBeenCalled()
    if (cancelled) cancel()
    requests[1].success({ result: { ok: true, config: { servicePhone: "new" } } })
    if (cancelled) expect(onSuccess).not.toHaveBeenCalled()
    else expect(onSuccess).toHaveBeenCalledWith({ servicePhone: "new" })
    expect(jest.getTimerCount()).toBe(0)
  })

  test("较新的强刷已取消时，仍在途的强刷失败会清掉旧缓存", () => {
    const requests = []
    global.wx = { nextTick: (callback) => callback(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    requestOperationConfig({})
    requests[0].success({ result: { ok: true, config: { servicePhone: "old" } } })
    requestOperationConfig({ force: true })
    const cancel = requestOperationConfig({ force: true })
    cancel()
    requests[1].fail(new Error("network"))
    const onSuccess = jest.fn()
    const cancelRetry = requestOperationConfig({ onSuccess })
    expect(requests).toHaveLength(4)
    expect(onSuccess).not.toHaveBeenCalled()
    cancelRetry()
  })

  test("较早强刷失败清旧缓存时保留较新在途读取", () => {
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    requestOperationConfig({})
    requests[0].success({ result: { ok: true, config: { servicePhone: "old" } } })
    requestOperationConfig({ force: true })
    const onSuccess = jest.fn()
    const onInvalidated = jest.fn()
    requestOperationConfig({ force: true, onSuccess, onInvalidated })
    requests[1].fail(new Error("older network"))
    expect(onInvalidated).not.toHaveBeenCalled()
    requests[2].success({ result: { ok: true, config: { servicePhone: "new" } } })
    expect(onSuccess).toHaveBeenCalledWith({ servicePhone: "new" })
  })

  test("清缓存通知导致强刷消费者卸载时不再交付失败回调", () => {
    const requests = []
    global.wx = { nextTick: jest.fn(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    requestOperationConfig({})
    requests[0].success({ result: { ok: true, config: { servicePhone: "old" } } })
    let cancelRefresh
    requestOperationConfig({ onInvalidated: () => cancelRefresh() })
    const onFailure = jest.fn()
    cancelRefresh = requestOperationConfig({ force: true, onFailure })
    requests[1].fail(new Error("network"))
    expect(onFailure).not.toHaveBeenCalled()
  })

  test.each(["network", "timeout", "invalid"])("强制刷新%s失败后不再复用旧配置缓存", (mode) => {
    jest.useFakeTimers()
    const requests = []
    global.wx = { nextTick: (callback) => callback(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    requestOperationConfig({})
    requests[0].success({ result: { ok: true, config: { servicePhone: "old" } } })
    const onFailure = jest.fn()
    requestOperationConfig({ force: true, onFailure })
    if (mode === "timeout") jest.advanceTimersByTime(OPERATION_CONFIG_TIMEOUT_MS)
    else if (mode === "invalid") requests[1].success({ result: { ok: true, config: [] } })
    else requests[1].fail(new Error("network"))
    expect(onFailure).toHaveBeenCalledTimes(1)
    const onSuccess = jest.fn()
    requestOperationConfig({ onSuccess })
    expect(requests).toHaveLength(3)
    expect(onSuccess).not.toHaveBeenCalled()
    requests[2].success({ result: { ok: true, config: { servicePhone: "" } } })
    expect(onSuccess).toHaveBeenCalledWith({ servicePhone: "" })
  })

  test.each(["success", "failure"])("较新读取成功后，旧请求%s不会回退消费者", (completion) => {
    const requests = []
    global.wx = { nextTick: (callback) => callback(), cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    const onSuccess = jest.fn()
    const onFailure = jest.fn()
    requestOperationConfig({ onSuccess, onFailure })
    requestOperationConfig({ force: true })
    requests[1].success({ result: { ok: true, revision: 2, config: { servicePhone: "" } } })
    if (completion === "success") requests[0].success({ result: { ok: true, revision: 1, config: { servicePhone: "old" } } })
    else requests[0].fail(new Error("old failure"))
    expect(onSuccess).toHaveBeenCalledWith({ servicePhone: "" })
    expect(onFailure).not.toHaveBeenCalled()
  })

  test("已读取较新保存版本后，较晚发出的请求也不能恢复旧版本", () => {
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    requestOperationConfig({})
    requests[0].success({ result: { ok: true, revision: 3, config: { rulesContent: "最新规则" } } })
    const onSuccess = jest.fn()
    requestOperationConfig({ force: true, onSuccess })
    requests[1].success({ result: { ok: true, revision: 2, config: { rulesContent: "旧规则" } } })
    expect(onSuccess).toHaveBeenCalledWith({ rulesContent: "最新规则" })
  })

  test("一个消费者失效处理异常不阻止其他请求解锁和取消计时", () => {
    jest.useFakeTimers()
    global.wx = { cloud: { callFunction: jest.fn() } }
    requestOperationConfig({ onInvalidated: () => { throw new Error("consumer failed") } })
    const onInvalidated = jest.fn()
    requestOperationConfig({ onInvalidated })
    expect(() => clearOperationConfigCache()).not.toThrow()
    expect(onInvalidated).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("清缓存立即通知活动加载已失效并取消超时，旧响应不再交付", () => {
    jest.useFakeTimers()
    let request
    global.wx = { cloud: { callFunction: jest.fn((options) => { request = options }) } }
    const onInvalidated = jest.fn()
    const onSuccess = jest.fn()
    const onFailure = jest.fn()
    requestOperationConfig({ onInvalidated, onSuccess, onFailure })
    clearOperationConfigCache()
    expect(onInvalidated).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
    request.success({ result: { ok: true, config: { servicePhone: "old" } } })
    request.fail(new Error("old failure"))
    clearOperationConfigCache()
    expect(onInvalidated).toHaveBeenCalledTimes(1)
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  test("缓存排期失效通知一次，已卸载消费者不再收到失效通知", () => {
    const ticks = []
    global.wx = {
      nextTick: (callback) => ticks.push(callback),
      cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, config: {} } })) }
    }
    requestOperationConfig({})
    const activeInvalidated = jest.fn()
    const unloadedInvalidated = jest.fn()
    const onSuccess = jest.fn()
    requestOperationConfig({ onInvalidated: activeInvalidated, onSuccess })
    const cancel = requestOperationConfig({ onInvalidated: unloadedInvalidated, onSuccess })
    cancel()
    clearOperationConfigCache()
    ticks.forEach((callback) => callback())
    expect(activeInvalidated).toHaveBeenCalledTimes(1)
    expect(unloadedInvalidated).not.toHaveBeenCalled()
    expect(onSuccess).not.toHaveBeenCalled()
  })

  test("失效通知中取消另一个缓存消费者后，后者不再被通知", () => {
    global.wx = { nextTick: jest.fn(), cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, config: {} } })) } }
    requestOperationConfig({})
    let cancelSecond
    requestOperationConfig({ onInvalidated: () => cancelSecond() })
    const onInvalidated = jest.fn()
    cancelSecond = requestOperationConfig({ onInvalidated })
    clearOperationConfigCache()
    expect(onInvalidated).not.toHaveBeenCalled()
  })

  test("缓存回调排期期间强制刷新完成，只交付已刷新的配置", () => {
    const requests = []
    const ticks = []
    global.wx = { cloud: { callFunction: jest.fn((options) => requests.push(options)) }, nextTick: (callback) => ticks.push(callback) }
    requestOperationConfig({})
    requests[0].success({ result: { ok: true, config: { servicePhone: "18800000000" } } })
    const onSuccess = jest.fn()
    requestOperationConfig({ onSuccess })
    requestOperationConfig({ force: true })
    requests[1].success({ result: { ok: true, config: { servicePhone: "" } } })
    ticks.forEach((callback) => callback())
    expect(onSuccess).toHaveBeenCalledWith({ servicePhone: "" })
  })

  test.each(["network", "timeout"])("缓存失效后旧%s失败不再让消费者回退旧状态", (failure) => {
    jest.useFakeTimers()
    let request
    global.wx = { cloud: { callFunction: jest.fn((options) => { request = options }) } }
    const onFailure = jest.fn()
    requestOperationConfig({ onFailure })
    clearOperationConfigCache()
    if (failure === "network") request.fail(new Error("stale network failure"))
    else jest.advanceTimersByTime(OPERATION_CONFIG_TIMEOUT_MS)
    expect(onFailure).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  afterEach(() => {
    jest.useRealTimers()
    delete global.wx
  })

  test("返回有效配置并结束超时计时", () => {
    jest.useFakeTimers()
    const onSuccess = jest.fn()
    const onFailure = jest.fn()
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({ result: { ok: true, config: { servicePhone: "18800000000" } } })
        })
      }
    }

    requestOperationConfig({ onSuccess, onFailure })
    jest.advanceTimersByTime(OPERATION_CONFIG_TIMEOUT_MS)

    expect(onSuccess).toHaveBeenCalledWith({ servicePhone: "18800000000" })
    expect(onFailure).not.toHaveBeenCalled()
  })

  test("无回调时静默超时并忽略迟到成功", () => {
    jest.useFakeTimers()
    let lateSuccess = null
    const onSuccess = jest.fn()
    const onFailure = jest.fn()
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          lateSuccess = options.success
        })
      }
    }

    requestOperationConfig({ onSuccess, onFailure })
    jest.advanceTimersByTime(OPERATION_CONFIG_TIMEOUT_MS)
    expect(onFailure).toHaveBeenCalledWith({ code: "TIMEOUT" })

    lateSuccess({ result: { ok: true, config: { servicePhone: "late" } } })
    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).toHaveBeenCalledTimes(1)
  })

  test("主动取消后不再处理请求回调", () => {
    let requestOptions = null
    const onSuccess = jest.fn()
    const onFailure = jest.fn()
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      }
    }

    const cancel = requestOperationConfig({ onSuccess, onFailure })
    cancel()
    requestOptions.success({ result: { ok: true, config: { faqContent: "late" } } })
    requestOptions.fail({ errMsg: "request failed" })

    expect(onSuccess).not.toHaveBeenCalled()
    expect(onFailure).not.toHaveBeenCalled()
  })

  test("云函数同步抛错时收口为一次失败", () => {
    const error = new Error("config unavailable")
    const onFailure = jest.fn()
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw error
        })
      }
    }

    expect(() => requestOperationConfig({ onFailure })).not.toThrow()
    expect(onFailure).toHaveBeenCalledTimes(1)
    expect(onFailure).toHaveBeenCalledWith(error)
  })

  test("同环境二次调用直接命中缓存，无需再次调用云函数", () => {
    jest.useFakeTimers()
    const callFunctionMock = jest.fn(({ success }) => {
      success({ result: { ok: true, config: { brandName: "2826 Carplay" } } })
    })
    global.wx = {
      cloud: {
        callFunction: callFunctionMock
      }
    }

    const firstSuccess = jest.fn()
    requestOperationConfig({ onSuccess: firstSuccess })
    jest.advanceTimersByTime(100)
    expect(firstSuccess).toHaveBeenCalledWith({ brandName: "2826 Carplay" })
    expect(callFunctionMock).toHaveBeenCalledTimes(1)

    // 第二次调用，应该直接走缓存
    const secondSuccess = jest.fn()
    requestOperationConfig({ onSuccess: secondSuccess })
    jest.advanceTimersByTime(100)
    expect(secondSuccess).toHaveBeenCalledWith({ brandName: "2826 Carplay" })
    expect(callFunctionMock).toHaveBeenCalledTimes(1)
  })

  test("保存使缓存失效后，旧请求不能重新写回配置", () => {
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    const staleSuccess = jest.fn()
    requestOperationConfig({ onSuccess: staleSuccess })
    clearOperationConfigCache()
    requestOperationConfig({})
    requests[1].success({ result: { ok: true, config: { servicePhone: "" } } })
    requests[0].success({ result: { ok: true, config: { servicePhone: "18800000000" } } })
    expect(staleSuccess).not.toHaveBeenCalled()
    global.wx.nextTick = (fn) => fn()
    const onSuccess = jest.fn()
    requestOperationConfig({ onSuccess })
    expect(onSuccess).toHaveBeenCalledWith({ servicePhone: "" })
    expect(requests).toHaveLength(2)
  })

  test("取消的迟到成功不能污染缓存，缓存回调定时器可销毁", () => {
    jest.useFakeTimers()
    const requests = []
    global.wx = { cloud: { callFunction: jest.fn((options) => requests.push(options)) } }
    const cancel = requestOperationConfig({})
    cancel()
    requests[0].success({ result: { ok: true, config: { servicePhone: "old" } } })
    requestOperationConfig({})
    expect(requests).toHaveLength(2)
    requests[1].success({ result: { ok: true, config: { servicePhone: "new" } } })
    const onSuccess = jest.fn()
    const cancelCached = requestOperationConfig({ onSuccess })
    expect(jest.getTimerCount()).toBe(1)
    cancelCached()
    expect(jest.getTimerCount()).toBe(0)
    jest.runOnlyPendingTimers()
    expect(onSuccess).not.toHaveBeenCalled()
  })
})


