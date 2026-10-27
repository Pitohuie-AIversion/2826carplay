jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))
jest.mock("../shared/operationConfigRequest", () => ({ clearOperationConfigCache: jest.fn() }))

describe("config save feedback and native loading recovery", () => {
  let page
  let requests
  let stack
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    global.wx = {
      showToast: jest.fn(), showLoading: jest.fn(), hideLoading: jest.fn(),
      cloud: { callFunction: jest.fn((options) => requests.push(options)) }
    }
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => {
        Object.entries(patch).forEach(([path, value]) => {
          const parts = path.split(".")
          const key = parts.pop()
          const target = parts.reduce((object, part) => object[part], page.data)
          target[key] = value
        })
      })
    }
    require("../pages-admin/config-manage/config-manage")
    Object.assign(page.data, { pageAuthorized: true, loading: false, hasLoadedConfig: true, configRevision: 4 })
    stack = [page]
    global.getCurrentPages = () => stack
    editBrand("待保存配置")
  })
  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
    delete global.getApp
  })

  function editBrand(value) {
    page.handleInput({ currentTarget: { dataset: { field: "brandName" } }, detail: { value } })
  }
  function leave() {
    page.onHide()
    stack = [page, {}]
  }
  function saveSuccess(request = requests[0]) {
    request.success({ result: { ok: true, config: request.data.config, revision: 5, message: "配置已保存" } })
  }

  test.each(["network", "server", "timeout", "conflict", "malformed", "success"])("后台保存 %s 返回后交付一次结果，保留草稿与版本语义", (outcome) => {
    page.handleSubmit()
    expect(requests[0].data.expectedRevision).toBe(4)
    leave()
    if (outcome === "network") requests[0].fail({ errMsg: "连接中断" })
    else if (outcome === "server") requests[0].success({ result: { ok: false, message: "服务暂不可用" } })
    else if (outcome === "timeout") jest.advanceTimersByTime(20000)
    else if (outcome === "conflict") requests[0].success({ result: { ok: false, code: "CONFIG_CONFLICT", message: "配置已被修改" } })
    else if (outcome === "malformed") requests[0].success({ result: { ok: true, config: null, revision: 5 } })
    else saveSuccess()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(page.data).toMatchObject({ saving: false, form: { brandName: "待保存配置" },
      isDirty: outcome !== "success", configRevision: outcome === "success" ? 5 : 4,
      saveConflict: outcome === "conflict" })
    expect(page._hasUnsavedChanges).toBe(outcome !== "success")
    stack = [page]
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: { network: "连接中断", server: "服务暂不可用", timeout: "保存超时，请重试", conflict: "配置已被修改", malformed: "保存响应异常，请重试", success: "配置已保存" }[outcome],
      icon: outcome === "success" ? "success" : "none"
    })
    requests[0].fail({ errMsg: "重复回调" })
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("显示加载提示抛错仍发送保存请求并超时恢复，可重新保存", () => {
    wx.showLoading.mockImplementationOnce(() => { throw new Error("loading unavailable") })
    expect(() => page.handleSubmit()).not.toThrow()
    expect(requests).toHaveLength(1)
    jest.advanceTimersByTime(20000)
    expect(page.data).toMatchObject({ saving: false, isDirty: true, configRevision: 4 })
    page.handleSubmit()
    expect(requests).toHaveLength(2)
    saveSuccess(requests[1])
    expect(page.data).toMatchObject({ saving: false, isDirty: false, configRevision: 5 })
  })

  test.each(["success", "failure"])("关闭加载提示抛错不打断 %s 回执与计时清理", (outcome) => {
    wx.hideLoading.mockImplementation(() => { throw new Error("hide unavailable") })
    page.handleSubmit()
    expect(() => {
      if (outcome === "success") saveSuccess()
      else requests[0].fail({ errMsg: "连接中断" })
    }).not.toThrow()
    expect(page.data.saving).toBe(false)
    expect(page.data.isDirty).toBe(outcome !== "success")
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("应用切后台仍在栈顶时暂缓提示，返回前台只提示一次", () => {
    const app = { globalData: { nativeActionAppVisible: true } }
    global.getApp = () => app
    page.handleSubmit()
    page.onHide()
    app.globalData.nativeActionAppVisible = false
    saveSuccess()
    page.onShow()
    expect(wx.showToast).not.toHaveBeenCalled()
    app.globalData.nativeActionAppVisible = true
    page.onShow()
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("超时后重试时旧成功只清缓存，不覆盖新草稿或结束新请求", () => {
    const { clearOperationConfigCache } = require("../shared/operationConfigRequest")
    page.handleSubmit()
    leave()
    jest.advanceTimersByTime(20000)
    stack = [page]
    page.onShow()
    wx.showToast.mockClear()
    editBrand("第二次配置")
    page.handleSubmit()
    saveSuccess()
    expect(clearOperationConfigCache).toHaveBeenCalledTimes(3)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data).toMatchObject({ saving: true, configRevision: 4, form: { brandName: "第二次配置" } })
    requests[1].success({ result: { ok: false, code: "CONFIG_CONFLICT", message: "配置已被修改" } })
    expect(page.data).toMatchObject({ saving: false, saveConflict: true, isDirty: true })
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("卸载丢弃待交付结果，迟到成功仍清缓存且不能重新提交", () => {
    const { clearOperationConfigCache } = require("../shared/operationConfigRequest")
    page.handleSubmit()
    leave()
    requests[0].fail({ errMsg: "连接中断" })
    page.onUnload()
    stack = [page]
    page.onShow()
    page.handleSubmit()
    saveSuccess()
    expect(requests).toHaveLength(1)
    expect(clearOperationConfigCache).toHaveBeenCalledTimes(2)
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("冲突后成功重新读取线上配置，不再提示已过期的保存冲突", () => {
    page.handleSubmit()
    leave()
    requests[0].success({ result: { ok: false, code: "CONFIG_CONFLICT", message: "旧版本冲突" } })
    stack = [page]
    page.handleRetryLoad()
    requests[1].success({ result: { ok: true, config: { brandName: "重新读取的配置" }, revision: 6 } })
    page.onShow()
    expect(page.data).toMatchObject({ configRevision: 6, isDirty: false, saveConflict: false })
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("开始新草稿后不再交付上次保存结果", () => {
    page.handleSubmit()
    leave()
    saveSuccess()
    stack = [page]
    editBrand("下一轮草稿")
    page.onShow()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data).toMatchObject({ isDirty: true, form: { brandName: "下一轮草稿" } })
  })
})
