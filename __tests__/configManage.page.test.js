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

function createPage(definition, overrides) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      form: {
        ...definition.data.form
      },
      ...(overrides || {})
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
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("存在未保存修改时下拉刷新不会覆盖表单", () => {
    wx.stopPullDownRefresh = jest.fn()
    const page = createPage(loadPageDefinition(), {
      pageAuthorized: true,
      isDirty: true
    })

    page.onPullDownRefresh()

    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(wx.stopPullDownRefresh).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "请先保存或重置修改",
      icon: "none"
    })
  })

  test("配置加载无回调时超时收尾并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    const done = jest.fn()
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      lateSuccess = success
    })
    const page = createPage(loadPageDefinition())

    page.fetchConfig(done)
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.loadFailed).toBe(true)
    expect(page.data.loadErrorText).toBe("配置加载超时，请检查网络后重试")
    expect(done).toHaveBeenCalledTimes(1)

    lateSuccess({
      result: {
        ok: true,
        config: { brandName: "迟到配置" }
      }
    })
    expect(page.data.form.brandName).not.toBe("迟到配置")
    expect(page.data.loadFailed).toBe(true)
  })

  test("新配置加载请求覆盖旧请求且旧结果不会回写", () => {
    const requests = []
    wx.cloud.callFunction.mockImplementation((options) => requests.push(options))
    const page = createPage(loadPageDefinition())

    page.fetchConfig()
    page.fetchConfig()
    requests[1].success({
      result: {
        ok: true,
        config: { brandName: "最新配置" }
      }
    })
    requests[0].success({
      result: {
        ok: true,
        config: { brandName: "过期配置" }
      }
    })

    expect(page.data.form.brandName).toBe("最新配置")
    expect(page.data.loadFailed).toBe(false)
  })

  test("配置保存固定提交快照并在超时后保留当前编辑", () => {
    jest.useFakeTimers()
    let request
    wx.cloud.callFunction.mockImplementation((options) => {
      request = options
    })
    const page = createPage(loadPageDefinition(), {
      hasLoadedConfig: true,
      loadFailed: false,
      isDirty: true
    })
    page.data.form.brandName = "提交配置"

    page.handleSubmit()
    page.data.form.brandName = "继续编辑"

    expect(request.data.config.brandName).toBe("提交配置")
    jest.advanceTimersByTime(20 * 1000)
    expect(page.data.saving).toBe(false)
    expect(page.data.isDirty).toBe(true)
    expect(page.data.form.brandName).toBe("继续编辑")
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "保存超时，请重试",
      icon: "none"
    })

    request.success({
      result: {
        ok: true,
        message: "保存成功",
        config: { brandName: "迟到服务端配置" }
      }
    })
    expect(page.data.form.brandName).toBe("继续编辑")
    expect(page.data.isDirty).toBe(true)
  })

  test("配置保存遇到云 SDK 同步异常时安全结束", () => {
    wx.cloud.callFunction.mockImplementation(() => {
      throw new Error("cloud down")
    })
    const page = createPage(loadPageDefinition(), {
      hasLoadedConfig: true,
      loadFailed: false,
      isDirty: true
    })

    expect(() => page.handleSubmit()).not.toThrow()
    expect(page.data.saving).toBe(false)
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "cloud down",
      icon: "none"
    })
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
