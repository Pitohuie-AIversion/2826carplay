const fs = require("fs")
const path = require("path")

jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  clearPagePermissionCache: jest.fn(),
  requirePagePermission: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages-admin/role-manage/role-manage")
  return definition
}

function createPage(definition, data) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      permissionOptions: definition.data.permissionOptions.map((item) => ({ ...item })),
      ...(data || {})
    }
  }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  return page
}

describe("pages/role-manage 权限视觉与选择", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test("权限选项包含功能图标与说明并可切换选中态", () => {
    const page = createPage(loadPageDefinition(), {
      initialLoading: false,
      loading: false
    })

    expect(page.data.permissionOptions).toEqual([
      expect.objectContaining({ value: "vehicle_manage", icon: "car", active: false }),
      expect.objectContaining({ value: "booking_manage", icon: "calendar", active: false })
    ])

    page.handleTogglePermission({ currentTarget: { dataset: { value: "vehicle_manage" } } })

    expect(page.data.selectedPermissions).toEqual(["vehicle_manage"])
    expect(page.data.permissionOptions[0].active).toBe(true)
  })

  test("角色列表无回调时超时收尾并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    const done = jest.fn()
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const existingList = [{ openid: "existing_member" }]
    const page = createPage(loadPageDefinition(), {
      initialLoading: false,
      list: existingList,
      page: 2,
      hasMore: true
    })

    page.fetchRoleList({ append: true }, done)
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.list).toBe(existingList)
    expect(page.data.page).toBe(2)
    expect(page.data.hasMore).toBe(true)
    expect(done).toHaveBeenCalledTimes(1)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "加载超时，请检查网络后重试",
      icon: "none"
    })

    lateSuccess({
      result: {
        ok: true,
        page: 3,
        hasMore: false,
        list: [{ openid: "late_member", permissions: [] }]
      }
    })
    expect(page.data.list).toBe(existingList)
    expect(page.data.page).toBe(2)
  })

  test("新角色列表请求覆盖旧请求且旧结果不会回写", () => {
    const requests = []
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchRoleList()
    page.fetchRoleList()
    requests[1].success({
      result: {
        ok: true,
        page: 0,
        hasMore: false,
        list: [{ openid: "fresh_member", permissions: ["vehicle_manage"] }]
      }
    })
    requests[0].success({
      result: {
        ok: true,
        page: 0,
        hasMore: false,
        list: [{ openid: "stale_member", permissions: [] }]
      }
    })

    expect(page.data.list).toHaveLength(1)
    expect(page.data.list[0].openid).toBe("fresh_member")
  })

  test("权限保存固定提交快照并在超时后恢复操作", () => {
    jest.useFakeTimers()
    let request
    global.wx = {
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn((options) => {
          request = options
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      initialLoading: false,
      loading: false,
      formOpenid: "member_1",
      selectedPermissions: ["vehicle_manage"]
    })

    page.handleSubmit()
    page.data.selectedPermissions.push("booking_manage")

    expect(request.data).toEqual({
      openid: "member_1",
      permissions: ["vehicle_manage"]
    })
    jest.advanceTimersByTime(20 * 1000)
    expect(page.data.saving).toBe(false)
    expect(global.wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "保存超时，请检查网络后重试",
      icon: "none"
    })

    request.success({ result: { ok: true, message: "保存成功" } })
    expect(page.data.formOpenid).toBe("member_1")
  })

  test("权限保存遇到云 SDK 同步异常时安全结束", () => {
    global.wx = {
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud down")
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      initialLoading: false,
      loading: false,
      formOpenid: "member_1",
      selectedPermissions: ["booking_manage"]
    })

    expect(() => page.handleSubmit()).not.toThrow()
    expect(page.data.saving).toBe(false)
    expect(global.wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "cloud down",
      icon: "none"
    })
  })

  test("权限保存成功后清除页面权限缓存", () => {
    let request
    global.wx = { showLoading: jest.fn(), hideLoading: jest.fn(), showToast: jest.fn(), cloud: { callFunction: jest.fn((options) => { request = options }) } }
    const page = createPage(loadPageDefinition(), { initialLoading: false, formOpenid: "member_1" })
    const { clearPagePermissionCache } = require("../shared/pageAuth")
    page.fetchRoleList = jest.fn()
    page.handleSubmit()
    request.success({ result: { ok: true } })
    expect(clearPagePermissionCache).toHaveBeenCalledTimes(2)
    expect(page.fetchRoleList).toHaveBeenCalledTimes(1)
  })

  test.each(["network", "server", "timeout", "success"])("保存%s在切页后完成不会干扰新页面的反馈", (result) => {
    jest.useFakeTimers()
    const requests = []
    global.wx = {
      showLoading: jest.fn(), hideLoading: jest.fn(), showToast: jest.fn(),
      cloud: { callFunction: jest.fn((request) => requests.push(request)) }
    }
    const page = createPage(loadPageDefinition(), {
      initialLoading: false, formOpenid: "member_1", selectedPermissions: ["vehicle_manage"]
    })
    global.getCurrentPages = () => [page]
    page.handleSubmit()
    page.onHide()
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    global.getCurrentPages = () => [page, {}]
    wx.showLoading({ title: "新页面加载中" })
    if (result === "network") requests[0].fail({ errMsg: "network" })
    else if (result === "timeout") jest.advanceTimersByTime(20000)
    else requests[0].success({ result: { ok: result === "success" } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(page.data.saving).toBe(false)
    if (result !== "success") {
      expect(page.data.formOpenid).toBe("member_1")
      expect(page.data.selectedPermissions).toEqual(["vehicle_manage"])
    }
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["network", "server", "timeout"])("列表%s在切页后完成不会在新页面弹出提示", (result) => {
    jest.useFakeTimers()
    let request
    global.wx = { showToast: jest.fn(), cloud: { callFunction: jest.fn((options) => { request = options }) } }
    const page = createPage(loadPageDefinition())
    global.getCurrentPages = () => [page]
    page.fetchRoleList()
    global.getCurrentPages = () => [page, {}]
    if (result === "network") request.fail({ errMsg: "network" })
    else if (result === "server") request.success({ result: { ok: false } })
    else jest.advanceTimersByTime(15000)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data.loading).toBe(false)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["timeout", "unload"])("权限写入%s后迟到成功仍清理权限缓存且不覆盖草稿", (end) => {
    jest.useFakeTimers()
    let request
    global.wx = {
      showLoading: jest.fn(), hideLoading: jest.fn(), showToast: jest.fn(),
      cloud: { callFunction: jest.fn((options) => { request = options }) }
    }
    const page = createPage(loadPageDefinition(), { initialLoading: false, formOpenid: "member_1" })
    const { clearPagePermissionCache } = require("../shared/pageAuth")
    page.handleSubmit()
    expect(clearPagePermissionCache).toHaveBeenCalledTimes(1)
    if (end === "timeout") {
      jest.advanceTimersByTime(20000)
      page.handleOpenidInput({ detail: { value: "member_2" } })
    } else page.onUnload()
    const expectedOpenid = page.data.formOpenid
    const setDataCount = page.setData.mock.calls.length
    const toastCount = wx.showToast.mock.calls.length
    request.success({ result: { ok: true } })
    expect(clearPagePermissionCache).toHaveBeenCalledTimes(2)
    expect(page.data.formOpenid).toBe(expectedOpenid)
    expect(page.setData).toHaveBeenCalledTimes(setDataCount)
    expect(wx.showToast).toHaveBeenCalledTimes(toastCount)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("旧保存迟到成功只失效缓存，不结束正在进行的新保存", () => {
    jest.useFakeTimers()
    const requests = []
    global.wx = {
      showLoading: jest.fn(), hideLoading: jest.fn(), showToast: jest.fn(),
      cloud: { callFunction: jest.fn((options) => requests.push(options)) }
    }
    const page = createPage(loadPageDefinition(), { initialLoading: false, formOpenid: "member_1" })
    const { clearPagePermissionCache } = require("../shared/pageAuth")
    page.handleSubmit()
    jest.advanceTimersByTime(20000)
    page.handleOpenidInput({ detail: { value: "member_2" } })
    page.handleSubmit()
    const toastCount = wx.showToast.mock.calls.length
    requests[0].success({ result: { ok: true } })
    expect(clearPagePermissionCache).toHaveBeenCalledTimes(3)
    expect(page.data.saving).toBe(true)
    expect(page.data.formOpenid).toBe("member_2")
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledTimes(toastCount)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("成员列表使用盾牌和成员图标而非字母头像", () => {
    const pageDir = path.resolve(__dirname, "../pages-admin/role-manage")
    const wxml = fs.readFileSync(path.join(pageDir, "role-manage.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "role-manage.wxss"), "utf8")

    expect(wxml).toContain("permission-icon-{{item.icon}}")
    expect(wxml).toContain('aria-role="checkbox"')
    expect(wxml).toContain("role-shield-icon")
    expect(wxml).toContain("role-member-icon")
    expect(wxml).not.toContain(">Admin</view>")
    expect(wxss).toContain(".permission-icon-car")
    expect(wxss).toContain(".permission-icon-calendar")
  })

  test("权限表单和成员列表操作使用对应原生图标", () => {
    const pageDir = path.resolve(__dirname, "../pages-admin/role-manage")
    const wxml = fs.readFileSync(path.join(pageDir, "role-manage.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "role-manage.wxss"), "utf8")

    expect(wxml).toContain("role-tip-native-icon")
    expect(wxml).toContain("role-save-native-icon")
    expect(wxml).toContain("role-reset-native-icon")
    expect(wxml).toContain("role-edit-native-icon")
    expect(wxml).toContain("role-more-native-icon")
    expect(wxml).toContain("role-complete-native-icon")
    expect(wxml).toContain('aria-label="保存当前成员权限"')
    expect(wxml).toContain('aria-label="清空权限表单"')
    expect(wxml).toContain(
      'loading="{{saving}}" disabled="{{initialLoading || loading || saving}}"'
    )
    expect(wxml).toContain('disabled="{{initialLoading || loading || saving || !!editingOpenid}}"')
    expect(wxml).toContain('aria-disabled="{{initialLoading || loading || saving}}"')
    expect(wxml).toContain("{{saving ? '正在保存' : '保存权限'}}")
    expect(wxml).toContain("{{loading ? '正在加载' : '加载更多'}}")
    expect(wxml).not.toContain('bindtap="handleResetForm">清空表单</button>')
    expect(wxss).toContain(".role-action-content")
    expect(wxss).toContain(".role-list-end")
    expect(wxss).toContain(".permission-option-disabled")
  })

  test("角色列表读取期间冻结表单和成员操作", () => {
    global.wx = {
      stopPullDownRefresh: jest.fn(),
      showLoading: jest.fn(),
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn()
      }
    }
    const page = createPage(loadPageDefinition(), {
      pageAuthorized: true,
      initialLoading: false,
      loading: true,
      formOpenid: "member_original",
      selectedPermissions: ["vehicle_manage"],
      editingOpenid: "",
      list: [
        {
          openid: "member_edit",
          permissions: ["booking_manage"]
        }
      ]
    })

    page.handleOpenidInput({ detail: { value: "member_changed" } })
    page.handleTogglePermission({
      currentTarget: { dataset: { value: "booking_manage" } }
    })
    page.handleEditRole({
      currentTarget: {
        dataset: {
          openid: "member_edit",
          permissions: ["booking_manage"]
        }
      }
    })
    page.handleResetForm()
    page.handleSubmit()
    page.onPullDownRefresh()

    expect(page.data.formOpenid).toBe("member_original")
    expect(page.data.selectedPermissions).toEqual(["vehicle_manage"])
    expect(page.data.editingOpenid).toBe("")
    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(global.wx.showLoading).not.toHaveBeenCalled()
    expect(global.wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
  })

  test("权限保存期间底层角色读取入口直接收尾", () => {
    const done = jest.fn()
    global.wx = {
      showToast: jest.fn(),
      cloud: {
        callFunction: jest.fn()
      }
    }
    const page = createPage(loadPageDefinition(), {
      initialLoading: false,
      loading: false,
      saving: true
    })

    page.fetchRoleList(done)

    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(done).toHaveBeenCalledTimes(1)
  })
})
