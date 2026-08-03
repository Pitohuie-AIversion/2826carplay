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
})
