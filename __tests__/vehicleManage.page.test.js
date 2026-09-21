const fs = require("fs")
const path = require("path")

jest.mock("../shared/pageAuth", () => ({
  cancelPagePermissionCheck: jest.fn(),
  requirePagePermission: jest.fn()
}))

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages-admin/vehicle-manage/vehicle-manage")
  return definition
}

function createPage(definition, overrides) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      summaryItems: definition.data.summaryItems.map((item) => ({ ...item })),
      statusRatioSegments: definition.data.statusRatioSegments.map((item) => ({ ...item })),
      ...(overrides || {})
    }
  }
  page.setData = jest.fn((patch, done) => {
    Object.assign(page.data, patch)
    if (typeof done === "function") {
      done()
    }
  })
  return page
}

describe("pages/vehicle-manage 车辆管理列表体验", () => {
  beforeEach(() => {
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn(),
      showModal: jest.fn(),
      showLoading: jest.fn(),
      hideLoading: jest.fn()
    }
  })

  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("车辆列表无回调时超时收尾并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    const done = jest.fn()
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      lateSuccess = success
    })
    const existingList = [{ id: "existing" }]
    const page = createPage(loadPageDefinition(), {
      list: existingList,
      page: 2,
      hasMore: true
    })

    page.fetchList({ append: true, done })
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.list).toBe(existingList)
    expect(page.data.page).toBe(2)
    expect(page.data.hasMore).toBe(true)
    expect(done).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "查询超时，请重试",
      icon: "none"
    })

    lateSuccess({
      result: {
        ok: true,
        page: 3,
        hasMore: false,
        list: [{ id: "late" }]
      }
    })
    expect(page.data.list).toBe(existingList)
    expect(page.data.page).toBe(2)
  })

  test("新车辆列表请求覆盖旧请求且旧结果不会回写", () => {
    const requests = []
    wx.cloud.callFunction.mockImplementation((options) => requests.push(options))
    const page = createPage(loadPageDefinition())

    page.fetchList()
    page.data.keyword = "fresh"
    page.fetchList()
    expect(requests[0].data.keyword).toBe("")
    expect(requests[1].data.keyword).toBe("fresh")

    requests[1].success({
      result: {
        ok: true,
        page: 0,
        hasMore: false,
        list: [{ id: "fresh" }]
      }
    })
    requests[0].success({
      result: {
        ok: true,
        page: 0,
        hasMore: false,
        list: [{ id: "stale" }]
      }
    })

    expect(page.data.list).toHaveLength(1)
    expect(page.data.list[0].id).toBe("fresh")
  })

  test("车辆写操作超时后恢复状态并阻止重复操作与迟到成功", () => {
    jest.useFakeTimers()
    let lateSuccess
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      lateSuccess = success
    })
    const page = createPage(loadPageDefinition())
    page.fetchList = jest.fn()

    page.updateVehicleStatus("car_1", "active")
    page.retireVehicle("car_2")
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(page.data.updatingId).toBe("car_1")

    jest.advanceTimersByTime(20 * 1000)
    expect(page.data.updatingId).toBe("")
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "更新超时，请重试",
      icon: "none"
    })

    lateSuccess({ result: { ok: true, message: "状态已更新" } })
    expect(page.fetchList).not.toHaveBeenCalled()
  })

  test("车辆写操作遇到云 SDK 同步异常时安全结束", () => {
    wx.cloud.callFunction.mockImplementation(() => {
      throw new Error("cloud down")
    })
    const page = createPage(loadPageDefinition())

    expect(() => page.restoreVehicle("car_1")).not.toThrow()
    expect(page.data.updatingId).toBe("")
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "cloud down",
      icon: "none"
    })
  })

  test("封面与图片数量组合生成素材完整度", () => {
    wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({
        result: {
          ok: true,
          total: 3,
          dashboard: {},
          recentAddedList: [],
          page: 0,
          hasMore: false,
          list: [
            { id: "missing", imageCount: 4, coverImage: "" },
            { id: "basic", imageCount: 1, coverImage: "cloud://cover-1" },
            { id: "ready", imageCount: 4, coverImage: "cloud://cover-2" }
          ]
        }
      })
    })

    const page = createPage(loadPageDefinition())
    page.fetchList()

    expect(page.data.list[0]).toMatchObject({
      mediaStatusText: "待补封面",
      mediaStatusClass: "media-health-missing",
      mediaProgress: 0
    })
    expect(page.data.list[1]).toMatchObject({
      mediaStatusText: "基础素材",
      mediaStatusClass: "media-health-basic",
      mediaProgress: 33
    })
    expect(page.data.list[2]).toMatchObject({
      mediaStatusText: "素材充足",
      mediaStatusClass: "media-health-ready",
      mediaProgress: 100
    })
  })

  test("卡片将核心资料、档案记录与维护操作分层展示", () => {
    const pageDir = path.resolve(__dirname, "../pages-admin/vehicle-manage")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "vehicle-manage.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "vehicle-manage.wxss"), "utf8")

    expect(wxmlSource).toContain("media-health")
    expect(wxmlSource).toContain("vehicle-record-meta")
    expect(wxmlSource).toContain("card-primary-actions")
    expect(wxmlSource).toContain("card-maintenance-actions")
    expect(wxmlSource).toContain("status-op-check")
    expect(wxssSource).toContain(".media-health-ready")
    expect(wxssSource).toContain(".vehicle-record-meta")
    expect(wxmlSource).toContain('aria-pressed="{{item.status === op.value}}"')
    expect(wxmlSource).toContain('hover-class="status-op-btn-pressed"')
    expect(wxssSource).toContain(".status-op-btn-pressed")
  })

  test("图片占位使用品牌徽标，详情编辑和危险操作使用对应原生图标", () => {
    const wxmlSource = fs.readFileSync(
      path.resolve(__dirname, "../pages-admin/vehicle-manage/vehicle-manage.wxml"),
      "utf8"
    )
    const wxssSource = fs.readFileSync(
      path.resolve(__dirname, "../pages-admin/vehicle-manage/vehicle-manage.wxss"),
      "utf8"
    )

    expect(wxmlSource).toContain("vehicle-cover-placeholder-emblem")
    expect(wxmlSource).toContain("vehicle-cover-placeholder-ring")
    expect(wxmlSource).toContain('aria-hidden="true" />')
    expect(wxmlSource).toContain("detail-native-icon")
    expect(wxmlSource).toContain("edit-native-icon")
    expect(wxmlSource).toContain("retire-native-icon")
    expect(wxmlSource).toContain("restore-native-icon")
    expect(wxmlSource).toContain("delete-native-icon")
    expect(wxmlSource).toContain("reset-native-icon")
    expect(wxmlSource).toContain("vehicle-recent-empty-native-icon")
    expect(wxmlSource).toContain("新增车辆完成后会显示在这里")
    expect(wxmlSource).toContain('class="recent-entry-chevron"')
    expect(wxmlSource).toContain('hover-class="recent-item-pressed"')
    expect(wxmlSource).toContain('hover-class="vehicle-cover-pressed"')
    expect(wxmlSource).toContain('aria-label="查看车辆 {{item.plateNumber || \'未填写车牌\'}}，{{item.brandModel}} 详情"')
    expect(wxmlSource).toMatch(/<image wx:if="\{\{item\.coverImage\}\}"[^>]+aria-hidden="true" \/>/)
    expect(wxmlSource).not.toContain(">✓<")
    expect(wxssSource).toContain(".recent-empty-native-icon")
    expect(wxssSource).toContain(".recent-item-pressed")
    expect(wxssSource).toContain(".vehicle-cover-pressed")
    expect(wxmlSource).toContain('binderror="handleCoverImageError"')
    expect(wxmlSource).toContain("封面无法显示")
    expect(wxssSource).toContain(".vehicle-cover-placeholder-error")
    expect(wxssSource).toContain(".vehicle-cover-placeholder-emblem")
  })

  test("封面加载失败时切换为明确的异常占位", () => {
    const page = createPage(loadPageDefinition())
    page.data.list = [{
      id: "vehicle-broken-cover",
      coverImage: "cloud://missing-cover",
      mediaStatusText: "基础素材",
      mediaStatusClass: "media-health-basic",
      mediaProgress: 33
    }]

    page.handleCoverImageError({
      currentTarget: { dataset: { index: 0 } }
    })

    expect(page.data.list[0]).toMatchObject({
      coverImage: "",
      coverLoadFailed: true,
      mediaStatusText: "封面不可用",
      mediaStatusClass: "media-health-missing",
      mediaProgress: 0
    })
  })

  test("筛选、分页与读取上限使用对应原生图标", () => {
    const pageDir = path.resolve(__dirname, "../pages-admin/vehicle-manage")
    const wxmlSource = fs.readFileSync(path.join(pageDir, "vehicle-manage.wxml"), "utf8")
    const wxssSource = fs.readFileSync(path.join(pageDir, "vehicle-manage.wxss"), "utf8")

    expect(wxmlSource).toContain("search-action-native-icon")
    expect(wxmlSource).toContain("reset-native-icon")
    expect(wxmlSource).toContain("limit-warning-native-icon")
    expect(wxmlSource).toContain("load-more-native-icon")
    expect(wxmlSource).toContain("load-complete-native-icon")
    expect(wxmlSource).toContain('aria-pressed="{{currentStatus === item.value}}"')
    expect(wxmlSource).toContain('scroll-into-view="vehicle-status-{{currentStatus}}"')
    expect(wxmlSource).toContain('id="vehicle-status-{{item.value}}"')
    expect(wxmlSource).toContain('class="ui-scroll-cue"')
    expect(wxmlSource).not.toContain('bindtap="handleKeywordConfirm">查询</button>')
    expect(wxmlSource).not.toContain('bindtap="handleReset">重置筛选</button>')
    expect(wxssSource).toContain(".result-limit-tip")
    expect(wxssSource).toContain(".load-complete-native-icon")
  })

  test("存在预约历史时完整说明原因并允许一键停用", () => {
    wx.cloud.callFunction.mockImplementation(({ name, success }) => {
      if (name === "vehicleDelete") {
        success({
          result: {
            ok: false,
            code: "VEHICLE_HAS_BOOKINGS",
            message: "车辆存在预约记录，请改为停用车辆"
          }
        })
      }
    })
    wx.showModal.mockImplementation(({ success }) => success({ confirm: true }))

    const page = createPage(loadPageDefinition())
    page.retireVehicle = jest.fn()
    page.deleteVehicle("car_1")

    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: "无法彻底删除",
      content: "车辆存在预约记录，请改为停用车辆",
      confirmText: "改为停用"
    }))
    expect(page.retireVehicle).toHaveBeenCalledWith("car_1")
    expect(page.data.deletingId).toBe("")
  })

  test("云调用失败时提供重试并阻止重复删除请求", () => {
    wx.cloud.callFunction.mockImplementation(({ fail }) => fail({ errMsg: "network error" }))
    wx.showModal.mockImplementation(({ success }) => success({ confirm: false }))

    const page = createPage(loadPageDefinition())
    page.deleteVehicle("car_1")

    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({
      title: "删除未完成",
      confirmText: "重试"
    }))
    expect(page.data.deletingId).toBe("")

    page.data.deletingId = "car_busy"
    page.deleteVehicle("car_2")
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
  })

  test("触底生命周期触发车辆列表下一页加载", () => {
    const page = createPage(loadPageDefinition(), {
      pageAuthorized: true,
      loading: false,
      hasMore: true
    })
    page.fetchList = jest.fn()

    page.onReachBottom()
    expect(page.fetchList).toHaveBeenCalledWith({ append: true })

    page.data.hasMore = false
    page.fetchList.mockClear()
    page.onReachBottom()
    expect(page.fetchList).not.toHaveBeenCalled()
  })

  test("点击车辆状态筛选或重置立即更新并显式携带参数发起查询", () => {
    let listCall = null
    wx.cloud.callFunction.mockImplementation((options) => {
      listCall = options
    })
    const page = createPage(loadPageDefinition(), {
      loading: false,
      currentStatus: "all",
      keyword: "保时捷"
    })

    page.handleStatusTap({ currentTarget: { dataset: { status: "idle" } } })
    expect(page.data.currentStatus).toBe("idle")
    expect(listCall).not.toBeNull()
    expect(listCall.data.status).toBe("idle")

    listCall = null
    page.data.loading = false
    page.handleReset()
    expect(page.data.currentStatus).toBe("all")
    expect(page.data.keyword).toBe("")
    expect(listCall).not.toBeNull()
    expect(listCall.data.status).toBe("all")
    expect(listCall.data.keyword).toBe("")
  })
})
