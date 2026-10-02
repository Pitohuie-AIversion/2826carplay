const shared = require("../shared")
const dateUtils = require("../shared/dateUtils")
const cloudClient = require("../shared/cloudClient")
const pageController = require("../shared/pageController")

describe("Architecture & Modular Facade", () => {
  test("shared/index.js 统一门面导出分层命名空间", () => {
    expect(shared.core).toBeDefined()
    expect(shared.services).toBeDefined()
    expect(shared.domains).toBeDefined()
    expect(shared.controllers).toBeDefined()

    // 核心层
    expect(typeof shared.core.performance.createPerformanceHelpers).toBe("function")
    expect(typeof shared.core.pageNativeAction.activatePageNativeActions).toBe("function")
    expect(typeof shared.core.dateUtils.calculateRentalDays).toBe("function")

    // 服务层
    expect(typeof shared.services.cloudClient.callCloud).toBe("function")
    expect(typeof shared.services.cloudReadRequest.requestCloudRead).toBe("function")

    // 领域层
    expect(typeof shared.domains.vehicle.normalizeVehicleInput).toBe("function")
    expect(typeof shared.domains.rentalPricing.calculateRentalDiscount).toBe("function")
    expect(typeof shared.domains.bookingStatus.STATUS_CLASS_MAP).toBe("object")

    // 控制器层
    expect(typeof shared.controllers.pageController.createPageController).toBe("function")
    expect(typeof shared.controllers.pageController.definePage).toBe("function")
  })

  test("shared 根导出高频工具便捷访问", () => {
    expect(typeof shared.createPerformanceHelpers).toBe("function")
    expect(typeof shared.activatePageNativeActions).toBe("function")
    expect(typeof shared.callCloud).toBe("function")
    expect(typeof shared.calculateRentalDays).toBe("function")
    expect(typeof shared.formatToastTitle).toBe("function")
    expect(typeof shared.createPageController).toBe("function")
  })
})

describe("Date & Rental Span Utilities (dateUtils)", () => {
  test("isValidDateFormat 准确校验 YYYY-MM-DD 及闰年", () => {
    expect(dateUtils.isValidDateFormat("2026-10-01")).toBe(true)
    expect(dateUtils.isValidDateFormat("2024-02-29")).toBe(true) // 闰年
    expect(dateUtils.isValidDateFormat("2023-02-29")).toBe(false) // 平年无29日
    expect(dateUtils.isValidDateFormat("2026-13-01")).toBe(false)
    expect(dateUtils.isValidDateFormat("2026-04-31")).toBe(false) // 4月只有30天
    expect(dateUtils.isValidDateFormat("invalid")).toBe(false)
    expect(dateUtils.isValidDateFormat(null)).toBe(false)
  })

  test("isDateRangeValid 校验起止区间合法性", () => {
    expect(dateUtils.isDateRangeValid("2026-10-01", "2026-10-05")).toBe(true)
    expect(dateUtils.isDateRangeValid("2026-10-01", "2026-10-01")).toBe(true)
    expect(dateUtils.isDateRangeValid("2026-10-05", "2026-10-01")).toBe(false) // 倒置
    expect(dateUtils.isDateRangeValid("invalid", "2026-10-01")).toBe(false)
  })

  test("calculateRentalDays 精确计算包含首尾日的租赁天数", () => {
    expect(dateUtils.calculateRentalDays("2026-10-01", "2026-10-01")).toBe(1)
    expect(dateUtils.calculateRentalDays("2026-10-01", "2026-10-03")).toBe(3)
    expect(dateUtils.calculateRentalDays("2026-10-01", "2026-10-31")).toBe(31)
    expect(dateUtils.calculateRentalDays("2026-10-05", "2026-10-01")).toBe(0)
    expect(dateUtils.calculateRentalDays("", "2026-10-01")).toBe(0)
    expect(dateUtils.calculateRentalDays(null, undefined)).toBe(0)
  })

  test("formatDateSpan 格式化租期描述", () => {
    expect(dateUtils.formatDateSpan("2026-10-01", "2026-10-03")).toBe("3 天")
    expect(dateUtils.formatDateSpan("2026-10-01", "2026-10-03", { withNights: true })).toBe("3 天 2 晚")
    expect(dateUtils.formatDateSpan("2026-10-01", "2026-10-01", { withNights: true })).toBe("1 天 0 晚")
    expect(dateUtils.formatDateSpan("invalid", "2026-10-01", { fallback: "待定" })).toBe("待定")
  })

  test("addDays 跨月份安全增减日期", () => {
    expect(dateUtils.addDays("2026-10-01", 5)).toBe("2026-10-06")
    expect(dateUtils.addDays("2026-10-31", 1)).toBe("2026-11-01")
    expect(dateUtils.addDays("2026-03-01", -1)).toBe("2026-02-28")
    expect(dateUtils.addDays("invalid", 1)).toBe("")
  })

  test("isDateOverlap 判断日期区间重叠", () => {
    expect(dateUtils.isDateOverlap("2026-10-01", "2026-10-05", "2026-10-03", "2026-10-08")).toBe(true)
    expect(dateUtils.isDateOverlap("2026-10-01", "2026-10-05", "2026-10-05", "2026-10-08")).toBe(true) // 触碰单日
    expect(dateUtils.isDateOverlap("2026-10-01", "2026-10-05", "2026-10-06", "2026-10-10")).toBe(false)
  })

  test("isDateInRange 与 compareDates 正确工作", () => {
    expect(dateUtils.isDateInRange("2026-10-03", "2026-10-01", "2026-10-05")).toBe(true)
    expect(dateUtils.isDateInRange("2026-10-06", "2026-10-01", "2026-10-05")).toBe(false)

    expect(dateUtils.compareDates("2026-10-01", "2026-10-05")).toBe(-1)
    expect(dateUtils.compareDates("2026-10-05", "2026-10-01")).toBe(1)
    expect(dateUtils.compareDates("2026-10-01", "2026-10-01")).toBe(0)
  })
})

describe("Standardized Cloud Client (cloudClient)", () => {
  beforeEach(() => {
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn()
    }
  })

  test("extractErrorMessage 提取异常可读文案", () => {
    expect(cloudClient.extractErrorMessage("出错了")).toBe("出错了")
    expect(cloudClient.extractErrorMessage(new Error("自定义报错"))).toBe("自定义报错")
    expect(cloudClient.extractErrorMessage({ errMsg: "request:fail timeout" })).toBe("网络连接不稳定，请检查后重试")
    expect(cloudClient.extractErrorMessage(null, "保底提示")).toBe("保底提示")
  })

  test("callCloud 正常调用并返回标准化成功数据", async () => {
    global.wx.cloud.callFunction.mockImplementation(({ name, data, success }) => {
      expect(name).toBe("testFunc")
      expect(data).toEqual({ id: 123 })
      success({ result: { ok: true, data: { list: [1, 2] } } })
    })

    const res = await cloudClient.callCloud("testFunc", { id: 123 })
    expect(res.ok).toBe(true)
    expect(res.data).toEqual({ list: [1, 2] })
  })

  test("callCloud 业务失败返回结构化错误码", async () => {
    global.wx.cloud.callFunction.mockImplementation(({ success }) => {
      success({ result: { ok: false, code: "NOT_FOUND", message: "数据不存在" } })
    })

    const res = await cloudClient.callCloud("testFunc", {})
    expect(res.ok).toBe(false)
    expect(res.code).toBe("NOT_FOUND")
    expect(res.message).toBe("数据不存在")
  })

  test("callCloud 云调用失败返回 CLOUD_ERROR", async () => {
    global.wx.cloud.callFunction.mockImplementation(({ fail }) => {
      fail({ errMsg: "cloud function service unavailable" })
    })

    const res = await cloudClient.callCloud("testFunc", {})
    expect(res.ok).toBe(false)
    expect(res.code).toBe("CLOUD_ERROR")
  })

  test("callCloud 超时保护机制", async () => {
    jest.useFakeTimers()
    global.wx.cloud.callFunction.mockImplementation(() => {
      // 模拟不回调挂死
    })

    const callPromise = cloudClient.callCloud("testFunc", {}, { timeoutMs: 1000 })
    jest.advanceTimersByTime(1050)
    const res = await callPromise

    expect(res.ok).toBe(false)
    expect(res.code).toBe("TIMEOUT")
    jest.useRealTimers()
  })

  test("callCloud 页面卸载后忽略回调防穿透", async () => {
    const pageContext = { _nativeActionsUnloaded: true }
    let savedSuccess
    global.wx.cloud.callFunction.mockImplementation(({ success }) => {
      savedSuccess = success
    })

    const onComplete = jest.fn()
    cloudClient.callCloud("testFunc", {}, { pageContext, onComplete })
    savedSuccess({ result: { ok: true } })

    // 等待 microtask 执行，确认由于页面已卸载，回调被安全忽略
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(onComplete).not.toHaveBeenCalled()
  })
})

describe("Page Controller & Lifecycle Guard (pageController)", () => {
  beforeEach(() => {
    global.wx = {
      showToast: jest.fn(),
      nextTick: jest.fn((fn) => setTimeout(fn, 0))
    }
  })

  test("createPageController 初始化并保证内存同步优先守卫", () => {
    const pageInstance = {
      data: {
        keyword: "初始",
        count: 0
      },
      setData: jest.fn()
    }

    const controller = pageController.createPageController(pageInstance)

    expect(typeof pageInstance.applyState).toBe("function")
    expect(typeof pageInstance.flushStateNow).toBe("function")

    // 内存同步优先守卫：必须在当前 tick 内立即同步更新 this.data
    pageInstance.applyState({ keyword: "最新搜索词", count: 1 })
    expect(pageInstance.data.keyword).toBe("最新搜索词")
    expect(pageInstance.data.count).toBe(1)

    controller.dispose()
  })

  test("createPageController 页面卸载销毁防抖与原生动作", () => {
    const pageInstance = {
      data: {},
      setData: jest.fn()
    }

    const controller = pageController.createPageController(pageInstance)
    const action = controller.beginAction({ exclusiveKey: "modal" })
    expect(controller.isActionActive(action)).toBe(true)

    controller.dispose()
    expect(controller.isActionActive(action)).toBe(false)
  })

  test("definePage 高阶工厂包装 onLoad 与 onUnload 自动托管", () => {
    const onLoadMock = jest.fn()
    const onUnloadMock = jest.fn()

    const pageDef = pageController.definePage({
      data: { status: "ready" },
      onLoad: onLoadMock,
      onUnload: onUnloadMock
    })

    const mockInstance = {
      data: { status: "ready" },
      setData: jest.fn()
    }

    // 模拟 onLoad
    pageDef.onLoad.call(mockInstance, { id: "123" })
    expect(onLoadMock).toHaveBeenCalledWith({ id: "123" })
    expect(mockInstance.controller).toBeDefined()
    expect(typeof mockInstance.applyState).toBe("function")

    // 模拟 onUnload
    pageDef.onUnload.call(mockInstance)
    expect(onUnloadMock).toHaveBeenCalled()
    expect(mockInstance.controller).toBeNull()
  })
})

describe("Vehicle Display Labels & Options (vehicleLabels)", () => {
  const vehicleLabels = require("../shared/vehicleLabels")

  test("各枚举及样式字典完整导出", () => {
    expect(vehicleLabels.STATUS_LABEL_MAP.active).toBe("在用")
    expect(vehicleLabels.STATUS_CLASS_MAP.active).toBe("status-active")
    expect(vehicleLabels.STATUS_OPTIONS.length).toBe(5)
    expect(vehicleLabels.STATUS_OP_OPTIONS.length).toBe(3)
    expect(vehicleLabels.VEHICLE_TYPE_LABEL_MAP.sedan).toBe("轿车")
    expect(vehicleLabels.TRANSMISSION_LABEL_MAP.automatic).toBe("自动挡")
    expect(vehicleLabels.FUEL_TYPE_LABEL_MAP.electric).toBe("纯电")
  })

  test("getVehicleTypeLabel 与 getVehicleStatusLabel 支持安全兜底", () => {
    expect(vehicleLabels.getVehicleTypeLabel("suv")).toBe("SUV")
    expect(vehicleLabels.getVehicleTypeLabel("unknown", "保底")).toBe("保底")
    expect(vehicleLabels.getVehicleStatusLabel("idle")).toBe("闲置")
    expect(vehicleLabels.getVehicleStatusClass("maintenance")).toBe("status-maintenance")
    expect(vehicleLabels.getTransmissionLabel("manual")).toBe("手动挡")
    expect(vehicleLabels.getFuelTypeLabel("gasoline")).toBe("燃油")
  })

  test("客户端车辆状态映射与样式字典正确", () => {
    expect(vehicleLabels.CLIENT_VEHICLE_STATUS_TEXT_MAP.idle).toBe("可预约")
    expect(vehicleLabels.CLIENT_VEHICLE_STATUS_TEXT_MAP.available).toBe("可预约")
    expect(vehicleLabels.CLIENT_VEHICLE_STATUS_TEXT_MAP.active).toBe("使用中")
    expect(vehicleLabels.CLIENT_VEHICLE_STATUS_TEXT_MAP.rented).toBe("使用中")
    expect(vehicleLabels.CLIENT_VEHICLE_STATUS_TEXT_MAP.maintenance).toBe("维护中")
    expect(vehicleLabels.CLIENT_VEHICLE_STATUS_TEXT_MAP.reserved).toBe("已预约")
    expect(vehicleLabels.getClientVehicleStatusText("idle")).toBe("可预约")
    expect(vehicleLabels.getClientVehicleStatusText("unknown", "可预约")).toBe("可预约")
    expect(vehicleLabels.getClientVehicleStatusClass("active")).toBe("status-active")
    expect(vehicleLabels.CATEGORY_LABEL_MAP.luxury_sedan).toBe("豪华轿车")
    expect(vehicleLabels.normalizeFavoriteVehicleStatus("idle").statusText).toBe("可预约")
    expect(vehicleLabels.normalizeFavoriteVehicleStatus("idle").statusClass).toBe("status-available")
    expect(vehicleLabels.normalizeFavoriteVehicleStatus("unknown").statusText).toBe("状态待确认")
  })
})

describe("Privacy Domain Model (privacy)", () => {
  const privacy = require("../shared/privacy")

  test("隐私权利类型与状态字典完整性", () => {
    expect(privacy.PRIVACY_TYPES).toEqual(["access", "correction", "deletion"])
    expect(privacy.PRIVACY_STATUSES).toEqual(["pending", "processing", "completed", "rejected", "cancelled"])
    expect(privacy.TYPE_OPTIONS.length).toBe(3)
    expect(privacy.TYPE_FILTER_OPTIONS.length).toBe(4)
    expect(privacy.STATUS_OPTIONS.length).toBe(6)
  })

  test("getPrivacyTypeLabel 与 getPrivacyStatusLabel 支持安全兜底", () => {
    expect(privacy.getPrivacyTypeLabel("access")).toBe("查询信息")
    expect(privacy.getPrivacyTypeLabel("other", "兜底")).toBe("兜底")
    expect(privacy.getPrivacyStatusLabel("completed")).toBe("已完成")
    expect(privacy.getPrivacyStatusClass("pending")).toBe("status-pending")
  })

  test("canCancelPrivacyRequest 与 isPrivacyRequestActive 规则正确", () => {
    expect(privacy.canCancelPrivacyRequest("pending")).toBe(true)
    expect(privacy.canCancelPrivacyRequest("processing")).toBe(false)
    expect(privacy.canCancelPrivacyRequest("completed")).toBe(false)

    expect(privacy.isPrivacyRequestActive("pending")).toBe(true)
    expect(privacy.isPrivacyRequestActive("processing")).toBe(true)
    expect(privacy.isPrivacyRequestActive("completed")).toBe(false)
  })

  test("buildRequestJourney 流程进度与样式推导", () => {
    expect(privacy.buildRequestJourney("pending").journeyStage).toBe(1)
    expect(privacy.buildRequestJourney("processing").journeyStage).toBe(2)
    expect(privacy.buildRequestJourney("completed").journeyStage).toBe(3)
    expect(privacy.buildRequestJourney("rejected").journeyStage).toBe(3)
    expect(privacy.buildRequestJourney("cancelled").journeyStage).toBe(1)
  })
})

describe("Booking Status & Coordination (bookingStatus)", () => {
  const bookingStatus = require("../shared/bookingStatus")

  test("优先级与协调进度选项和字典完整", () => {
    expect(bookingStatus.STATUS_OPTIONS.length).toBe(8)
    expect(bookingStatus.PRIORITY_OPTIONS.length).toBe(4)
    expect(bookingStatus.WORKBENCH_PRIORITY_OPTIONS.length).toBe(3)
    expect(bookingStatus.COORDINATION_OPTIONS.length).toBe(4)
    expect(bookingStatus.mapPriorityText("priority")).toBe("优先")
    expect(bookingStatus.mapPriorityText("unknown", "常规")).toBe("常规")
    expect(bookingStatus.mapCoordinationText("coordinating")).toBe("协调中")
    expect(bookingStatus.mapCoordinationText("resolved")).toBe("已协调")
  })

  test("buildStatusGuidance 与旅程进度步进器方法正确导出", () => {
    expect(typeof bookingStatus.buildStatusGuidance).toBe("function")
    expect(typeof bookingStatus.buildJourneyProgress).toBe("function")
    expect(typeof bookingStatus.buildProgressSteps).toBe("function")
    expect(typeof bookingStatus.buildListSummary).toBe("function")
    expect(typeof bookingStatus.filterBookings).toBe("function")

    const guidance = bookingStatus.buildStatusGuidance("pending")
    expect(guidance.title).toBe("等待顾问联系")

    const journey = bookingStatus.buildJourneyProgress("pending")
    expect(journey.stageText).toContain("第 1 阶段")

    const steps = bookingStatus.buildProgressSteps("confirmed")
    expect(steps.length).toBe(5)
  })
})
