const fs = require("fs")
const path = require("path")

const { buildVehicleFormProgress } = require("../shared/vehicleFormProgress")

const VALID_FORM = {
  plateNumber: "浙A12345",
  vehicleType: "sedan",
  brandModel: "BMW 740Li",
  registerDate: "2026-01-01",
  status: "active",
  location: "杭州",
  transmission: "automatic",
  fuelType: "gasoline",
  seats: "5",
  priceDay: "1000",
  vin: "",
  engineNumber: "",
  publicDescription: "",
  note: ""
}

function loadPageDefinition(relativePath) {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require(relativePath)
  return definition
}

function createPage(definition, overrides = {}) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...overrides,
      form: {
        ...definition.data.form,
        ...(overrides.form || {})
      }
    }
  }
  page.setData = jest.fn((patch) => {
    Object.keys(patch).forEach((key) => {
      if (key.startsWith("form.")) {
        const fields = key.split(".").slice(1)
        const lastField = fields.pop()
        const target = fields.reduce((value, field) => value[field], page.data.form)
        target[lastField] = patch[key]
        return
      }
      page.data[key] = patch[key]
    })
  })
  return page
}

describe("车辆新增与编辑表单体验", () => {
  test("保存后全部返回路径失败仍能使用回执中的新版本继续编辑", () => {
    jest.useFakeTimers()
    const requests = []
    global.wx = {
      cloud: { callFunction: jest.fn((request) => requests.push(request)) }, showToast: jest.fn(),
      navigateBack: jest.fn(({ fail }) => fail()), redirectTo: jest.fn(({ fail }) => fail()), reLaunch: jest.fn(({ fail }) => fail())
    }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"), { id: "car_1", loading: false, form: VALID_FORM })
    global.getCurrentPages = () => [page]
    page._vehicleVersion = 7
    page.handleSubmit()
    requests[0].success({ result: { ok: true, id: "car_1", vehicleVersion: 8 } })
    jest.advanceTimersByTime(900)
    expect(page.data.isSubmitting).toBe(false)
    page.handleTextInput({ currentTarget: { dataset: { field: "publicDrivingTips" } }, detail: { value: "新的用车提示" } })
    page.handleSubmit()
    expect(requests[1].data).toMatchObject({ expectedVersion: 8, publicDrivingTips: "新的用车提示" })
    requests[1].success({ result: { ok: true, id: "car_1", vehicleVersion: 9 } })
    expect(page._vehicleVersion).toBe(9)
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })
  test("编辑回填和再次提交保留旧数据中的性能数值零与零租金", () => {
    const detail = { ...VALID_FORM, priceDay: 0, performance: { acceleration: 0, horsepower: 0, torque: 0 } }
    global.wx = { cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, detail } })) }, showToast: jest.fn() }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"))
    page.fetchDetail("car_1")
    expect(page.data.form.priceDay).toBe("0")
    expect(page.buildSubmitPayload().performance).toMatchObject({ acceleration: "0", horsepower: "0", torque: "0" })
    page.onUnload()
  })

  test.each([null, { minDays: 5, discountRate: 0.955 }])("旧折扣异常项 %p 不阻塞回填也不被自动改成有效折扣", (tier) => {
    const detail = { ...VALID_FORM, rentalDiscountTiers: [tier] }
    global.wx = { cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, detail } })) }, showToast: jest.fn() }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"), { id: "car_1" })
    page.fetchDetail("car_1")
    expect(page.data.loading).toBe(false)
    expect(page.data.discountRows).toHaveLength(1)
    page.handleSubmit()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(page.data.isSubmitting).toBe(false)
    expect(require("../shared/vehicle").validateVehicle(page.buildSubmitPayload()).ok).toBe(false)
    page.handleRemoveDiscountTier({ currentTarget: { dataset: { index: 0 } } })
    expect(require("../shared/vehicle").validateVehicle(page.buildSubmitPayload()).ok).toBe(true)
    page.onUnload()
  })

  test.each(["", "legacy-unknown"])("旧车未知类型和状态 %p 保留原值并阻止无意覆盖", (value) => {
    const detail = { ...VALID_FORM, vehicleType: value, status: value }
    global.wx = { cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, detail } })) }, showToast: jest.fn() }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"), { id: "car_1" })
    page.fetchDetail("car_1")
    expect(page.buildSubmitPayload()).toMatchObject({ vehicleType: value, status: value })
    page.handleTextInput({ currentTarget: { dataset: { field: "note" } }, detail: { value: "只改备注" } })
    page.handleSubmit()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    page.handleVehicleTypeChange({ detail: { value: 0 } })
    page.handleStatusChange({ detail: { value: 0 } })
    expect(require("../shared/vehicle").validateVehicle(page.buildSubmitPayload()).ok).toBe(true)
    page.onUnload()
  })

  test("编辑提交带读取版本，冲突保留表单并由用户选择重新加载", () => {
    jest.useFakeTimers()
    const calls = []
    global.wx = { cloud: { callFunction: jest.fn((options) => calls.push(options)) }, showToast: jest.fn(), showModal: jest.fn() }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"), { id: "car_1" })
    page.fetchDetail("car_1")
    calls[0].success({ result: { ok: true, detail: { ...VALID_FORM, vehicleVersion: 7 } } })
    page.data.form.note = "尚未保存的内容"
    page.handleSubmit()
    expect(calls[1].data.expectedVersion).toBe(7)
    calls[1].success({ result: { ok: false, code: "VERSION_CONFLICT" } })
    expect(page.data.isSubmitting).toBe(false)
    expect(page.data.form.note).toBe("尚未保存的内容")
    const confirmation = wx.showModal.mock.calls[0][0]
    confirmation.success({ confirm: false })
    expect(calls).toHaveLength(2)
    page.onUnload()
    confirmation.success({ confirm: true })
    expect(calls).toHaveLength(2)
  })
  test.each(["vehicle-create", "vehicle-edit"])("%s 新字段输入后立即提交，并可清空性能与到期日", (name) => {
    global.wx = { showToast: jest.fn() }
    const page = createPage(loadPageDefinition(`../pages-admin/${name}/${name}`), { loading: false, form: { ...VALID_FORM, performance: { acceleration: "6.5s", horsepower: "300Ps", drivetrain: "后轮驱动", torque: "400N·m", highlights: ["天窗"] } } })
    const event = (field, value) => ({ currentTarget: { dataset: { field } }, detail: { value } })
    page.handleTextInput(event("publicDrivingTips", "启程前确认座椅位置"))
    page.handleDueDateChange(event("archiveDate", "2027-01-01"))
    page.handleDueDateChange(event("archiveReview", "2027-06-01"))
    expect(page.buildSubmitPayload()).toMatchObject({ publicDrivingTips: "启程前确认座椅位置", archiveDate: "2027-01-01", archiveReview: "2027-06-01" })
    for (const field of ["acceleration", "horsepower", "torque"]) page.handlePerformanceTextInput(event(`performance.${field}`, ""))
    page.handleClearOptionalField(event("performance.drivetrain"))
    page.handleRemoveHighlight({ currentTarget: { dataset: { index: 0 } } })
    page.handleClearOptionalField(event("archiveDate"))
    page.handleClearOptionalField(event("archiveReview"))
    page.handleTextInput(event("publicDrivingTips", ""))
    expect(page.buildSubmitPayload()).toMatchObject({ publicDrivingTips: "", archiveDate: "", archiveReview: "", performance: { acceleration: "", horsepower: "", drivetrain: "", torque: "", highlights: [] } })
    page.data.isSubmitting = true
    page.handleDueDateChange(event("archiveDate", "2028-01-01"))
    expect(page.data.form.archiveDate).toBe("")
  })

  test("编辑回填保存的人工提示、到期日与性能，重新读取空配置不补示例值", () => {
    jest.useFakeTimers()
    let detail = { ...VALID_FORM, publicDrivingTips: "停车后关闭灯光", archiveDate: "2027-01-01", archiveReview: "2027-06-01", performance: { horsepower: "300Ps", highlights: ["天窗"] } }
    global.wx = { cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, detail } })) }, showToast: jest.fn() }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"))
    page.fetchDetail("car_1")
    expect(page.buildSubmitPayload()).toMatchObject(detail)
    detail = { ...VALID_FORM }
    page.fetchDetail("car_1")
    expect(page.buildSubmitPayload()).toMatchObject({ publicDrivingTips: "", archiveDate: "", archiveReview: "", performance: { acceleration: "", horsepower: "", drivetrain: "", torque: "", highlights: [] } })
    page.onUnload()
  })

  test("重新进入编辑页回填已保存折扣，不给旧车补默认档位", () => {
    jest.useFakeTimers()
    let detail = { ...VALID_FORM, rentalDiscountTiers: [{ minDays: 5, discountRate: 0.92 }] }
    global.wx = {
      cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: true, detail } })) },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"))
    page.fetchDetail("car_1")
    expect(page.data.discountRows).toEqual([{ minDays: "5", discount: "9.2" }])
    expect(page.buildSubmitPayload().rentalDiscountTiers).toEqual([{ minDays: 5, discountRate: 0.92 }])
    detail = { ...VALID_FORM }
    page.fetchDetail("car_1")
    expect(page.data.discountRows).toEqual([])
    page.onUnload()
  })

  test.each(["vehicle-create", "vehicle-edit"])("%s 连租规则输入立即进入提交载荷，删除全部即关闭", (name) => {
    global.wx = { showToast: jest.fn() }
    const page = createPage(loadPageDefinition(`../pages-admin/${name}/${name}`), { loading: false, form: VALID_FORM, discountRows: [] })
    page.handleAddDiscountTier()
    page.handleDiscountTierInput({ currentTarget: { dataset: { index: 0, field: "minDays" } }, detail: { value: "5" } })
    page.handleDiscountTierInput({ currentTarget: { dataset: { index: 0, field: "discount" } }, detail: { value: "9.2" } })
    expect(page.buildSubmitPayload().rentalDiscountTiers).toEqual([{ minDays: 5, discountRate: 0.92 }])
    page.handleRemoveDiscountTier({ currentTarget: { dataset: { index: 0 } } })
    expect(page.buildSubmitPayload().rentalDiscountTiers).toEqual([])
    for (let i = 0; i < 9; i++) page.handleAddDiscountTier()
    expect(page.data.discountRows).toHaveLength(8)
    page.data.isSubmitting = true
    page.handleRemoveDiscountTier({ currentTarget: { dataset: { index: 0 } } })
    expect(page.data.discountRows).toHaveLength(8)
  })

  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
    delete global.getApp
  })

  test("必填完成度按统一的五项车辆身份字段计算", () => {
    expect(buildVehicleFormProgress({})).toEqual({
      completed: 0,
      total: 5,
      percent: 0,
      ready: false,
      plateNumberComplete: false,
      vehicleTypeComplete: false,
      brandModelComplete: false,
      registerDateComplete: false,
      statusComplete: false,
      nextField: "plateNumber",
      hint: "下一项：填写车牌号"
    })

    expect(buildVehicleFormProgress({
      plateNumber: "浙A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li"
    })).toMatchObject({
      completed: 3,
      percent: 60,
      ready: false,
      nextField: "registerDate",
      hint: "下一项：填写注册日期"
    })
  })

  test("五项必填资料完整后显示可提交状态", () => {
    expect(buildVehicleFormProgress({
      plateNumber: "浙A12345",
      vehicleType: "sedan",
      brandModel: "BMW 740Li",
      registerDate: "2026-01-01",
      status: "active"
    })).toEqual({
      completed: 5,
      total: 5,
      percent: 100,
      ready: true,
      plateNumberComplete: true,
      vehicleTypeComplete: true,
      brandModelComplete: true,
      registerDateComplete: true,
      statusComplete: true,
      nextField: "",
      hint: "必填信息已完整，可以提交"
    })
  })

  test("新增和编辑页共享进度、分组图标及吸底提交栏", () => {
    const createSource = fs.readFileSync(
      path.resolve(__dirname, "../pages-admin/vehicle-create/vehicle-create.wxml"),
      "utf8"
    )
    const editSource = fs.readFileSync(
      path.resolve(__dirname, "../pages-admin/vehicle-edit/vehicle-edit.wxml"),
      "utf8"
    )
    const detailSource = fs.readFileSync(
      path.resolve(__dirname, "../pages-admin/vehicle-detail-manage/vehicle-detail-manage.wxml"),
      "utf8"
    )
    const styleSource = fs.readFileSync(
      path.resolve(__dirname, "../shared/vehicle-form.wxss"),
      "utf8"
    )

    ;[createSource, editSource].forEach((source) => {
      expect(source).toContain("vehicle-form-progress")
      expect(source).toContain("vehicle-section-glyph-identity")
      expect(source).toContain("vehicle-section-glyph-rental")
      expect(source).toContain("vehicle-section-glyph-archive")
      expect(source).toContain("vehicle-submit-dock")
      expect(source).not.toContain(">✓<")
      expect(source).toContain('hover-class="vehicle-picker-pressed"')
      expect(source).toContain("vehicle-form-control-complete")
      expect((source.match(/aria-required="\{\{true\}\}"/g) || []).length).toBeGreaterThanOrEqual(5)
    })
    expect(styleSource).toMatch(/\.vehicle-form-page \.vehicle-submit-dock\s*\{[\s\S]*?position:\s*sticky/)
    expect(styleSource).toContain(".vehicle-form-progress-ready")
    expect(styleSource).toContain(".vehicle-form-control-complete")
    expect(createSource).toContain("vehicle-create-native-icon")
    expect(editSource).toContain("vehicle-retry-native-icon")
    expect(editSource).toContain("vehicle-back-native-icon")
    expect(editSource).toContain("vehicle-image-native-icon")
    expect(editSource).toContain("vehicle-save-native-icon")
    expect(detailSource).toContain("vehicle-detail-empty-button ui-btn ui-btn-primary")
    expect(detailSource).toContain("<view class=\"back-native-icon\"")
    expect(styleSource).toContain(".vehicle-form-action-content")
    expect(styleSource).toContain(".vehicle-retry-native-icon")
    expect(editSource).toContain('hover-class="vehicle-form-state-button-pressed"')
    expect(styleSource).toContain(".vehicle-form-state-button-pressed")
    expect(styleSource).toMatch(/\.vehicle-form-page \.form-input:focus,[\s\S]*?box-shadow:/)
    expect(styleSource).toContain(".vehicle-form-page .vehicle-picker-pressed")
  })

  test("新增请求超时后解锁按钮并忽略迟到成功回调", () => {
    jest.useFakeTimers()
    let requestOptions = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      },
      showToast: jest.fn(),
      showModal: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/vehicle-create/vehicle-create"),
      { form: VALID_FORM }
    )

    page.handleSubmit()
    page.handleSubmit()

    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(page.data.isSubmitting).toBe(true)
    jest.advanceTimersByTime(20 * 1000)
    expect(page.data.isSubmitting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "新增超时，请重试",
      icon: "none"
    })

    requestOptions.success({ result: { ok: true, id: "vehicle-late" } })
    expect(wx.showModal).not.toHaveBeenCalled()
  })

  test("新增云函数同步抛错时恢复可提交状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud unavailable")
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/vehicle-create/vehicle-create"),
      { form: VALID_FORM }
    )

    expect(() => page.handleSubmit()).not.toThrow()
    expect(page.data.isSubmitting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "新增失败",
      icon: "none"
    })
  })

  test("新增请求完成前离页会忽略后续成功结果", () => {
    let requestOptions = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      },
      showToast: jest.fn(),
      showModal: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/vehicle-create/vehicle-create"),
      { form: VALID_FORM }
    )

    page.handleSubmit()
    page.onUnload()
    requestOptions.success({ result: { ok: true, id: "vehicle-after-unload" } })

    expect(wx.showModal).not.toHaveBeenCalled()
  })

  test("新增成功选择弹窗响应前保持提交锁并阻止重复创建", () => {
    let requestOptions = null
    let modalOptions = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      },
      showToast: jest.fn(),
      showModal: jest.fn((options) => {
        modalOptions = options
      })
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/vehicle-create/vehicle-create"),
      { form: VALID_FORM }
    )

    page.handleSubmit()
    requestOptions.success({ result: { ok: true, id: "vehicle-created" } })

    expect(page.data.isSubmitting).toBe(true)
    expect(modalOptions).toBeTruthy()
    page.handleSubmit()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)

    page.onUnload()
  })

  test("新增成功后的返回链全部失败时恢复页面交互", () => {
    let modalOptions = null
    let page = null
    global.getCurrentPages = jest.fn(() => [page])
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          options.success({ result: { ok: true, id: "vehicle-created" } })
        })
      },
      showToast: jest.fn(),
      showModal: jest.fn((options) => {
        modalOptions = options
      }),
      redirectTo: jest.fn((options) => options.fail()),
      reLaunch: jest.fn((options) => options.fail())
    }
    page = createPage(
      loadPageDefinition("../pages-admin/vehicle-create/vehicle-create"),
      { form: VALID_FORM }
    )

    page.handleSubmit()
    modalOptions.success({ cancel: true })

    expect(page.data.isSubmitting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "返回我的页面失败",
      icon: "none"
    })
  })

  test("编辑详情超时后保持失败状态并忽略迟到数据", () => {
    jest.useFakeTimers()
    let requestOptions = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit")
    )

    page.fetchDetail("vehicle-timeout")
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.loadFailed).toBe(true)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "档案加载超时，请重试",
      icon: "none"
    })

    requestOptions.success({
      result: {
        ok: true,
        detail: { ...VALID_FORM, brandModel: "迟到车辆" }
      }
    })
    expect(page.data.form.brandModel).toBe("")
    expect(page.data.loadFailed).toBe(true)
  })

  test("编辑详情连续读取时仅采用最新车辆结果", () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      },
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit")
    )

    page.fetchDetail("vehicle-old")
    page.fetchDetail("vehicle-new")
    requests[1].success({
      result: {
        ok: true,
        detail: { ...VALID_FORM, brandModel: "新车辆" }
      }
    })
    requests[0].success({
      result: {
        ok: true,
        detail: { ...VALID_FORM, brandModel: "旧车辆" }
      }
    })

    expect(page.data.form.brandModel).toBe("新车辆")
    expect(page.data.loading).toBe(false)
    expect(page.data.loadFailed).toBe(false)
  })

  test("编辑页加载并维护公开可信摘要与内部档案字段", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => options.success({
          result: {
            ok: true,
            detail: {
              ...VALID_FORM,
              publicMaterialsUpdatedDate: "2026-07-08",
              publicInspectionDate: "2026-07-01",
              publicInspectionSummary: "公开检查摘要",
              publicExteriorSummary: "公开外观摘要",
              publicInsuranceSummary: "公开保险摘要",
              publicAssistanceSummary: "公开救援摘要",
              publicArchiveReviewStatus: "reviewed",
              internalMaintenanceRecord: "内部保养工单",
              internalInspectionRecord: "内部检查记录",
              internalInsuranceRecord: "内部保险索引",
              internalArchiveNote: "内部说明"
            }
          }
        }))
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"))

    page.fetchDetail("vehicle-trust")

    expect(page.data.form).toMatchObject({
      publicInspectionSummary: "公开检查摘要",
      publicArchiveReviewStatus: "reviewed",
      internalMaintenanceRecord: "内部保养工单",
      internalInsuranceRecord: "内部保险索引"
    })
    expect(page.data.archiveReviewLabel).toBe("已复核")

    page.handleArchiveReviewChange({ detail: { value: 0 } })
    page.handleArchiveDateChange({
      detail: { value: "2026-07-09" },
      currentTarget: { dataset: { field: "publicInspectionDate" } }
    })
    expect(page.data.form.publicArchiveReviewStatus).toBe("pending")
    expect(page.data.form.publicInspectionDate).toBe("2026-07-09")
  })

  test("编辑保存超时后解锁按钮并忽略迟到成功回调", () => {
    jest.useFakeTimers()
    let requestOptions = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      },
      showToast: jest.fn(),
      navigateBack: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"),
      { id: "vehicle-1", loading: false, form: VALID_FORM }
    )

    page.handleSubmit()
    page.handleSubmit()
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(20 * 1000)
    expect(page.data.isSubmitting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "保存超时，请重试",
      icon: "none"
    })

    requestOptions.success({ result: { ok: true } })
    jest.advanceTimersByTime(900)
    expect(wx.navigateBack).not.toHaveBeenCalled()
  })

  test("编辑保存云函数同步抛错时恢复可提交状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("update unavailable")
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"),
      { id: "vehicle-1", loading: false, form: VALID_FORM }
    )

    expect(() => page.handleSubmit()).not.toThrow()
    expect(page.data.isSubmitting).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "保存失败",
      icon: "none"
    })
  })

  test("编辑保存成功后若提前离页则取消延迟返回", () => {
    jest.useFakeTimers()
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          options.success({ result: { ok: true } })
        })
      },
      showToast: jest.fn(),
      navigateBack: jest.fn(),
      redirectTo: jest.fn(),
      reLaunch: jest.fn()
    }
    const page = createPage(
      loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"),
      { id: "vehicle-1", loading: false, form: VALID_FORM }
    )

    page.handleSubmit()
    page.onUnload()
    jest.advanceTimersByTime(900)

    expect(wx.navigateBack).not.toHaveBeenCalled()
    expect(wx.redirectTo).not.toHaveBeenCalled()
    expect(wx.reLaunch).not.toHaveBeenCalled()
  })

  test("编辑保存成功后应用处于后台时延迟返回到重新前台", () => {
    jest.useFakeTimers()
    const app = { globalData: { nativeActionAppVisible: false } }
    let page = null
    global.getApp = jest.fn(() => app)
    global.getCurrentPages = jest.fn(() => [page])
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          options.success({ result: { ok: true } })
        })
      },
      showToast: jest.fn(),
      navigateBack: jest.fn(),
      redirectTo: jest.fn(),
      reLaunch: jest.fn()
    }
    page = createPage(
      loadPageDefinition("../pages-admin/vehicle-edit/vehicle-edit"),
      { id: "vehicle-1", loading: false, form: VALID_FORM }
    )

    page.handleSubmit()
    jest.advanceTimersByTime(900)

    expect(wx.navigateBack).not.toHaveBeenCalled()
    expect(page.data.isSubmitting).toBe(true)

    app.globalData.nativeActionAppVisible = true
    page.onShow()

    expect(wx.navigateBack).toHaveBeenCalledWith(expect.objectContaining({ delta: 1 }))
  })
})
