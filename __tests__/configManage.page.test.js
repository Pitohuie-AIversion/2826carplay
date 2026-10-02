const fs = require("fs")
const path = require("path")

jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))
jest.mock("../shared/operationConfigRequest", () => ({
  clearOperationConfigCache: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages-admin/config-manage/config-manage")
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
    delete global.getCurrentPages
  })

  test.each(["network", "server", "timeout", "unavailable"])("冲突后重新加载%s失败仍保留草稿和离开提醒", (failure) => {
    jest.useFakeTimers()
    const requests = []
    wx.enableAlertBeforeUnload = jest.fn()
    wx.disableAlertBeforeUnload = jest.fn()
    wx.cloud.callFunction.mockImplementation((request) => requests.push(request))
    const page = createPage(loadPageDefinition(), { loading: false, hasLoadedConfig: true, configRevision: 4 })
    page.handleInput({ currentTarget: { dataset: { field: "brandName" } }, detail: { value: "待保存的品牌" } })
    page.handleSubmit()
    requests[0].success({ result: { ok: false, code: "CONFIG_CONFLICT" } })
    const cloud = wx.cloud
    if (failure === "unavailable") wx.cloud = null
    page.handleRetryLoad()
    if (failure === "network") requests[1].fail({ errMsg: "network" })
    else if (failure === "server") requests[1].success({ result: { ok: false } })
    else if (failure === "timeout") jest.advanceTimersByTime(15000)
    expect(page.data).toMatchObject({ isDirty: true, saveConflict: true, configRevision: 4, form: { brandName: "待保存的品牌" } })
    expect(page._hasUnsavedChanges).toBe(true)
    expect(wx.disableAlertBeforeUnload).not.toHaveBeenCalled()
    wx.cloud = cloud
    page.handleRetryLoad()
    requests[requests.length - 1].success({ result: { ok: true, config: { brandName: "线上新品牌" }, revision: 5 } })
    expect(page.data).toMatchObject({ isDirty: false, saveConflict: false, configRevision: 5, form: { brandName: "线上新品牌" } })
    expect(page._hasUnsavedChanges).toBe(false)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["network", "server", "timeout", "success"])("保存%s回调到达后台时不弹提示或关闭其他页面加载框", (result) => {
    jest.useFakeTimers()
    let request
    wx.cloud.callFunction.mockImplementation((options) => { request = options })
    const page = createPage(loadPageDefinition(), { loading: false, hasLoadedConfig: true })
    global.getCurrentPages = () => [page]
    page.handleInput({ currentTarget: { dataset: { field: "brandName" } }, detail: { value: "新品牌" } })
    page.handleSubmit()
    page.onHide()
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(page.data.saving).toBe(true)
    global.getCurrentPages = () => [page, {}]
    wx.showLoading({ title: "其他页面正在加载" })
    if (result === "network") request.fail({ errMsg: "network" })
    else if (result === "timeout") jest.advanceTimersByTime(20000)
    else request.success({ result: result === "success" ? { ok: true, config: request.data.config, revision: 5 } : { ok: false, code: "CONFIG_CONFLICT" } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(page.data.saving).toBe(false)
    expect(page.data.isDirty).toBe(result !== "success")
    if (result === "success") expect(page.data.configRevision).toBe(5)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("未保存配置卸载时清理离开提醒", () => {
    wx.enableAlertBeforeUnload = jest.fn()
    wx.disableAlertBeforeUnload = jest.fn()
    const page = createPage(loadPageDefinition(), { loading: false, hasLoadedConfig: true })
    page.handleInput({ currentTarget: { dataset: { field: "brandName" } }, detail: { value: "未保存" } })
    page.onUnload()
    expect(page._hasUnsavedChanges).toBe(false)
    expect(wx.disableAlertBeforeUnload).toHaveBeenCalledTimes(1)
  })

  test("恢复默认只生成空业务文案，清空后保存和回填不会恢复旧承诺", () => {
    wx.cloud.callFunction.mockImplementation(({ data, success }) => success({ result: { ok: true, config: data.config, revision: 1 } }))
    const page = createPage(loadPageDefinition(), { loading: false, hasLoadedConfig: true })
    Object.assign(page.data.form, { faqContent: "旧FAQ", rulesContent: "旧平台规则", rentalIncludedText: "旧承诺" })
    page.handleReset()
    expect(page.data.form).toMatchObject({ faqContent: "", rulesContent: "", rentalIncludedText: "" })
    page.handleSubmit()
    const saved = wx.cloud.callFunction.mock.calls[0][0].data.config
    expect(saved).toMatchObject({ faqContent: "", rulesContent: "" })
    expect(Object.values(saved.rentalTerms)).toEqual(Array(9).fill(""))
    expect(page.data.form).toMatchObject({ faqContent: "", rulesContent: "", rentalIncludedText: "" })
  })

  test.each([Array.from({ length: 21 }, (_, i) => `城市${i}`).join("\n"), "城".repeat(21)])("城市列表无效时保留输入并阻止请求 %s", (cityOptionsText) => {
    const page = createPage(loadPageDefinition(), { loading: false, hasLoadedConfig: true })
    page.data.form.cityOptionsText = cityOptionsText
    page.handleSubmit()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(page.data.form.cityOptionsText).toBe(cityOptionsText)
    expect(page.data.saving).toBe(false)
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

  test("保存带读取版本，冲突保留草稿直到用户显式放弃并加载最新版本", () => {
    const requests = []
    wx.cloud.callFunction.mockImplementation((request) => requests.push(request))
    const page = createPage(loadPageDefinition())
    page.fetchConfig()
    requests[0].success({ result: { ok: true, revision: 4, config: { brandName: "原品牌" } } })
    page.handleInput({ currentTarget: { dataset: { field: "brandName" } }, detail: { value: "我的草稿" } })
    page.handleSubmit()
    expect(requests[1].data.expectedRevision).toBe(4)
    requests[1].success({ result: { ok: false, code: "CONFIG_CONFLICT", message: "配置已被其他管理员修改，请重新加载后核对" } })
    expect(page.data).toMatchObject({ saving: false, saveConflict: true, isDirty: true, configRevision: 4, form: { brandName: "我的草稿" } })
    const wxml = fs.readFileSync(path.resolve(__dirname, "../pages-admin/config-manage/config-manage.wxml"), "utf8")
    expect(wxml).toContain("放弃修改并重新加载")
    page.handleRetryLoad()
    requests[2].success({ result: { ok: true, revision: 5, config: { brandName: "其他管理员品牌" } } })
    expect(page.data).toMatchObject({ saveConflict: false, isDirty: false, configRevision: 5, form: { brandName: "其他管理员品牌" } })
  })

  test("加载失败后迟到输入事件不会制造脏表单堵住重试", () => {
    const requests = []
    wx.cloud.callFunction.mockImplementation((request) => requests.push(request))
    const page = createPage(loadPageDefinition())
    page.fetchConfig()
    requests[0].fail(new Error("load failed"))
    page.handleInput({ currentTarget: { dataset: { field: "brandName" } }, detail: { value: "迟到输入" } })
    expect(page.data.isDirty).toBe(false)
    page.handleRetryLoad()
    expect(requests).toHaveLength(2)
    page.onUnload()
  })

  test.each(["timeout", "unload"])("保存%s后迟到成功只清除旧配置缓存，不回写页面", (exit) => {
    jest.useFakeTimers()
    let request
    wx.cloud.callFunction.mockImplementation((options) => { request = options })
    const page = createPage(loadPageDefinition(), { loading: false, hasLoadedConfig: true, isDirty: true, configRevision: 7 })
    const clearCache = require("../shared/operationConfigRequest").clearOperationConfigCache
    page.handleSubmit()
    expect(clearCache).toHaveBeenCalledTimes(1)
    if (exit === "timeout") jest.advanceTimersByTime(20000)
    else page.onUnload()
    page.setData.mockClear()
    wx.showToast.mockClear()
    request.success({ result: { ok: true, revision: 8, config: { brandName: "迟到成功" } } })
    expect(clearCache).toHaveBeenCalledTimes(2)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("保存期间编辑和重置不改提交快照，超时后新草稿重试不被前次成功覆盖", () => {
    jest.useFakeTimers()
    const requests = []
    wx.cloud.callFunction.mockImplementation((request) => requests.push(request))
    const page = createPage(loadPageDefinition(), { loading: false, hasLoadedConfig: true, configRevision: 7 })
    const inputBrand = (value) => page.handleInput({ currentTarget: { dataset: { field: "brandName" } }, detail: { value } })
    inputBrand("首次草稿")
    page.handleSubmit()
    inputBrand("保存期间迟到输入")
    page.handleReset()
    page.handleAddServiceHub()
    page.handleSubmit()
    expect(requests).toHaveLength(1)
    expect(page.data.form).toMatchObject({ brandName: "首次草稿", serviceHubs: [] })
    expect(requests[0].data.config.brandName).toBe("首次草稿")

    jest.advanceTimersByTime(20000)
    inputBrand("超时后新草稿")
    page.handleSubmit()
    expect(requests[1].data).toMatchObject({ expectedRevision: 7, config: { brandName: "超时后新草稿" } })
    requests[0].success({ result: { ok: true, revision: 8, config: requests[0].data.config } })
    expect(page.data).toMatchObject({ saving: true, isDirty: true, configRevision: 7, form: { brandName: "超时后新草稿" } })
    expect(jest.getTimerCount()).toBe(1)
    requests[1].success({ result: { ok: false, code: "CONFIG_CONFLICT", message: "配置已变化" } })
    expect(page.data).toMatchObject({ saving: false, isDirty: true, saveConflict: true, form: { brandName: "超时后新草稿" } })
    expect(jest.getTimerCount()).toBe(0)
    page.onUnload()
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
      loading: false,
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
      loading: false,
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

  test("配置分组使用对应原生图标并提供吸底保存状态", () => {
    const pageDir = path.resolve(__dirname, "../pages-admin/config-manage")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "config-manage.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "config-manage.wxss"), "utf8")

    expect(wxmlSource).toContain("section-glyph-brand")
    expect(wxmlSource).toContain("section-glyph-home")
    expect(wxmlSource).toContain("section-glyph-content")
    expect(wxmlSource).toContain("section-glyph-reservation")
    expect(wxmlSource).toContain("section-glyph-pricing")
    expect(wxmlSource).toContain("rentalEstimateDisclaimer")
    expect(wxmlSource).toContain("field-counter")
    expect(wxmlSource).toContain("template-state")
    expect(wxmlSource).toContain("action-dock")
    expect(wxmlSource).toContain("save-native-icon")
    expect(wxmlSource).toContain("config-retry-native-icon")
    expect(wxmlSource).toContain("config-reset-native-icon")
    expect(wxmlSource).toContain('disabled="{{loading || saving}}"')
    expect(wxmlSource).toContain(
      'disabled="{{loading || saving || loadFailed || !hasLoadedConfig}}"'
    )
    expect(wxmlSource).not.toContain('bindtap="handleRetryLoad">重新加载配置</button>')
    expect(wxmlSource).not.toContain('bindtap="handleReset">恢复默认</button>')
    expect(wxssSource).toMatch(/\.action-dock\s*\{[\s\S]*?position:\s*sticky/)
    expect(wxssSource).toContain(".save-state-mark-dirty")
    expect(wxssSource).toContain(".config-action-native-icon")
  })

  test("费用规则以结构化配置提交且不会混入预约说明", () => {
    let request = null
    wx.cloud.callFunction.mockImplementation((options) => {
      request = options
    })
    const page = createPage(loadPageDefinition(), {
      loading: false,
      hasLoadedConfig: true,
      loadFailed: false,
      isDirty: true
    })
    page.data.form.rentalIncludedText = "仅含车辆使用费"
    page.data.form.rentalDepositText = "押金会在确认前说明"

    page.handleSubmit()

    expect(request.data.config.rentalTerms).toEqual(
      expect.objectContaining({
        includedText: "仅含车辆使用费",
        depositText: "押金会在确认前说明"
      })
    )
    expect(request.data.config.bookingPrivacyTip).toBe(page.data.form.bookingPrivacyTip)
    request.success({
      result: {
        ok: true,
        message: "保存成功",
        config: request.data.config
      }
    })
  })

  test("编辑字段与恢复默认都会标记存在未保存修改", () => {
    const page = createPage(loadPageDefinition(), {
      loading: false,
      hasLoadedConfig: true
    })

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

  test("配置刷新期间冻结表单、恢复默认和保存入口", () => {
    let request = null
    wx.cloud.callFunction.mockImplementation((options) => {
      request = options
    })
    const page = createPage(loadPageDefinition(), {
      loading: false,
      hasLoadedConfig: true,
      loadFailed: false,
      isDirty: false
    })
    const originalBrandName = page.data.form.brandName

    page.fetchConfig()
    page.handleInput({
      currentTarget: { dataset: { field: "brandName" } },
      detail: { value: "刷新期间草稿" }
    })
    page.handleReset()
    page.handleSubmit()

    expect(page.data.loading).toBe(true)
    expect(page.data.form.brandName).toBe(originalBrandName)
    expect(page.data.isDirty).toBe(false)
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.showLoading).not.toHaveBeenCalled()

    request.success({
      result: {
        ok: true,
        config: { brandName: "刷新后的配置" }
      }
    })
    expect(page.data.form.brandName).toBe("刷新后的配置")
  })

  test("未保存修改或保存期间底层配置读取入口直接收尾", () => {
    const dirtyDone = jest.fn()
    const savingDone = jest.fn()
    const page = createPage(loadPageDefinition(), {
      loading: false,
      hasLoadedConfig: true,
      isDirty: true
    })

    page.fetchConfig(dirtyDone)
    page.data.isDirty = false
    page.data.saving = true
    page.fetchConfig(savingDone)

    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(dirtyDone).toHaveBeenCalledTimes(1)
    expect(savingDone).toHaveBeenCalledTimes(1)
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

  test("服务网点增删编辑、坐标和类型可提交并回填，保存后清除前台缓存", () => {
    const requests = []
    wx.cloud.callFunction.mockImplementation((request) => requests.push(request))
    const page = createPage(loadPageDefinition())
    page.fetchConfig()
    expect(requests[0].data).toEqual({ requireStoredConfig: true })
    requests[0].success({ result: { ok: true, config: { servicePhone: "", serviceHoursText: "每日营业", serviceHubs: [] } } })
    expect(page.data.form.servicePhone).toBe("")
    page.handleAddServiceHub()
    page.handleAddServiceHub()
    const [hub, removed] = page.data.form.serviceHubs
    expect(hub.id).not.toBe(removed.id)
    const values = { city: "杭州", name: "西湖店", address: "已核实地址", feeText: "到店免费取还", latitude: "0", longitude: "0" }
    Object.entries(values).forEach(([field, value]) => page.handleServiceHubInput({ currentTarget: { dataset: { id: hub.id, field } }, detail: { value } }))
    page.handleServiceHubTypeChange({ currentTarget: { dataset: { id: hub.id } }, detail: { value: "1" } })
    page.handleRemoveServiceHub({ currentTarget: { dataset: { id: removed.id } } })
    expect(page.data.form.serviceHubs).toEqual([{ ...hub, ...values, type: "hub" }])
    expect(page.data.isDirty).toBe(true)
    page.handleSubmit()
    const request = requests[1]
    expect(request.data.config.serviceHubs).toEqual([{ ...hub, ...values, type: "hub" }])
    page.data.form.serviceHubs[0].address = "未提交地址"
    expect(request.data.config.serviceHubs[0].address).toBe("已核实地址")
    request.success({ result: { ok: true, config: { ...request.data.config, serviceHubs: [{ ...request.data.config.serviceHubs[0], latitude: 0, longitude: 0 }] } } })
    expect(page.data.form.serviceHubs[0]).toMatchObject({ latitude: "0", longitude: "0", address: "已核实地址" })
    expect(page.data.isDirty).toBe(false)
    expect(require("../shared/operationConfigRequest").clearOperationConfigCache).toHaveBeenCalledTimes(2)
    page.onUnload()
  })

  test("清空所有服务字段和删除最后一个网点后提交空值并保持回填为空", () => {
    const hub = { id: "store", city: "杭州", name: "门店", address: "真实地址", feeText: "", type: "store", latitude: null, longitude: null }
    wx.cloud.callFunction.mockImplementation(({ name, data, success }) => success({ result: {
      ok: true, config: name === "operationConfigGet" ? { servicePhone: "18800000000", wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/old-link", serviceHoursText: "每日营业", emergencyPhone: "18800000001", serviceHubs: [hub] } : data.config
    } }))
    const page = createPage(loadPageDefinition())
    page.fetchConfig()
    expect(page.data.form.serviceHubs[0].latitude).toBe("")
    const clearFields = ["servicePhone", "serviceHoursText", "emergencyPhone", "wxKfCorpId", "wxKfExtInfo"]
    clearFields.forEach((field) => page.handleInput({ currentTarget: { dataset: { field } }, detail: { value: "" } }))
    page.handleRemoveServiceHub({ currentTarget: { dataset: { id: hub.id } } })
    page.handleInput({ currentTarget: { dataset: { field: "cityOptionsText" } }, detail: { value: "" } })
    page.handleSubmit()
    const submitted = wx.cloud.callFunction.mock.calls[1][0].data.config
    clearFields.forEach((field) => {
      expect(submitted[field]).toBe("")
      expect(page.data.form[field]).toBe("")
    })
    expect(submitted.serviceHubs).toEqual([])
    expect(page.data.form.serviceHubs).toEqual([])
    expect(submitted.cityOptions).toEqual([])
    expect(page.data.form.cityOptionsText).toBe("")
  })

  test("未完整填写网点或客服参数时阻止保存", () => {
    const page = createPage(loadPageDefinition(), { loading: false, hasLoadedConfig: true })
    page.handleAddServiceHub()
    page.handleSubmit()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    page.handleRemoveServiceHub({ currentTarget: { dataset: { id: page.data.form.serviceHubs[0].id } } })
    page.data.form.wxKfCorpId = "ww123456"
    page.handleSubmit()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(page.data.saving).toBe(false)
  })

  test("管理员读取失败时不能添加网点或保存默认表单", () => {
    wx.cloud.callFunction.mockImplementation(({ success }) => success({ result: { ok: false, code: "CONFIG_UNAVAILABLE", message: "线上配置读取失败，请重试" } }))
    const page = createPage(loadPageDefinition())
    page.fetchConfig()
    page.handleAddServiceHub()
    page.handleSubmit()
    expect(page.data.loadFailed).toBe(true)
    expect(page.data.form.serviceHubs).toEqual([])
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
  })
})
