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

function createPage(definition, data) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...(data || {})
    }
  }
  page.setData = jest.fn((patch) => {
    Object.keys(patch).forEach((key) => {
      if (key.startsWith("form.")) {
        page.data.form[key.slice(5)] = patch[key]
      } else {
        page.data[key] = patch[key]
      }
    })
  })
  return page
}

describe("pages/booking availability advisory", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("选完整日期后自动显示同期咨询提醒", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ name, success }) => {
          expect(name).toBe("vehicleAvailabilityCheck")
          success({
            result: {
              ok: true,
              available: false,
              conflictCount: 2,
              message: "当前已有 2 条同期咨询，仍可提交候补"
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      carId: "vehicle_1",
      form: {
        userName: "",
        phone: "",
        startDate: "2099-08-10",
        endDate: "",
        city: "",
        note: ""
      }
    })

    page.handleDateChange({
      currentTarget: { dataset: { field: "endDate" } },
      detail: { value: "2099-08-12" }
    })

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      name: "vehicleAvailabilityCheck",
      data: {
        vehicleId: "vehicle_1",
        startDate: "2099-08-10",
        endDate: "2099-08-12"
      }
    }))
    expect(page.data.availabilityState).toBe("conflict")
    expect(page.data.availabilityText).toContain("2 条同期咨询")
  })

  test("查询失败只提示顾问确认，不阻止预约提交", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ fail }) => fail(new Error("network")))
      }
    }
    const page = createPage(loadPageDefinition(), {
      carId: "vehicle_1",
      form: {
        userName: "",
        phone: "",
        startDate: "2099-08-10",
        endDate: "2099-08-12",
        city: "",
        note: ""
      }
    })

    page.checkVehicleAvailability()

    expect(page.data.availabilityState).toBe("unknown")
    expect(page.data.availabilityText).toContain("仍可提交")
  })

  test("档期查询无响应时自动收口并忽略迟到结果", () => {
    jest.useFakeTimers()
    let lateSuccess
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          lateSuccess = success
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      carId: "vehicle_1",
      form: {
        userName: "",
        phone: "",
        startDate: "2099-08-10",
        endDate: "2099-08-12",
        city: "",
        note: ""
      }
    })

    page.checkVehicleAvailability()
    expect(page.data.availabilityState).toBe("checking")

    jest.advanceTimersByTime(12 * 1000)
    expect(page.data.availabilityState).toBe("unknown")
    expect(page.data.availabilityText).toBe("档期查询超时，仍可提交并由顾问确认")

    lateSuccess({
      result: {
        ok: true,
        available: true,
        conflictCount: 0,
        message: "迟到的空闲结果"
      }
    })
    expect(page.data.availabilityState).toBe("unknown")
    expect(page.data.availabilityText).toBe("档期查询超时，仍可提交并由顾问确认")
  })

  test("档期查询同步异常时降级为顾问确认", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud sdk crashed")
        })
      }
    }
    const page = createPage(loadPageDefinition(), {
      carId: "vehicle_1",
      form: {
        userName: "",
        phone: "",
        startDate: "2099-08-10",
        endDate: "2099-08-12",
        city: "",
        note: ""
      }
    })

    expect(() => page.checkVehicleAvailability()).not.toThrow()
    expect(page.data.availabilityState).toBe("unknown")
    expect(page.data.availabilityText).toContain("仍可提交")
  })

  test("填写预约信息时实时提示完成度和下一项", () => {
    global.wx = {}
    const page = createPage(loadPageDefinition())

    page.handleInput({
      currentTarget: { dataset: { field: "userName" } },
      detail: { value: "张先生" }
    })
    expect(page.data.formProgress).toMatchObject({
      completed: 1,
      total: 5,
      percent: 20,
      nextLabel: "填写正确手机号",
      submitHint: "还需完成：填写正确手机号",
      contactStepClass: "form-step-current",
      dateStepClass: "form-step-upcoming",
      privacyStepClass: "form-step-upcoming"
    })

    page.handleInput({
      currentTarget: { dataset: { field: "phone" } },
      detail: { value: "13800138000" }
    })
    page.data.form.startDate = "2099-08-10"
    page.data.form.endDate = "2099-08-12"
    page.handlePrivacyAgreementChange({
      detail: {
        value: ["agreed"]
      }
    })

    expect(page.data.formProgress).toEqual({
      completed: 5,
      total: 5,
      percent: 100,
      ready: true,
      userNameComplete: true,
      phoneComplete: true,
      startDateComplete: true,
      endDateComplete: true,
      privacyComplete: true,
      nextLabel: "可以提交预约",
      submitHint: "信息已完整，可以提交预约",
      contactStepClass: "form-step-complete",
      dateStepClass: "form-step-complete",
      privacyStepClass: "form-step-complete"
    })
  })

  test("信息填写完成后生成脱敏的提交确认摘要", () => {
    global.wx = {}
    const page = createPage(loadPageDefinition(), {
      carName: "Porsche 911",
      form: {
        userName: "张先生",
        phone: "13800138000",
        startDate: "2099-08-10",
        endDate: "2099-08-12",
        city: "杭州",
        note: ""
      }
    })

    page.handleInput({
      currentTarget: { dataset: { field: "userName" } },
      detail: { value: "张先生" }
    })

    expect(page.data.bookingSummary).toEqual({
      carName: "Porsche 911",
      dateText: "08月10日 → 08月12日",
      durationText: "2 天跨度",
      contactText: "张先生 · 138****8000",
      cityText: "杭州"
    })
    expect(JSON.stringify(page.data.bookingSummary)).not.toContain("13800138000")
  })

  test("提交成功后展示结果页并可直达预约详情", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ name, success }) => {
          expect(name).toBe("bookingCreate")
          success({
            result: {
              ok: true,
              id: "booking-success-1"
            }
          })
        })
      },
      setNavigationBarTitle: jest.fn(),
      navigateTo: jest.fn(),
      showToast: jest.fn()
    }
    const summary = {
      carName: "Porsche 911",
      dateText: "08月10日 → 08月12日",
      durationText: "2 天跨度",
      contactText: "张先生 · 138****8000",
      cityText: "杭州"
    }
    const page = createPage(loadPageDefinition(), {
      carId: "vehicle-1",
      carName: "Porsche 911",
      privacyAgreed: true,
      bookingSummary: summary,
      form: {
        userName: "张先生",
        phone: "13800138000",
        startDate: "2099-08-10",
        endDate: "2099-08-12",
        city: "杭州",
        note: ""
      }
    })
    page.requestStatusSubscription = jest.fn((done) => done())

    page.handleSubmit()

    expect(page.data.submitSuccess).toBe(true)
    expect(page.data.submittedBookingId).toBe("booking-success-1")
    expect(page.data.submittedSummary).toEqual(summary)
    expect(page.data.isSubmitting).toBe(false)
    expect(wx.setNavigationBarTitle).toHaveBeenCalledWith({
      title: "预约已提交"
    })

    page.handleViewSubmittedBooking()

    expect(wx.navigateTo).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/pages/booking-detail/booking-detail?id=booking-success-1"
      })
    )
  })

  test("提交页使用分段进度、完整度门槛和原生业务图标", () => {
    const wxml = fs.readFileSync(path.join(__dirname, "../pages/booking/booking.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(__dirname, "../pages/booking/booking.wxss"), "utf8")

    expect(wxml).toContain("form-progress-steps")
    expect(wxml).toContain("{{formProgress.submitHint}}")
    expect(wxml).toContain('disabled="{{isSubmitting || !formProgress.ready}}"')
    expect(wxml).toContain('loading="{{isSubmitting}}"')
    expect(wxml).toContain('wx:if="{{!isSubmitting}}" class="submit-native-icon"')
    expect(wxml).toContain('wx:if="{{!isSubmitting}}" class="submit-arrow"')
    expect(wxml).toContain('aria-label="填写取车城市，选填"')
    expect(wxml).toContain('aria-label="填写预约备注，选填，最多二百字"')
    expect(wxml).toContain("success-next-phone")
    expect(wxml).toContain("success-action-document")
    expect(wxml).toContain("success-action-garage")
    expect(wxml).toContain('aria-label="重新检查车辆档期"')
    expect(wxml).toContain('aria-role="link" aria-label="查看隐私政策"')
    expect(wxml).toContain('hover-class="booking-action-pressed"')
    expect(wxml).toContain('hover-class="booking-picker-pressed"')
    expect(wxml).toContain("{{formProgress.userNameComplete ? 'form-control-complete' : ''}}")
    expect(wxml).toContain("{{formProgress.endDateComplete ? 'form-control-complete' : ''}}")
    expect(wxml).toContain('aria-required="{{true}}"')
    expect(wxml).toContain('class="privacy-required-mark"')
    expect(wxss).toContain(".form-step-current")
    expect(wxss).toContain(".form-control-complete")
    expect(wxss).toContain(".privacy-required-mark")
    expect(wxss).toContain(".submit-readiness-ready")
    expect(wxss).toContain(".submit-button-loading")
    expect(wxss).toContain("calc(24rpx + env(safe-area-inset-right))")
    expect(wxss).toContain("calc(24rpx + env(safe-area-inset-left))")
    expect(wxss).toContain("calc(70rpx + env(safe-area-inset-bottom))")
    expect(wxss).toContain(".success-action-refresh")
    expect(wxss).toContain(".booking-link-pressed")
    expect(wxss).toContain(".booking-action-pressed")
    expect(wxss).toContain(".booking-picker-pressed")
  })
})
