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
})
