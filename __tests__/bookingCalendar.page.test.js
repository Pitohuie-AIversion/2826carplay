const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/booking-calendar/booking-calendar")
  return definition
}

function createPage(definition, overrides) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...(overrides || {})
    }
  }
  page.setData = jest.fn((patch) => {
    Object.assign(page.data, patch)
  })
  return page
}

describe("pages/booking-calendar", () => {
  test("模块跨月复用时首次打开查询实际本月，首次显示不重复加载", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-31T12:00:00.000Z"))
    const definition = loadPageDefinition()
    jest.setSystemTime(new Date("2026-11-01T12:00:00.000Z"))
    const requests = []
    global.wx = { cloud: { callFunction: (request) => {
      if (request.name === "getMyPermissions") request.success({ result: { ok: true, canManageBookings: true } })
      else requests.push(request)
    } } }
    const page = createPage(definition)
    global.getCurrentPages = () => [page]
    page.onLoad({})
    page.onShow()
    expect(page.data).toMatchObject({ monthKey: "2026-11", currentMonthKey: "2026-11", isCurrentMonth: true })
    expect(requests).toHaveLength(1)
    expect(requests[0].data).toEqual({ month: "2026-11" })
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("返回日历刷新正在浏览的月份，更新已取消预约与占用且保留两张草稿", () => {
    const requests = []
    global.wx = { cloud: { callFunction: (request) => requests.push(request) } }
    const booking = { id: "booking_1", vehicleId: "a", status: "confirmed", startDate: "2026-12-10", endDate: "2026-12-11" }
    const block = { id: "booking_block", bookingId: "booking_1", vehicleId: "a", kind: "booking", startDate: booking.startDate, endDate: booking.endDate }
    const blockForm = { vehicleId: "a", kind: "hold", startDate: "2026-12-20", endDate: "2026-12-21", reason: "尚未保存的档期说明" }
    const priceForm = { vehicleId: "b", label: "待调整", dailyPrice: "1200", startDate: "2026-12-24", endDate: "2026-12-25", reason: "尚未保存的价格说明" }
    const page = createPage(loadPageDefinition(), {
      pageAuthorized: true, monthKey: "2026-12", selectedDate: "2026-12-10",
      allBookings: [booking], allBlocks: [block], vehicles: [{ id: "a" }, { id: "b" }],
      blockForm, priceForm, editingBlockId: "draft_block", editingBlockVersion: 4,
      editingRuleId: "draft_rule", editingRuleVersion: 6
    })
    page.markCalendarFormDirty("blockForm")
    page.markCalendarFormDirty("priceForm")
    page.onShow()
    expect(page.data.selectedBlocks).toHaveLength(1)
    page.onShow()
    expect(requests).toHaveLength(1)
    expect(requests[0].data).toEqual({ month: "2026-12" })
    requests[0].success({ result: { ok: true, list: [{ ...booking, status: "cancelled" }], blocks: [], vehicles: [{ id: "b" }, { id: "a" }] } })
    expect(page.data).toMatchObject({
      monthKey: "2026-12", selectedDate: "2026-12-10", selectedBookings: [], selectedBlocks: [],
      blockForm, priceForm, blockVehicleIndex: 1, priceVehicleIndex: 0,
      editingBlockId: "draft_block", editingBlockVersion: 4, editingRuleId: "draft_rule", editingRuleVersion: 6
    })
    expect(page._hasUnsavedChanges).toBe(true)
    page.onUnload()
  })

  test("未授权时反复返回不会读取日历", () => {
    global.wx = { cloud: { callFunction: jest.fn() } }
    const page = createPage(loadPageDefinition(), { monthKey: "2026-10", pageAuthorized: false })
    page.onShow()
    page.onShow()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    page.onUnload()
  })

  test.each(["success", "network", "server", "timeout"])("保存中返回不插入读取，%s结算后补刷新并保留未提交草稿", (outcome) => {
    jest.useFakeTimers()
    const requests = []
    global.wx = { showToast: jest.fn(), cloud: { callFunction: (request) => requests.push(request) } }
    const blockForm = { vehicleId: "a", kind: "hold", startDate: "2026-12-20", endDate: "2026-12-21", reason: "本次提交" }
    const priceForm = { vehicleId: "a", label: "待保存价格", dailyPrice: "1200", startDate: "2026-12-24", endDate: "2026-12-25", reason: "保留草稿" }
    const page = createPage(loadPageDefinition(), { pageAuthorized: true, monthKey: "2026-12", vehicles: [{ id: "a" }], blockForm, priceForm })
    global.getCurrentPages = () => [page]
    page.markCalendarFormDirty("blockForm")
    page.markCalendarFormDirty("priceForm")
    page.onShow()
    page.handleSaveBlock()
    page.onShow()
    expect(requests).toHaveLength(1)
    expect(page.data.isSavingCalendar).toBe(true)
    if (outcome === "success") requests[0].success({ result: { ok: true } })
    else if (outcome === "server") requests[0].success({ result: { ok: false, message: "保存失败" } })
    else if (outcome === "network") requests[0].fail({ errMsg: "offline" })
    else jest.advanceTimersByTime(15000)
    expect(requests).toHaveLength(2)
    expect(requests[1]).toMatchObject({ name: "bookingCalendarList", data: { month: "2026-12" } })
    requests[1].success({ result: { ok: true, vehicles: [{ id: "a" }], list: [], blocks: [] } })
    expect(page.data.priceForm).toEqual(priceForm)
    if (outcome !== "success") expect(page.data.blockForm).toEqual(blockForm)
    expect(page._hasUnsavedChanges).toBe(true)
    expect(page.data.isSavingCalendar).toBe(false)
    if (outcome === "timeout") {
      requests[0].success({ result: { ok: true } })
      expect(requests).toHaveLength(2)
      expect(page.data.blockForm).toEqual(blockForm)
    }
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("跨月返回保留浏览月份，本月入口采用新月份并拒绝旧月份迟到结果", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-10-31T12:00:00.000Z"))
    const requests = []
    global.wx = { cloud: { callFunction: (request) => requests.push(request) } }
    const page = createPage(loadPageDefinition(), { pageAuthorized: true, monthKey: "2026-10", currentMonthKey: "2026-10", selectedDate: "2026-10-31" })
    page.onShow()
    expect(page.data.calendarCells.find((cell) => cell.isToday).date).toBe("2026-10-31")
    jest.setSystemTime(new Date("2026-11-01T12:00:00.000Z"))
    page.onShow()
    expect(page.data).toMatchObject({ monthKey: "2026-10", currentMonthKey: "2026-11", isCurrentMonth: false, selectedDate: "2026-10-31" })
    expect(page.data.calendarCells.some((cell) => cell.isToday)).toBe(false)
    expect(requests[0].data).toEqual({ month: "2026-10" })
    page.handleCurrentMonth()
    expect(requests[1].data).toEqual({ month: "2026-11" })
    requests[1].success({ result: { ok: true, list: [{ id: "new_month", startDate: "2026-11-01", endDate: "2026-11-01" }] } })
    requests[0].success({ result: { ok: true, list: [{ id: "stale_month", startDate: "2026-10-31", endDate: "2026-10-31" }] } })
    expect(page.data).toMatchObject({ monthKey: "2026-11", currentMonthKey: "2026-11", isCurrentMonth: true })
    expect(page.data.selectedBookings.map((booking) => booking.id)).toEqual(["new_month"])
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("校正超长车辆编号不会继续复用无效提交快照", () => {
    const requests = []
    global.wx = { showToast: jest.fn(), cloud: { callFunction: (request) => requests.push(request) } }
    const page = createPage(loadPageDefinition())
    const input = { vehicleId: "a".repeat(129), kind: "hold", startDate: "2026-10-01", endDate: "2026-10-02", reason: "核对" }
    page.saveCalendarChange("createBlock", input)
    requests[0].success({ result: { ok: false, code: "VALIDATION_ERROR" } })
    page.saveCalendarChange("createBlock", { ...input, vehicleId: "a".repeat(128) })
    expect(requests[1].data.requestId).not.toBe(requests[0].data.requestId)
    expect(requests[1].data.vehicleId).toHaveLength(128)
    page.onUnload()
  })
  test.each(["Block", "PriceRule"])("新建%s超时保持请求标识，内容更改换新标识，旧响应不清新草稿", (type) => {
    jest.useFakeTimers()
    const requests = []
    global.wx = { showToast: jest.fn(), cloud: { callFunction: (request) => requests.push(request) } }
    const formKey = type === "Block" ? "blockForm" : "priceForm"
    const page = createPage(loadPageDefinition(), { vehicles: [{ id: "a", name: "A" }], [formKey]: { vehicleId: "a", kind: "hold", label: "假期价", dailyPrice: "1000", startDate: "2026-10-01", endDate: "2026-10-02", reason: "原原因" } })
    global.getCurrentPages = () => [page]
    page.fetchBookings = jest.fn()
    page[`handleSave${type}`]()
    const firstId = requests[0].data.requestId
    expect(firstId).toMatch(/^[A-Za-z0-9_-]{12,64}$/)
    jest.advanceTimersByTime(15000)
    page.data[formKey].reason = " 原原因 "
    page[`handleSave${type}`]()
    expect(requests[1].data.requestId).toBe(firstId)
    requests[1].fail({ errMsg: "offline" })
    page.handleCalendarFormInput({ currentTarget: { dataset: { form: formKey, field: "reason" } }, detail: { value: "新原因" } })
    page[`handleSave${type}`]()
    expect(requests[2].data.requestId).not.toBe(firstId)
    requests[0].success({ result: { ok: true } })
    expect(page.data.isSavingCalendar).toBe(true)
    expect(page.data[formKey].reason).toBe("新原因")
    requests[2].success({ result: { ok: true, duplicate: true } })
    expect(page.data.isSavingCalendar).toBe(false)
    expect(page.data[formKey].reason).toBe("")
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("价格编辑保留读取版本，冲突刷新不会覆盖草稿，重新选择调整才采用新版本", () => {
    const requests = []
    global.wx = { showToast: jest.fn(), cloud: { callFunction: (request) => requests.push(request) } }
    const rule = { id: "rule", vehicleId: "a", label: "节日价", startDate: "2026-10-01", endDate: "2026-10-02", dailyPrice: 800, version: 4 }
    const vehicles = [{ id: "a", name: "A" }]
    const page = createPage(loadPageDefinition(), { monthKey: "2026-10", vehicles, allPriceRules: [rule] })
    global.getCurrentPages = () => [page]
    const event = { currentTarget: { dataset: { id: "rule" } } }
    page.handleEditPriceRule(event)
    page.handleCalendarFormInput({ currentTarget: { dataset: { form: "priceForm", field: "dailyPrice" } }, detail: { value: "900" } })
    page.handleSavePriceRule()
    expect(requests[0].data).toMatchObject({ action: "updatePriceRule", id: "rule", expectedVersion: 4, dailyPrice: "900" })
    requests[0].success({ result: { ok: false, code: "CALENDAR_VERSION_CONFLICT", message: "配置已变化，请重新选择调整" } })
    const newer = { ...rule, dailyPrice: 1000, version: 5 }
    requests[1].success({ result: { ok: true, vehicles, priceRules: [newer] } })
    expect(page.data.priceForm.dailyPrice).toBe("900")
    expect(page.data.editingRuleVersion).toBe(4)
    expect(page._hasUnsavedChanges).toBe(true)
    expect(page.data.calendarSaveError).toContain("重新选择调整")
    page.handleEditPriceRule(event)
    expect(page.data.priceForm.dailyPrice).toBe("1000")
    expect(page.data.editingRuleVersion).toBe(5)
    page.onUnload()
  })

  test("释放弹窗提交的是打开时的版本，后台列表刷新不能暗中扩大释放范围", () => {
    let modal
    global.wx = { showModal: (options) => { modal = options } }
    const page = createPage(loadPageDefinition(), { allBlocks: [{ id: "block", kind: "hold", version: 2 }] })
    global.getCurrentPages = () => [page]
    page.saveCalendarChange = jest.fn()
    page.handleReleaseBlock({ currentTarget: { dataset: { id: "block" } } })
    page.data.allBlocks = [{ id: "block", kind: "hold", version: 3 }]
    modal.success({ confirm: true, content: "核对后释放" })
    expect(page.saveCalendarChange).toHaveBeenCalledWith("releaseBlock", { id: "block", expectedVersion: 2, reason: "核对后释放" })
    page.onUnload()
  })

  test("车辆列表加载、重排和原车辆消失时，下拉展示与提交车辆保持一致", () => {
    const requests = []
    global.wx = { cloud: { callFunction: (request) => requests.push(request) } }
    const page = createPage(loadPageDefinition(), { monthKey: "2026-10", blockForm: { vehicleId: "b" }, priceForm: { vehicleId: "b" } })
    const vehicles = [{ id: "a", name: "A" }, { id: "b", name: "B" }]
    page.fetchBookings()
    requests[0].success({ result: { ok: true, vehicles } })
    expect(page.data.blockVehicleIndex).toBe(1)
    expect(page.data.priceVehicleIndex).toBe(1)
    page.fetchBookings()
    requests[1].success({ result: { ok: true, vehicles: vehicles.slice().reverse() } })
    expect(page.data.blockVehicleIndex).toBe(0)
    expect(page.data.priceVehicleIndex).toBe(0)
    page.fetchBookings()
    requests[2].success({ result: { ok: true, vehicles: [vehicles[0]] } })
    expect(page.data.blockVehicleIndex).toBe(-1)
    expect(page.data.priceVehicleIndex).toBe(-1)
    expect(page.data.blockForm.vehicleId).toBe("b")
    expect(page.data.priceForm.vehicleId).toBe("b")
    page.saveCalendarChange = jest.fn()
    page.handleSaveBlock()
    page.handleSavePriceRule()
    expect(page.saveCalendarChange).not.toHaveBeenCalled()
    page.onUnload()
  })

  test("保存或重置一张表单不会清除另一张表单的草稿和离开提醒", () => {
    let request
    global.wx = { showToast: jest.fn(), cloud: { callFunction: (options) => { request = options } } }
    const page = createPage(loadPageDefinition(), { monthKey: "2026-10", selectedDate: "2026-10-01", vehicles: [{ id: "a", name: "A" }] })
    global.getCurrentPages = () => [page]
    page.fetchBookings = jest.fn()
    const edit = (form, field, value) => page.handleCalendarFormInput({ currentTarget: { dataset: { form, field } }, detail: { value } })
    edit("blockForm", "reason", "尚未保存的档期草稿")
    edit("priceForm", "reason", "价格调整")
    page.saveCalendarChange("createPriceRule", { vehicleId: "a" })
    request.success({ result: { ok: true } })
    expect(page.data.blockForm.reason).toBe("尚未保存的档期草稿")
    expect(page._hasUnsavedChanges).toBe(true)
    page.handleResetPriceForm()
    expect(page._hasUnsavedChanges).toBe(true)
    page.handleResetBlockForm()
    expect(page._hasUnsavedChanges).toBe(false)
    page.onUnload()
  })

  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test("预约占用不提供人工编辑或释放入口", () => {
    global.wx = { showModal: jest.fn() }
    const block = { id: "booking_block", kind: "booking", bookingId: "booking_1", vehicleId: "vehicle_1", startDate: "2026-09-01", endDate: "2026-09-02" }
    const page = createPage(loadPageDefinition(), { monthKey: "2026-09", selectedDate: "2026-09-01", allBlocks: [block] })
    page.applyCalendar()
    expect(page.data.selectedBlocks[0].canEdit).toBe(false)
    page.handleEditBlock({ currentTarget: { dataset: { id: block.id } } })
    page.handleReleaseBlock({ currentTarget: { dataset: { id: block.id } } })
    expect(page.data.editingBlockId).toBe("")
    expect(global.wx.showModal).not.toHaveBeenCalled()
  })

  test("日历保存卸载后迟到回调不刷新页面或弹提示", () => {
    jest.useFakeTimers()
    let request
    global.wx = { showToast: jest.fn(), cloud: { callFunction: jest.fn((options) => { request = options }) } }
    const page = createPage(loadPageDefinition())
    global.getCurrentPages = () => [page]
    page.fetchBookings = jest.fn()
    page.saveCalendarChange("createBlock", { vehicleId: "vehicle_1" })
    page.onUnload()
    const calls = page.setData.mock.calls.length
    request.success({ result: { ok: true } })
    request.fail({})
    expect(page.setData.mock.calls).toHaveLength(calls)
    expect(page.fetchBookings).not.toHaveBeenCalled()
    expect(global.wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("日历保存同步抛错也结束等待并允许重试", () => {
    jest.useFakeTimers()
    global.wx = { showToast: jest.fn(), cloud: { callFunction: jest.fn(() => { throw new Error("offline") }) } }
    const page = createPage(loadPageDefinition())
    global.getCurrentPages = () => [page]
    expect(() => page.saveCalendarChange("createBlock", {})).not.toThrow()
    expect(page.data.isSavingCalendar).toBe(false)
    expect(jest.getTimerCount()).toBe(0)
    expect(global.wx.showToast).toHaveBeenCalledWith({ title: "保存失败，请重试", icon: "none" })
  })

  test("释放确认在页面退到后台后不能继续提交", () => {
    let modal
    global.wx = { showModal: jest.fn((options) => { modal = options }) }
    const page = createPage(loadPageDefinition(), { allBlocks: [{ id: "hold_1", kind: "hold" }] })
    global.getCurrentPages = () => [page]
    page.saveCalendarChange = jest.fn()
    page.handleReleaseBlock({ currentTarget: { dataset: { id: "hold_1" } } })
    global.getCurrentPages = () => [page, {}]
    modal.success({ confirm: true, content: "释放" })
    expect(page.saveCalendarChange).not.toHaveBeenCalled()
  })

  test("空价格按原值提交由服务端校验，保存时冻结正在提交的表单", () => {
    const page = createPage(loadPageDefinition(), { priceForm: { dailyPrice: "" }, blockForm: { reason: "原原因" } })
    page.saveCalendarChange = jest.fn()
    page.handleSavePriceRule()
    expect(page.saveCalendarChange).toHaveBeenCalledWith("createPriceRule", expect.objectContaining({ dailyPrice: "" }))
    page.data.isSavingCalendar = true
    page.handleCalendarFormInput({ currentTarget: { dataset: { form: "blockForm", field: "reason" } }, detail: { value: "新原因" } })
    page.handleResetBlockForm()
    expect(page.data.blockForm.reason).toBe("原原因")
  })

  test("切换月份后重新从云端查询该月数据", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              list: [],
              truncated: false
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      monthKey: "2026-12",
      loading: false
    })

    page.changeMonth(1)

    expect(page.data.monthKey).toBe("2027-01")
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingCalendarList",
      data: {
        month: "2027-01"
      },
      success: expect.any(Function),
      fail: expect.any(Function),
      complete: expect.any(Function)
    })
  })

  test("日历加载超时后结束刷新并忽略迟到结果", () => {
    jest.useFakeTimers()
    let requestOptions = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      monthKey: "2026-08",
      allBookings: [{ id: "existing_booking" }]
    })
    const done = jest.fn()

    page.fetchBookings(done)
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("日历加载超时，请重试")
    expect(done).toHaveBeenCalledTimes(1)

    requestOptions.success({
      result: {
        ok: true,
        list: [{ id: "late_booking" }]
      }
    })
    expect(page.data.allBookings).toEqual([{ id: "existing_booking" }])
  })

  test("快速连续翻月时只保留最新月份结果", () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition(), {
      monthKey: "2026-11",
      loading: false
    })

    page.changeMonth(1)
    page.changeMonth(1)
    requests[1].success({
      result: {
        ok: true,
        list: [
          {
            id: "latest_booking",
            startDate: "2027-01-10",
            endDate: "2027-01-10",
            status: "pending"
          }
        ]
      }
    })
    requests[0].success({
      result: {
        ok: true,
        list: [{ id: "stale_booking" }]
      }
    })

    expect(requests[0].data.month).toBe("2026-12")
    expect(requests[1].data.month).toBe("2027-01")
    expect(page.data.monthKey).toBe("2027-01")
    expect(page.data.allBookings[0].id).toBe("latest_booking")
  })

  test("云 SDK 同步异常时安全退出日历加载", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud down")
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      monthKey: "2026-08"
    })

    expect(() => page.fetchBookings()).not.toThrow()
    expect(page.data.loading).toBe(false)
    expect(page.data.loadError).toBe("cloud down")
  })

  test("离开日历后迟到结果不再修改月份数据", () => {
    let lateSuccess = null
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      monthKey: "2026-08",
      allBookings: [{ id: "existing_booking" }]
    })

    page.fetchBookings()
    page.onUnload()
    lateSuccess({
      result: {
        ok: true,
        list: [{ id: "late_booking" }]
      }
    })

    expect(page.data.allBookings).toEqual([{ id: "existing_booking" }])
  })

  test("首次加载使用摘要、月份、日期网格与日程骨架", () => {
    const pageDir = path.resolve(__dirname, "../pages/booking-calendar")
    const wxml = fs.readFileSync(path.join(pageDir, "booking-calendar.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "booking-calendar.wxss"), "utf8")

    expect(wxml).toContain('class="calendar-skeleton"')
    expect(wxml).toContain("calendar-skeleton-summary")
    expect(wxml).toContain("calendar-skeleton-date")
    expect(wxml).toContain("calendar-skeleton-booking-row")
    expect(wxml).not.toContain("正在整理预约档期…")
    expect(wxss).toContain(".calendar-skeleton-month-button")
    expect(wxss).toContain(".calendar-skeleton-date-muted")
  })

  test("日历汇总与日程记录使用统一原生业务图标", () => {
    const pageDir = path.resolve(__dirname, "../pages/booking-calendar")
    const wxml = fs.readFileSync(path.join(pageDir, "booking-calendar.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "booking-calendar.wxss"), "utf8")

    expect(wxml).toContain("summary-native-icon-calendar")
    expect(wxml).toContain("summary-native-icon-contact")
    expect(wxml).toContain("summary-native-icon-vehicle")
    expect(wxml).toContain("booking-vehicle-icon")
    expect(wxml).toContain("booking-route-chevron")
    expect(wxml).toContain("status-pill-dot")
    expect(wxml).toContain("inline-empty-icon")
    expect(wxml).toContain("retry-native-icon")
    expect(wxml).toContain('hover-class="{{item.empty ? \'none\' : \'date-cell-pressed\'}}"')
    expect(wxml).toContain('aria-pressed="{{item.isSelected}}"')
    expect(wxml).toContain("item.ariaLabel")
    expect(wxml).toContain("legend-today")
    expect(wxml).toContain("legend-selected")
    expect(wxml).toContain('hover-class="booking-item-pressed"')
    expect(wxml).toContain('aria-label="查看 {{item.vehicleName || \'车辆预约\'}}')
    expect(wxml).not.toContain("{{item.startDate}} → {{item.endDate}}")
    expect(wxss).toContain(".booking-calendar-icon")
    expect(wxss).toContain(".tip-info-mark")
    expect(wxss).toContain(".date-cell-pressed")
    expect(wxss).toContain(".date-cell-today::after")
    expect(wxss).toContain(".legend-selected")
    expect(wxss).toContain(".date-cell-selected.date-cell-conflict")
    expect(wxss).toContain(".booking-item-pressed")
    expect(wxml).toContain('bindtap="handleCurrentMonth"')
    expect(wxml).toContain('aria-label="返回本月"')
    expect(wxss).toContain(".month-current-button-pressed")
  })

  test("离开当前月后可一键返回本月", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-15T12:00:00.000Z"))
    global.wx = {}
    const page = createPage(loadPageDefinition(), {
      monthKey: "2026-12",
      currentMonthKey: "2026-08",
      isCurrentMonth: false,
      selectedDate: "2026-12-10"
    })
    page.fetchBookings = jest.fn()

    page.handleCurrentMonth()

    expect(page.data.monthKey).toBe("2026-08")
    expect(page.data.selectedDate).toBe("")
    expect(page.data.isCurrentMonth).toBe(true)
    expect(page.fetchBookings).toHaveBeenCalledTimes(1)
  })

  test("日历优先从本地快照恢复日程与档期以实现 SWR 秒开", () => {
    const mockSnapshot = {
      list: [{ id: "cached_b1", vehicleName: "保时捷 911", startDate: "2026-08-10", endDate: "2026-08-12", status: "confirmed" }],
      blocks: [{ id: "cached_blk1", kind: "maintenance", startDate: "2026-08-15", endDate: "2026-08-16" }],
      priceRules: [],
      vehicles: [{ id: "v1", name: "保时捷 911", priceDay: 2800 }],
      truncated: false
    }
    global.wx = {
      getStorageSync: jest.fn((key) => {
        if (key === "booking_calendar_2026-08") return mockSnapshot
        return null
      }),
      setStorageSync: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      monthKey: "2026-08",
      loading: true
    })

    const restored = page.restoreCalendarSnapshot("2026-08")
    expect(restored).toBe(true)
    expect(page.data.loading).toBe(false)
    expect(page.data.allBookings.length).toBe(1)
    expect(page.data.allBlocks.length).toBe(1)
  })

  test("输入日历表单时触发未保存防护，重置与离开时安全清除", () => {
    global.wx = {
      enableAlertBeforeUnload: jest.fn(),
      disableAlertBeforeUnload: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      blockForm: { vehicleId: "v1", kind: "maintenance", startDate: "", endDate: "", reason: "" }
    })

    page.handleCalendarFormInput({
      currentTarget: { dataset: { form: "blockForm", field: "reason" } },
      detail: { value: "定期常规保养" }
    })
    expect(page._hasUnsavedChanges).toBe(true)
    expect(global.wx.enableAlertBeforeUnload).toHaveBeenCalled()

    page.handleResetBlockForm()
    expect(page._hasUnsavedChanges).toBe(false)
    expect(global.wx.disableAlertBeforeUnload).toHaveBeenCalled()
  })
})
