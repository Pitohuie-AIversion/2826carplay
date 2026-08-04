const fs = require("fs")
const path = require("path")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const PAGES_ROOT = path.join(PROJECT_ROOT, "pages")

function collectFiles(directory, suffix, list = []) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      collectFiles(fullPath, suffix, list)
    } else if (entry.isFile() && entry.name.endsWith(suffix)) {
      list.push(fullPath)
    }
  })
  return list
}

function getProtectedPages() {
  return collectFiles(PAGES_ROOT, ".js")
    .filter((filePath) => fs.readFileSync(filePath, "utf8").includes("requirePagePermission"))
    .map((filePath) => ({
      jsPath: filePath,
      wxmlPath: filePath.replace(/\.js$/, ".wxml"),
      relativePath: path.relative(PROJECT_ROOT, filePath).replace(/\\/g, "/")
    }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
}

function createPage() {
  return {
    data: {
      pageAuthorized: false
    },
    setData(update) {
      Object.assign(this.data, update)
    }
  }
}

describe("后台页面前置鉴权", () => {
  const protectedPages = getProtectedPages()

  test("所有使用权限守卫的页面都纳入检查", () => {
    expect(protectedPages).toHaveLength(17)
  })

  test.each(protectedPages)("$relativePath 仅在鉴权成功后渲染", ({ jsPath, wxmlPath }) => {
    const jsSource = fs.readFileSync(jsPath, "utf8")
    const wxmlSource = fs.readFileSync(wxmlPath, "utf8").trimStart()
    const rootTag = wxmlSource.split(/\r?\n/, 1)[0]

    expect(jsSource).toMatch(/pageAuthorized\s*:\s*false/)
    expect(rootTag).toContain('wx:if="{{pageAuthorized}}"')
  })
})

describe("shared/pageAuth", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    global.getCurrentPages = jest.fn(() => [])
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn(),
      navigateBack: jest.fn(),
      redirectTo: jest.fn(),
      reLaunch: jest.fn()
    }
  })

  afterEach(() => {
    jest.useRealTimers()
    delete global.getCurrentPages
    delete global.wx
  })

  test("权限通过后才显示页面并加载业务数据", () => {
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({
        result: {
          ok: true,
          canManageRoles: true
        }
      })
    })
    const page = createPage()
    const onAuthorized = jest.fn()
    const { requirePagePermission } = require("../shared/pageAuth")

    requirePagePermission(page, {
      required: "canManageRoles",
      onAuthorized
    })

    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "getMyPermissions"
    }))
    expect(page.data.pageAuthorized).toBe(true)
    expect(onAuthorized).toHaveBeenCalledTimes(1)
  })

  test("权限不足时保持隐藏并返回我的页面", () => {
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({
        result: {
          ok: true,
          canManageRoles: false
        }
      })
    })
    const page = createPage()
    const onAuthorized = jest.fn()
    const { requirePagePermission } = require("../shared/pageAuth")

    requirePagePermission(page, {
      required: "canManageRoles",
      noPermissionMessage: "无权访问权限管理",
      onAuthorized
    })
    jest.runAllTimers()

    expect(page.data.pageAuthorized).toBe(false)
    expect(onAuthorized).not.toHaveBeenCalled()
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "无权访问权限管理",
      icon: "none"
    })
    expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
      url: "/pages/mine/mine"
    }))
  })

  test("权限服务内部错误不会误报为无权限", () => {
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({
        result: {
          ok: false,
          code: "INTERNAL_ERROR",
          message: "获取权限信息失败，请稍后重试"
        }
      })
    })
    const page = createPage()
    const { requirePagePermission } = require("../shared/pageAuth")

    requirePagePermission(page, {
      required: "canManageRoles",
      noPermissionMessage: "无权访问权限管理",
      failMessage: "权限校验失败，请稍后重试"
    })
    jest.runAllTimers()

    expect(page.data.pageAuthorized).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "权限校验失败，请稍后重试",
      icon: "none"
    })
    expect(wx.showToast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "无权访问权限管理"
    }))
  })

  test("权限请求超时后退出空白等待且忽略迟到回调", () => {
    let lateSuccess
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      lateSuccess = success
    })
    const page = createPage()
    const onAuthorized = jest.fn()
    const { requirePagePermission } = require("../shared/pageAuth")

    requirePagePermission(page, {
      required: "canManageRoles",
      onAuthorized
    })
    jest.advanceTimersByTime(12 * 1000)

    expect(wx.showToast).toHaveBeenCalledWith({
      title: "权限校验失败，请稍后重试",
      icon: "none"
    })

    lateSuccess({ result: { ok: true, canManageRoles: true } })
    expect(page.data.pageAuthorized).toBe(false)
    expect(onAuthorized).not.toHaveBeenCalled()
  })

  test("权限调用同步异常时给出校验失败而不是让页面崩溃", () => {
    wx.cloud.callFunction.mockImplementation(() => {
      throw new Error("cloud is not initialized")
    })
    const page = createPage()
    const { requirePagePermission } = require("../shared/pageAuth")

    expect(() => requirePagePermission(page, {
      required: "canManageRoles"
    })).not.toThrow()

    expect(wx.showToast).toHaveBeenCalledWith({
      title: "权限校验失败，请稍后重试",
      icon: "none"
    })
  })

  test("权限调用 fail 回调与内部错误使用相同的服务失败提示", () => {
    wx.cloud.callFunction.mockImplementation(({ fail }) => {
      fail({ errMsg: "callFunction:fail network" })
    })
    const page = createPage()
    const { requirePagePermission } = require("../shared/pageAuth")

    requirePagePermission(page, {
      required: "canManageRoles",
      noPermissionMessage: "无权访问权限管理"
    })

    expect(wx.showToast).toHaveBeenCalledWith({
      title: "权限校验失败，请稍后重试",
      icon: "none"
    })
    expect(wx.showToast).not.toHaveBeenCalledWith(expect.objectContaining({
      title: "无权访问权限管理"
    }))
  })

  test("云能力缺失时明确提示并返回我的页面", () => {
    wx.cloud = null
    const page = createPage()
    const { requirePagePermission } = require("../shared/pageAuth")

    requirePagePermission(page, { required: "canManageRoles" })
    jest.advanceTimersByTime(500)

    expect(wx.showToast).toHaveBeenCalledWith({
      title: "云能力未初始化",
      icon: "none"
    })
    expect(wx.redirectTo).toHaveBeenCalledWith(expect.objectContaining({
      url: "/pages/mine/mine"
    }))
  })

  test("函数型权限条件通过时正常授权", () => {
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({
        result: {
          ok: true,
          canManageVehicles: false,
          canManageBookings: true
        }
      })
    })
    const page = createPage()
    const onAuthorized = jest.fn()
    const { requirePagePermission } = require("../shared/pageAuth")

    requirePagePermission(page, {
      required: (result) => result.canManageVehicles || result.canManageBookings,
      onAuthorized
    })

    expect(page.data.pageAuthorized).toBe(true)
    expect(onAuthorized).toHaveBeenCalledWith(expect.objectContaining({
      canManageBookings: true
    }))
  })

  test("页面卸载清理函数会取消超时并忽略迟到回调", () => {
    let lateSuccess
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      lateSuccess = success
    })
    const page = createPage()
    const onAuthorized = jest.fn()
    const { requirePagePermission } = require("../shared/pageAuth")

    const cancel = requirePagePermission(page, {
      required: "canManageRoles",
      onAuthorized
    })
    cancel()
    jest.advanceTimersByTime(12 * 1000)
    lateSuccess({ result: { ok: true, canManageRoles: true } })

    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.data.pageAuthorized).toBe(false)
    expect(onAuthorized).not.toHaveBeenCalled()
  })

  test("存在上一页时优先返回上一页", () => {
    global.getCurrentPages.mockReturnValue([{}, {}])
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({ result: { ok: true, canManageRoles: false } })
    })
    const page = createPage()
    const { requirePagePermission } = require("../shared/pageAuth")

    requirePagePermission(page, { required: "canManageRoles" })
    jest.advanceTimersByTime(700)

    expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }))
    expect(wx.redirectTo).not.toHaveBeenCalled()
  })
})
