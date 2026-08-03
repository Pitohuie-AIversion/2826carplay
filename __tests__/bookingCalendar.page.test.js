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
})
