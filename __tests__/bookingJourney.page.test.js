const fs = require("fs")
const path = require("path")

function loadPageDefinition(path) {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require(path)
  return definition
}

function createPage(definition) {
  const page = {
    ...definition,
    data: {
      ...definition.data
    }
  }
  page.setData = jest.fn((patch) => {
    page.data = {
      ...page.data,
      ...patch
    }
  })
  return page
}

describe("我的预约旅程状态", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("列表汇总进行中与已结束预约并生成下一步指引", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              page: 0,
              hasMore: false,
              list: [
                { id: "pending-1", status: "pending", vehicleName: "粤A12345" },
                { id: "contacted-1", status: "contacted" },
                { id: "completed-1", status: "completed" },
                { id: "cancelled-1", status: "cancelled" }
              ]
            }
          })
        })
      }
    }
    const page = createPage(loadPageDefinition("../pages/bookings/bookings"))

    page.loadList()

    expect(page.data.listSummary).toEqual({
      ongoing: 2,
      completed: 1,
      cancelled: 1
    })
    expect(page.data.list.find((item) => item.id === "pending-1").statusGuidance).toMatchObject({
      title: "等待顾问联系",
      tone: "pending"
    })
    expect(page.data.list.find((item) => item.id === "pending-1")).toMatchObject({
      vehicleName: "预约车辆",
      vehicleReference: "车牌尾号 45"
    })
    expect(page.data.list.find((item) => item.id === "contacted-1").statusGuidance).toMatchObject({
      title: "正在确认行程",
      tone: "contacted"
    })
    expect(page.data.list.find((item) => item.id === "pending-1").journeyProgress).toMatchObject({
      stageText: "第 1 阶段 · 等待联系",
      width: "4%",
      stepOneClass: "journey-step-current"
    })
    expect(page.data.list.find((item) => item.id === "contacted-1").journeyProgress).toMatchObject({
      stageText: "第 2 阶段 · 行程确认",
      width: "50%",
      stepTwoClass: "journey-step-current"
    })
    expect(page.data.list.find((item) => item.id === "completed-1").journeyProgress).toMatchObject({
      stageText: "第 3 阶段 · 行程完成",
      width: "100%",
      stepThreeClass: "journey-step-current"
    })
    expect(page.data.list.find((item) => item.id === "cancelled-1").journeyProgress).toMatchObject({
      stageText: "流程已结束",
      stepTwoClass: "journey-step-upcoming",
      stepThreeClass: "journey-step-cancelled"
    })

    page.handleFilterTap({
      currentTarget: {
        dataset: {
          filter: "ongoing"
        }
      }
    })
    expect(page.data.visibleList.map((item) => item.id)).toEqual(["pending-1", "contacted-1"])
    expect(page.data.currentFilterLabel).toBe("进行中")

    page.handleFilterTap({
      currentTarget: {
        dataset: {
          filter: "cancelled"
        }
      }
    })
    expect(page.data.visibleList.map((item) => item.id)).toEqual(["cancelled-1"])
  })

  test("详情页状态变化时同步更新进度与下一步说明", () => {
    const page = createPage(loadPageDefinition("../pages/booking-detail/booking-detail"))

    page.applyBooking({
      id: "booking-1",
      status: "completed",
      userName: "张先生",
      phone: "13800138000",
      city: "杭州",
      note: ""
    })

    expect(page.data.statusText).toBe("已完成")
    expect(page.data.canEdit).toBe(false)
    expect(page.data.statusGuidance).toMatchObject({
      title: "本次行程已完成",
      tone: "completed"
    })
    expect(page.data.progressSteps[2]).toMatchObject({
      label: "行程完成",
      stateClass: "progress-current"
    })
  })

  test("详情页生成短预约编号、日期跨度并支持复制和查看车辆", () => {
    global.wx = {
      setClipboardData: jest.fn(({ success }) => success()),
      navigateTo: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition("../pages/booking-detail/booking-detail"))
    page.applyBooking({
      id: "booking-2026-success-12345678",
      vehicleId: "vehicle-1",
      vehicleName: "Porsche 911",
      status: "pending",
      startDate: "2099-08-10",
      endDate: "2099-08-12",
      userName: "张先生",
      phone: "13800138000",
      city: "杭州",
      note: ""
    })

    expect(page.data.bookingReference).toBe("#12345678")
    expect(page.data.journeySpanText).toBe("2 天跨度")

    page.handleCopyBookingId()
    page.handleViewVehicle()

    expect(wx.setClipboardData).toHaveBeenCalledWith(
      expect.objectContaining({
        data: "booking-2026-success-12345678"
      })
    )
    expect(wx.navigateTo).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "/pages/car-detail/car-detail?carId=vehicle-1"
      })
    )
  })

  test("列表使用原生图标与三阶段轨迹呈现预约状态", () => {
    const wxml = fs.readFileSync(path.join(__dirname, "../pages/bookings/bookings.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(__dirname, "../pages/bookings/bookings.wxss"), "utf8")

    expect(wxml).toContain("BOOKING PROGRESS")
    expect(wxml).toContain("booking-progress-fill")
    expect(wxml).toContain("vehicle-native-icon")
    expect(wxml).toContain("booking-vehicle-reference")
    expect(wxml).toContain("native-action-icon-document")
    expect(wxml).toContain('loading="{{loading}}" disabled="{{loading}}"')
    expect(wxml).toContain("{{loading ? '正在加载' : '加载更多预约'}}")
    expect(wxml).toContain('aria-pressed="{{currentFilter === \'all\'}}"')
    expect(wxml).toContain('aria-pressed="{{currentFilter === \'ongoing\'}}"')
    expect(wxml).toContain('hover-class="booking-filter-pressed"')
    expect(wxml).toContain("journey-summary-with-filter")
    expect(wxml).toContain('aria-role="group"')
    expect(wxml).toContain("booking-accent-{{item.journeyProgress.tone}}")
    expect(wxml).toContain("{{index + 1 < 10 ? '0' : ''}}{{index + 1}}")
    expect(wxml).toContain('aria-label="查看进行中的 {{listSummary.ongoing}} 条预约"')
    expect(wxml).not.toContain(">进行中 {{listSummary.ongoing}}</button>")
    expect(wxml).not.toContain(">✓<")
    expect(wxml).not.toContain(">›<")
    expect(wxss).toContain(".booking-progress-node")
    expect(wxss).toContain(".summary-native-icon")
    expect(wxss).toContain(".native-action-icon-garage")
    expect(wxss).toContain(".booking-filter-pressed")
    expect(wxss).toContain(".booking-accent-contacted")
    expect(wxss).toContain(".booking-accent-completed")
    expect(wxss).toContain(".booking-accent-cancelled")
  })

  test("预约详情使用原生状态与操作图标", () => {
    const js = fs.readFileSync(path.join(__dirname, "../pages/booking-detail/booking-detail.js"), "utf8")
    const wxml = fs.readFileSync(path.join(__dirname, "../pages/booking-detail/booking-detail.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(__dirname, "../pages/booking-detail/booking-detail.wxss"), "utf8")

    expect(wxml).toContain("progress-node-check")
    expect(wxml).toContain("progress-node-cancel")
    expect(wxml).toContain("{{saving ? '正在保存' : '保存修改'}}")
    expect(wxml).toContain("{{subscriptionRequesting ? '正在订阅' : '立即订阅'}}")
    expect(wxml).toContain("{{loading ? '正在取消' : '取消本次预约'}}")
    expect(wxml).toContain("copy-native-icon")
    expect(wxml).toContain('aria-label="复制预约编号 {{bookingReference}}"')
    expect(wxml).toContain('class="brand-emblem" src="/assets/icons/jijing-garage-emblem.png" mode="aspectFill" aria-hidden="true"')
    expect(wxml).toContain("edit-native-icon")
    expect(wxml).toContain("save-native-icon")
    expect(wxml).toContain("status-guidance-native-icon")
    expect(wxml).toContain("subscription-native-icon")
    expect(wxml).toContain("vehicle-native-icon")
    expect(wxml).toContain("booking-list-native-icon")
    expect(wxml).toContain("cancel-booking-native-icon")
    expect(wxml).toContain("retry-native-icon")
    expect(wxml).toContain("back-native-icon")
    expect(wxml).not.toContain(">✓<")
    expect(js).not.toContain('marker: index < activeIndex ? "✓"')
    expect(wxss).toContain(".progress-node-check")
    expect(wxss).toContain(".action-with-icon")
    expect(wxml).toContain('hover-class="copy-code-btn-pressed"')
    expect(wxss).toContain(".copy-code-btn-pressed")
    expect(wxss).toContain("calc(24rpx + env(safe-area-inset-right))")
    expect(wxss).toContain("calc(24rpx + env(safe-area-inset-left))")
    expect(wxss).toContain("calc(70rpx + env(safe-area-inset-bottom))")
    expect(wxss).toMatch(/\.code-row\s*\{[^}]*border-radius:\s*999rpx/s)
  })
})
