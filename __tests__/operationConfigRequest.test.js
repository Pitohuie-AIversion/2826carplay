const {
  OPERATION_CONFIG_TIMEOUT_MS,
  requestOperationConfig
} = require("../shared/operationConfigRequest")

describe("shared/operationConfigRequest", () => {
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
})
