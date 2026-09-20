const fs = require("fs")
const path = require("path")

const { clearUnsaved, markUnsaved } = require("../shared/unsavedChanges")

describe("未保存修改提醒", () => {
  afterEach(() => {
    delete global.wx
  })

  test("重复编辑只启用一次提醒，保存后解除", () => {
    global.wx = {
      enableAlertBeforeUnload: jest.fn(),
      disableAlertBeforeUnload: jest.fn()
    }
    const page = {}

    markUnsaved(page, "资料尚未保存")
    markUnsaved(page, "资料尚未保存")
    clearUnsaved(page)

    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(wx.enableAlertBeforeUnload).toHaveBeenCalledWith({ message: "资料尚未保存" })
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
    expect(page._hasUnsavedChanges).toBe(false)
  })

  test("车辆、权限与运营配置表单统一接入离开提醒", () => {
    ;[
      "pages-admin/vehicle-create/vehicle-create.js",
      "pages-admin/vehicle-edit/vehicle-edit.js",
      "pages-admin/role-manage/role-manage.js",
      "pages-admin/config-manage/config-manage.js",
      "pages/booking/booking.js"
    ].forEach((relativePath) => {
      const source = fs.readFileSync(path.resolve(__dirname, `../${relativePath}`), "utf8")
      expect(source).toContain("markUnsaved(this")
      expect(source).toContain("clearUnsaved(this)")
    })
  })
})
