const fs = require("fs")
const path = require("path")

function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/booking/booking")
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      form: { ...definition.data.form }
    }
  }
  page.setData = jest.fn((patch, done) => {
    Object.keys(patch).forEach((key) => {
      if (key.startsWith("form.")) {
        page.data.form[key.slice(5)] = patch[key]
      } else {
        page.data[key] = patch[key]
      }
    })
    if (typeof done === "function") {
      done()
    }
  })
  return page
}

describe("预约表单人性化体验", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
    delete global.getApp
  })

  test("城市列表加载后不再静默选择第一个城市", () => {
    global.wx = {}
    const page = createPage(loadPageDefinition())
    page.data.cityOptions = ["杭州", "上海"]

    page.syncCitySelection()

    expect(page.data.form.city).toBe("")
    expect(page.data.cityIndex).toBe(-1)
    expect(page.data.pickerCityIndex).toBe(0)
  })

  test("上次联系人仅在用户主动点击后填入", () => {
    global.wx = {
      getStorageSync: jest.fn(() => ({ userName: "张先生", phone: "13800138000" })),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.loadSavedContact()
    expect(page.data.savedContactAvailable).toBe(true)
    expect(page.data.form.userName).toBe("")
    expect(page.data.form.phone).toBe("")

    page.handleUseSavedContact()
    expect(page.data.form.userName).toBe("张先生")
    expect(page.data.form.phone).toBe("13800138000")
    expect(page.data.formProgress.phoneComplete).toBe(true)
  })

  test("主动清除本机联系人只删除联系记忆，保留已填表单与其他缓存", () => {
    const saved = { userName: "张先生", phone: "13800138000" }
    const storage = new Map([["lastBookingContact", saved], ["bookings_snapshot", [{ id: "booking_1" }]]])
    global.wx = {
      getStorageSync: jest.fn((key) => storage.get(key)),
      removeStorageSync: jest.fn((key) => storage.delete(key)), showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.loadSavedContact()
    page.handleUseSavedContact()
    const form = { ...page.data.form }
    page.handleClearSavedContact()
    expect(storage.has("lastBookingContact")).toBe(false)
    expect(storage.get("bookings_snapshot")).toEqual([{ id: "booking_1" }])
    expect(page._savedContact).toBeNull()
    expect(page.data.savedContactAvailable).toBe(false)
    expect(page.data.form).toEqual(form)
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "已清除本机联系人", icon: "none" })
    const reopened = createPage(loadPageDefinition())
    reopened.loadSavedContact()
    expect(reopened.data.savedContactAvailable).toBe(false)
  })

  test("本地删除失败不误报成功，也不清掉内存中的联系人", () => {
    const saved = { userName: "张先生", phone: "13800138000" }
    global.wx = {
      getStorageSync: jest.fn(() => saved),
      removeStorageSync: jest.fn(() => { throw new Error("storage failure") }), showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.loadSavedContact()
    page.handleClearSavedContact()
    expect(page._savedContact).toEqual(saved)
    expect(page.data.savedContactAvailable).toBe(true)
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "清除失败，请重试", icon: "none" })
  })

  test.each(["hidden", "unloaded", "submitting"])("%s 页面不清除联系人", (state) => {
    global.wx = { removeStorageSync: jest.fn(), showToast: jest.fn() }
    const page = createPage(loadPageDefinition())
    global.getCurrentPages = () => state === "hidden" ? [page, {}] : [page]
    if (state === "unloaded") page.onUnload()
    if (state === "submitting") page.data.isSubmitting = true
    page.handleClearSavedContact()
    expect(wx.removeStorageSync).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("常用日期快捷按钮可安排三天行程并提供即时手机号提示", () => {
    global.wx = {}
    const page = createPage(loadPageDefinition())
    page.data.today = "2026-08-05"

    page.handleDateShortcut({ currentTarget: { dataset: { action: "three-days" } } })

    expect(page.data.form.startDate).toBe("2026-08-05")
    expect(page.data.form.endDate).toBe("2026-08-07")
    expect(page.data.rentalEstimate.rentalDays).toBe(3)
    const wxml = fs.readFileSync(path.resolve(__dirname, "../pages/booking/booking.wxml"), "utf8")
    expect(wxml).toContain("field-inline-error")
    expect(wxml).toContain('data-action="three-days"')
    expect(wxml).toContain("使用上次联系人")
    expect(wxml).toContain('bindtap="handleClearSavedContact"')
  })

  test.each([
    ["2026-08-05", "7", "2026-08-11"],
    ["2026-08-29", "7", "2026-09-04"],
    ["2026-12-30", "3", "2027-01-01"]
  ])("详情试算 %s 的 %s 天带入预约后保持日期数量和参考金额", (today, days, expectedEnd) => {
    jest.useFakeTimers().setSystemTime(new Date(`${today}T12:00:00`))
    global.wx = {}
    global.getApp = () => ({ globalData: {} })
    const page = createPage(loadPageDefinition())
    page.loadSavedContact = jest.fn()
    page.loadOperationConfig = jest.fn()
    page.loadBookingCar = jest.fn()
    const checkedRanges = []
    page.checkVehicleAvailability = jest.fn(() => checkedRanges.push({ ...page.data.form }))

    page.onLoad({ carId: "car-trip", days })
    page.applyCar({ name: "行程车辆", priceDay: 100, rentalDiscountTiers: [{ minDays: 7, discountRate: 0.9 }] })

    expect(page.data.form).toEqual(expect.objectContaining({ startDate: today, endDate: expectedEnd }))
    expect(checkedRanges).toEqual([expect.objectContaining({ startDate: today, endDate: expectedEnd })])
    expect(page.data.rentalEstimate.rentalDays).toBe(Number(days))
    expect(page.data.rentalEstimate.estimateTotal).toBe(Number(days) * (Number(days) >= 7 ? 90 : 100))
    page.onUnload()
  })

  test("普通预约入口不预填日期，手动同日取还仍按一天预估", () => {
    global.wx = {}
    global.getApp = () => ({ globalData: {} })
    const page = createPage(loadPageDefinition())
    page.loadSavedContact = jest.fn()
    page.loadOperationConfig = jest.fn()
    page.loadBookingCar = jest.fn()
    page.checkVehicleAvailability = jest.fn()

    page.onLoad({ carId: "car-trip" })
    expect(page.data.form.startDate).toBe("")
    expect(page.data.form.endDate).toBe("")
    expect(page.checkVehicleAvailability).not.toHaveBeenCalled()
    page.applyCar({ name: "行程车辆", priceDay: 100 })
    for (const field of ["startDate", "endDate"]) {
      page.handleDateChange({ currentTarget: { dataset: { field } }, detail: { value: "2026-08-05" } })
    }
    expect(page.data.rentalEstimate).toEqual(expect.objectContaining({ rentalDays: 1, estimateTotal: 100 }))
    page.onUnload()
  })

  test("安排三天使用已选开始日并跨月同步正确档期与参考金额", () => {
    global.wx = {}
    const page = createPage(loadPageDefinition())
    page.data.today = "2026-08-05"
    page.data.form.startDate = "2026-08-31"
    page.data.priceDay = 100
    const checkedRanges = []
    page.checkVehicleAvailability = jest.fn(() => checkedRanges.push({ ...page.data.form }))

    page.handleDateShortcut({ currentTarget: { dataset: { action: "three-days" } } })

    expect(page.data.form).toEqual(expect.objectContaining({ startDate: "2026-08-31", endDate: "2026-09-02" }))
    expect(checkedRanges).toEqual([expect.objectContaining({ startDate: "2026-08-31", endDate: "2026-09-02" })])
    expect(page.data.rentalEstimate).toEqual(expect.objectContaining({ rentalDays: 3, estimateTotal: 300 }))
  })

  test("订阅弹窗期间修改表单不会改变已确认的提交内容", () => {
    let continueSubmit
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => success({
          result: { ok: true, id: "booking-snapshot-1" }
        }))
      },
      setStorageSync: jest.fn(),
      setNavigationBarTitle: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.carId = "vehicle-1"
    page.data.carName = "Porsche 911"
    page.data.privacyAgreed = true
    page.data.form = {
      userName: "张先生",
      phone: "13800138000",
      startDate: "2099-08-10",
      endDate: "2099-08-12",
      city: "杭州",
      note: "原始备注"
    }
    page.data.bookingSummary = {
      carName: "Porsche 911",
      dateText: "08月10日 → 08月12日",
      durationText: "2 天跨度",
      contactText: "张先生 · 138****8000",
      cityText: "杭州"
    }
    page.requestStatusSubscription = jest.fn((done) => {
      continueSubmit = done
    })

    page.handleSubmit()
    page.handleInput({
      currentTarget: { dataset: { field: "phone" } },
      detail: { value: "13900139000" }
    })
    page.handleInput({
      currentTarget: { dataset: { field: "note" } },
      detail: { value: "弹窗期间修改" }
    })
    continueSubmit()

    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "bookingCreate",
      data: expect.objectContaining({
        phone: "13800138000",
        note: "原始备注"
      })
    }))
    expect(wx.setStorageSync).toHaveBeenCalledWith("lastBookingContact", {
      userName: "张先生",
      phone: "13800138000"
    })
    expect(page.data.submittedSummary).toEqual({
      carName: "Porsche 911",
      dateText: "08月10日 → 08月12日",
      durationText: "2 天跨度",
      contactText: "张先生 · 138****8000",
      cityText: "杭州"
    })
  })

  test("车辆详情无响应时退出骨架屏并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      },
      setNavigationBarTitle: jest.fn()
    }
    const page = createPage(loadPageDefinition())

    page.loadBookingCar("vehicle-timeout")
    expect(page.data.loadingCar).toBe(true)

    jest.advanceTimersByTime(15 * 1000)
    expect(page.data.loadingCar).toBe(false)
    expect(page.data.loadError).toBe(true)
    expect(page.data.loadErrorText).toBe("车辆信息加载超时，请检查网络后重试")

    lateSuccess({
      result: {
        ok: true,
        car: { id: "vehicle-timeout", name: "迟到车辆", location: "杭州" }
      }
    })
    expect(page.data.loadError).toBe(true)
    expect(page.data.carName).toBe("")
  })

  test("车辆和预约提交在后台完成时不改前台标题，返回后恢复最新标题", () => {
    jest.useFakeTimers()
    const requests = []
    global.wx = {
      cloud: { callFunction: jest.fn((request) => requests.push(request)) },
      setNavigationBarTitle: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    let stack = [page]
    global.getCurrentPages = () => stack
    page.data.carId = "vehicle-background"
    page.applyCar({ name: "原车辆", location: "杭州" })
    page.loadBookingCar(page.data.carId)
    wx.setNavigationBarTitle.mockClear()
    stack = [page, { route: "pages/content-page/content-page" }]
    requests[0].success({ result: { ok: true, car: { name: "最新车辆", location: "杭州" } } })
    expect(page.data.loadingCar).toBe(false)
    expect(page.data.carName).toBe("最新车辆")
    expect(wx.setNavigationBarTitle).not.toHaveBeenCalled()

    stack = [page]
    page.onShow()
    expect(wx.setNavigationBarTitle).toHaveBeenLastCalledWith({ title: "最新车辆 预约" })
    page.data.privacyAgreed = true
    page.data.form = {
      userName: "张先生", phone: "13800138000", startDate: "2099-08-10",
      endDate: "2099-08-12", city: "杭州", note: ""
    }
    page.handleSubmit()
    const submitRequest = requests.find((request) => request.name === "bookingCreate")
    expect(submitRequest).toBeDefined()
    stack = [page, { route: "pages/content-page/content-page" }]
    wx.setNavigationBarTitle.mockClear()
    submitRequest.success({ result: { ok: true, id: "booking-background" } })
    expect(page.data.submitSuccess).toBe(true)
    expect(page.data.isSubmitting).toBe(false)
    expect(wx.setNavigationBarTitle).not.toHaveBeenCalled()

    stack = [page]
    page.onShow()
    expect(wx.setNavigationBarTitle).toHaveBeenLastCalledWith({ title: "预约已提交" })
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("预约提交无响应时恢复按钮并忽略迟到成功", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      },
      setNavigationBarTitle: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.carId = "vehicle-submit-timeout"
    page.data.carName = "Porsche 911"
    page.data.privacyAgreed = true
    page.data.form = {
      userName: "张先生",
      phone: "13800138000",
      startDate: "2099-08-10",
      endDate: "2099-08-12",
      city: "杭州",
      note: ""
    }

    page.handleSubmit()
    expect(page.data.isSubmitting).toBe(true)

    jest.advanceTimersByTime(15 * 1000)
    expect(page.data.isSubmitting).toBe(false)
    expect(page.data.submitButtonText).toBe("提交预约")
    expect(wx.showToast).toHaveBeenCalledWith({ title: "提交超时，请重试", icon: "none" })

    lateSuccess({ result: { ok: true, id: "late-booking" } })
    expect(page.data.submitSuccess).toBe(false)
    expect(wx.setNavigationBarTitle).not.toHaveBeenCalled()
  })

  test("预约提交同步异常时安全恢复可重试状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud sdk crashed")
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.data.carId = "vehicle-submit-error"
    page.data.carName = "Porsche 911"
    page.data.privacyAgreed = true
    page.data.form = {
      userName: "张先生",
      phone: "13800138000",
      startDate: "2099-08-10",
      endDate: "2099-08-12",
      city: "杭州",
      note: ""
    }

    expect(() => page.handleSubmit()).not.toThrow()
    expect(page.data.isSubmitting).toBe(false)
    expect(page.data.submitButtonText).toBe("提交预约")
    expect(wx.showToast).toHaveBeenCalledWith({ title: "预约提交失败", icon: "none" })
  })
})
