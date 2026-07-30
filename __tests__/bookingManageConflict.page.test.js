function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/booking-manage-detail/booking-manage-detail")
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

describe("pages/booking-manage-detail conflict handling", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("详情加载时展示同车重叠预约", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ name, success }) => {
          expect(name).toBe("bookingDetail")
          success({
            result: {
              ok: true,
              detail: {
                id: "booking_target",
                vehicleId: "vehicle_1",
                vehicleName: "BMW M4",
                startDate: "2026-08-10",
                endDate: "2026-08-12",
                status: "pending"
              },
              conflicts: [
                {
                  id: "booking_overlap",
                  userName: "李四",
                  phone: "13900000000",
                  startDate: "2026-08-12",
                  endDate: "2026-08-14",
                  city: "杭州",
                  status: "contacted"
                }
              ],
              conflictTotal: 1,
              conflictsTruncated: false,
              conflictsUnavailable: false,
              conflictCheckSkipped: false
            }
          })
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      id: "booking_target"
    })

    page.loadDetail()

    expect(page.data.booking.id).toBe("booking_target")
    expect(page.data.conflictTotal).toBe(1)
    expect(page.data.conflicts[0]).toEqual(expect.objectContaining({
      id: "booking_overlap",
      statusText: "已联系",
      statusClass: "status-contacted"
    }))
  })

  test("冲突卡片可拨号并进入对应预约", () => {
    global.wx = {
      makePhoneCall: jest.fn(({ success }) => success()),
      navigateTo: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      id: "booking_target"
    })

    page.handleConflictCall({
      currentTarget: {
        dataset: {
          phone: "13900000000"
        }
      }
    })
    page.handleConflictTap({
      currentTarget: {
        dataset: {
          id: "booking_overlap"
        }
      }
    })

    expect(global.wx.makePhoneCall).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumber: "13900000000"
    }))
    expect(global.wx.navigateTo).toHaveBeenCalledWith({
      url: "/pages/booking-manage-detail/booking-manage-detail?id=booking_overlap"
    })
  })

  test("可从详情页将预约调整为候补并刷新详情", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              changed: true,
              schedulePriority: "standby",
              coordinationStatus: "pending"
            }
          })
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      id: "booking_target",
      coordinationEditable: true,
      booking: {
        schedulePriority: "normal",
        coordinationStatus: "pending"
      }
    })
    page.loadDetail = jest.fn()

    page.handleUpdateCoordination({
      currentTarget: {
        dataset: {
          field: "schedulePriority",
          value: "standby"
        }
      }
    })

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingUpdateCoordination",
      data: {
        id: "booking_target",
        schedulePriority: "standby",
        coordinationStatus: "pending"
      },
      success: expect.any(Function),
      fail: expect.any(Function)
    })
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "协调安排已更新",
      icon: "none"
    })
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
  })
})
