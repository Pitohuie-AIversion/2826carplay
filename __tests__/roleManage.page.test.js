const fs = require("fs")
const path = require("path")

jest.mock("../shared/pageAuth", () => ({
  requirePagePermission: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/role-manage/role-manage")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      permissionOptions: definition.data.permissionOptions.map((item) => ({ ...item }))
    }
  }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  return page
}

describe("pages/role-manage 权限视觉与选择", () => {
  afterEach(() => {
    delete global.Page
  })

  test("权限选项包含功能图标与说明并可切换选中态", () => {
    const page = createPage(loadPageDefinition())

    expect(page.data.permissionOptions).toEqual([
      expect.objectContaining({ value: "vehicle_manage", icon: "car", active: false }),
      expect.objectContaining({ value: "booking_manage", icon: "calendar", active: false })
    ])

    page.handleTogglePermission({ currentTarget: { dataset: { value: "vehicle_manage" } } })

    expect(page.data.selectedPermissions).toEqual(["vehicle_manage"])
    expect(page.data.permissionOptions[0].active).toBe(true)
  })

  test("成员列表使用盾牌和成员图标而非字母头像", () => {
    const pageDir = path.resolve(__dirname, "../pages/role-manage")
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
    const pageDir = path.resolve(__dirname, "../pages/role-manage")
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
    expect(wxml).toContain('loading="{{saving}}" disabled="{{saving}}"')
    expect(wxml).toContain("{{saving ? '正在保存' : '保存权限'}}")
    expect(wxml).toContain("{{loading ? '正在加载' : '加载更多'}}")
    expect(wxml).not.toContain('bindtap="handleResetForm">清空表单</button>')
    expect(wxss).toContain(".role-action-content")
    expect(wxss).toContain(".role-list-end")
  })
})
