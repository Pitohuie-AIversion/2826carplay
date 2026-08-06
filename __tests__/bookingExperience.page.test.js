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

  test("常用日期快捷按钮可安排三天行程并提供即时手机号提示", () => {
    global.wx = {}
    const page = createPage(loadPageDefinition())
    page.data.today = "2026-08-05"

    page.handleDateShortcut({ currentTarget: { dataset: { action: "three-days" } } })

    expect(page.data.form.startDate).toBe("2026-08-05")
    expect(page.data.form.endDate).toBe("2026-08-08")
    const wxml = fs.readFileSync(path.resolve(__dirname, "../pages/booking/booking.wxml"), "utf8")
    expect(wxml).toContain("field-inline-error")
    expect(wxml).toContain('data-action="three-days"')
    expect(wxml).toContain("使用上次联系人")
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
