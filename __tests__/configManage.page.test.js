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
  require("../pages/config-manage/config-manage")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      form: {
        ...definition.data.form
      }
    }
  }
  page.setData = jest.fn((patch, done) => {
    Object.entries(patch).forEach(([key, value]) => {
      const segments = key.split(".")
      if (segments.length === 1) {
        page.data[key] = value
        return
      }
      let target = page.data
      segments.slice(0, -1).forEach((segment) => {
        target[segment] = target[segment] || {}
        target = target[segment]
      })
      target[segments[segments.length - 1]] = value
    })
    if (typeof done === "function") {
      done()
    }
  })
  return page
}

describe("pages/config-manage 运营配置体验", () => {
  beforeEach(() => {
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
  })

  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("四个配置分组使用对应原生图标并提供吸底保存状态", () => {
    const pageDir = path.resolve(__dirname, "../pages/config-manage")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "config-manage.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "config-manage.wxss"), "utf8")

    expect(wxmlSource).toContain("section-glyph-brand")
    expect(wxmlSource).toContain("section-glyph-home")
    expect(wxmlSource).toContain("section-glyph-content")
    expect(wxmlSource).toContain("section-glyph-reservation")
    expect(wxmlSource).toContain("field-counter")
    expect(wxmlSource).toContain("template-state")
    expect(wxmlSource).toContain("action-dock")
    expect(wxmlSource).toContain("save-native-icon")
    expect(wxmlSource).toContain("config-retry-native-icon")
    expect(wxmlSource).toContain("config-reset-native-icon")
    expect(wxmlSource).toContain('disabled="{{saving || loadFailed || !hasLoadedConfig}}"')
    expect(wxmlSource).not.toContain('bindtap="handleRetryLoad">重新加载配置</button>')
    expect(wxmlSource).not.toContain('bindtap="handleReset">恢复默认</button>')
    expect(wxssSource).toMatch(/\.action-dock\s*\{[\s\S]*?position:\s*sticky/)
    expect(wxssSource).toContain(".save-state-mark-dirty")
    expect(wxssSource).toContain(".config-action-native-icon")
  })

  test("编辑字段与恢复默认都会标记存在未保存修改", () => {
    const page = createPage(loadPageDefinition())
    page.data.hasLoadedConfig = true

    page.handleInput({
      currentTarget: {
        dataset: {
          field: "brandName"
        }
      },
      detail: {
        value: "极境车库 · 西湖店"
      }
    })

    expect(page.data.form.brandName).toBe("极境车库 · 西湖店")
    expect(page.data.isDirty).toBe(true)

    page.data.isDirty = false
    page.handleReset()
    expect(page.data.form.brandName).toBe("极境车库")
    expect(page.data.isDirty).toBe(true)
  })

  test("成功加载与保存后恢复线上已同步状态", () => {
    wx.cloud.callFunction.mockImplementation(({ name, success }) => {
      if (name === "operationConfigGet") {
        success({
          result: {
            ok: true,
            config: {
              brandName: "极境车库"
            }
          }
        })
        return
      }
      success({
        result: {
          ok: true,
          message: "保存成功",
          config: {
            brandName: "极境车库"
          }
        }
      })
    })

    const page = createPage(loadPageDefinition())
    page.fetchConfig()
    expect(page.data.hasLoadedConfig).toBe(true)
    expect(page.data.isDirty).toBe(false)

    page.data.isDirty = true
    page.handleSubmit()
    expect(page.data.saving).toBe(false)
    expect(page.data.isDirty).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "保存成功",
      icon: "success"
    })
  })
})
