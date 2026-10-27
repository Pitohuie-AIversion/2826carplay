jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  clearPagePermissionCache: jest.fn(),
  requirePagePermission: jest.fn()
}))

describe("role save feedback and native loading recovery", () => {
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
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages-admin/role-manage/role-manage")
    Object.assign(page.data, { pageAuthorized: true, initialLoading: false, formOpenid: "member_1", selectedPermissions: ["vehicle_manage"] })
    page.fetchRoleList = jest.fn()
    stack = [page]
    global.getCurrentPages = () => stack
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

  function leave() {
    page.onHide()
    stack = [page, {}]
  }

  test.each(["network", "server", "timeout", "success"])("后台保存 %s 返回后交付一次结果，失败保留权限草稿", (outcome) => {
    page.handleTogglePermission({ currentTarget: { dataset: { value: "booking_manage" } } })
    page.handleSubmit()
    leave()
    if (outcome === "network") requests[0].fail({ errMsg: "保存连接中断" })
    else if (outcome === "server") requests[0].success({ result: { ok: false, message: "服务暂不可用" } })
    else if (outcome === "timeout") jest.advanceTimersByTime(20000)
    else requests[0].success({ result: { ok: true, message: "权限已更新" } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    stack = [page]
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: { network: "保存连接中断", server: "服务暂不可用", timeout: "保存超时，请检查网络后重试", success: "权限已更新" }[outcome],
      icon: outcome === "success" ? "success" : "none"
    })
    expect(page.data.saving).toBe(false)
    if (outcome !== "success") {
      expect(page.data.formOpenid).toBe("member_1")
      expect(page.data.selectedPermissions).toEqual(["vehicle_manage", "booking_manage"])
      expect(page._hasUnsavedChanges).toBe(true)
    } else {
      expect(page.data.formOpenid).toBe("")
      expect(page.fetchRoleList).toHaveBeenCalledTimes(1)
    }
    requests[0].fail({ errMsg: "迟到失败" })
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("加载提示同步异常不妨碍保存和超时收尾，仍可重试", () => {
    wx.showLoading.mockImplementationOnce(() => { throw new Error("loading unavailable") })
    expect(() => page.handleSubmit()).not.toThrow()
    expect(requests).toHaveLength(1)
    jest.advanceTimersByTime(20000)
    expect(page.data.saving).toBe(false)
    expect(page.data.formOpenid).toBe("member_1")
    page.handleSubmit()
    expect(requests).toHaveLength(2)
    requests[1].success({ result: { ok: true } })
    expect(page.data.saving).toBe(false)
  })

  test.each(["success", "failure"])("关闭加载提示抛错不会打断 %s 回执处理", (outcome) => {
    wx.hideLoading.mockImplementation(() => { throw new Error("hide unavailable") })
    page.handleSubmit()
    expect(() => {
      if (outcome === "success") requests[0].success({ result: { ok: true } })
      else requests[0].fail({ errMsg: "连接中断" })
    }).not.toThrow()
    expect(page.data.saving).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("应用后台仍在栈顶时不提示，回前台再交付一次保存结果", () => {
    const app = { globalData: { nativeActionAppVisible: true } }
    global.getApp = () => app
    page.handleSubmit()
    page.onHide()
    app.globalData.nativeActionAppVisible = false
    requests[0].fail({ errMsg: "连接中断" })
    expect(wx.showToast).not.toHaveBeenCalled()
    page.onShow()
    expect(wx.showToast).not.toHaveBeenCalled()
    app.globalData.nativeActionAppVisible = true
    page.onShow()
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("后台保存超时后重试，旧成功只失效权限缓存，不结束新保存", () => {
    const { clearPagePermissionCache } = require("../shared/pageAuth")
    page.handleSubmit()
    leave()
    jest.advanceTimersByTime(20000)
    stack = [page]
    page.onShow()
    wx.showToast.mockClear()
    page.handleOpenidInput({ detail: { value: "member_2" } })
    page.handleSubmit()
    requests[0].success({ result: { ok: true, message: "旧账号已保存" } })
    expect(clearPagePermissionCache).toHaveBeenCalledTimes(3)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data).toMatchObject({ formOpenid: "member_2", saving: true })
    requests[1].fail({ errMsg: "新请求失败" })
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: "新请求失败", icon: "none" })
  })

  test("卸载丢弃待交付反馈，迟到成功仍失效缓存且不能重新提交", () => {
    const { clearPagePermissionCache } = require("../shared/pageAuth")
    page.handleSubmit()
    leave()
    requests[0].fail({ errMsg: "连接中断" })
    page.onUnload()
    stack = [page]
    page.onShow()
    page.handleSubmit()
    requests[0].success({ result: { ok: true } })
    expect(requests).toHaveLength(1)
    expect(clearPagePermissionCache).toHaveBeenCalledTimes(2)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page._pendingRoleSaveFeedback).toBeNull()
  })
})
