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
  afterEach(() => {
    delete global.Page
    delete global.wx
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
})
