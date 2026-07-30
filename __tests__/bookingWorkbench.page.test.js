function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  require("../pages/booking-workbench/booking-workbench")
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

describe("pages/booking-workbench", () => {
  afterEach(() => {
    delete global.Page
    delete global.wx
  })

  test("读取预约后生成待协调队列", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success, complete }) => {
          success({
            result: {
              ok: true,
              list: [
                {
                  id: "booking_1",
                  vehicleName: "MX-5",
                  userName: "张三",
                  phone: "13800000000",
                  status: "pending",
                  schedulePriority: "priority",
                  coordinationStatus: "pending",
                  createdAt: "2020-01-01T00:00:00.000Z"
                }
              ],
              truncated: false
            }
          })
          complete()
        })
      }
    }
    const page = createPage(loadPageDefinition())

    page.fetchBookings()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingList",
      data: {
        status: "all",
        limit: 2000
      },
      success: expect.any(Function),
      fail: expect.any(Function),
      complete: expect.any(Function)
    })
    expect(page.data.summary.todo).toBe(1)
    expect(page.data.summary.pending).toBe(1)
    expect(page.data.summary.priority).toBe(1)
    expect(page.data.summary.overdue).toBe(1)
    expect(page.data.queue[0].id).toBe("booking_1")
  })

  test("支持切换队列、拨号和进入预约详情", () => {
    global.wx = {
      makePhoneCall: jest.fn(),
      navigateTo: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      selectedMode: "todo",
      allBookings: [
        {
          id: "booking_1",
          status: "contacted",
          schedulePriority: "standby",
          coordinationStatus: "coordinating",
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    })

    page.handleFilterTap({
      currentTarget: {
        dataset: {
          mode: "standby"
        }
      }
    })
    page.handleCallPhone({
      currentTarget: {
        dataset: {
          phone: "13800000000"
        }
      }
    })
    page.handleViewDetail({
      currentTarget: {
        dataset: {
          id: "booking_1"
        }
      }
    })

    expect(page.data.selectedMode).toBe("standby")
    expect(page.data.queue).toHaveLength(1)
    expect(global.wx.makePhoneCall).toHaveBeenCalledWith(expect.objectContaining({
      phoneNumber: "13800000000"
    }))
    expect(global.wx.navigateTo).toHaveBeenCalledWith({
      url: "/pages/booking-manage-detail/booking-manage-detail?id=booking_1"
    })
  })

  test("支持按多个字段本地搜索并清空关键词", () => {
    const page = createPage(loadPageDefinition(), {
      allBookings: [
        {
          id: "booking_shanghai",
          vehicleName: "MX-5",
          userName: "张三",
          phone: "13800000000",
          city: "上海",
          status: "pending",
          coordinationStatus: "pending",
          createdAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "booking_hangzhou",
          vehicleName: "GT-R",
          userName: "赵四",
          phone: "13900000000",
          city: "杭州",
          status: "pending",
          coordinationStatus: "pending",
          createdAt: "2026-01-02T00:00:00.000Z"
        }
      ]
    })

    page.handleKeywordInput({
      detail: {
        value: "赵四 139"
      }
    })

    expect(page.data.keyword).toBe("赵四 139")
    expect(page.data.queueTotal).toBe(2)
    expect(page.data.queue).toHaveLength(1)
    expect(page.data.queue[0].id).toBe("booking_hangzhou")

    page.handleClearKeyword()

    expect(page.data.keyword).toBe("")
    expect(page.data.queue).toHaveLength(2)
  })

  test("待协调预约可一键开始协调并刷新队列", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true
            }
          })
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.fetchBookings = jest.fn()

    page.handleQuickCoordination({
      currentTarget: {
        dataset: {
          id: "booking_1",
          schedulePriority: "priority",
          coordinationStatus: "pending"
        }
      }
    })

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingUpdateCoordination",
      data: {
        id: "booking_1",
        schedulePriority: "priority",
        coordinationStatus: "coordinating"
      },
      success: expect.any(Function),
      fail: expect.any(Function)
    })
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "已开始协调",
      icon: "success"
    })
    expect(page.fetchBookings).toHaveBeenCalled()
    expect(page.data.updatingId).toBe("")
  })

  test("协调中的预约确认后可标记为已协调", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true
            }
          })
        })
      },
      showModal: jest.fn(({ success }) => {
        success({
          confirm: true
        })
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition())
    page.fetchBookings = jest.fn()

    page.handleQuickCoordination({
      currentTarget: {
        dataset: {
          id: "booking_2",
          schedulePriority: "normal",
          coordinationStatus: "coordinating"
        }
      }
    })

    expect(global.wx.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "确认完成协调？",
        content: "完成后，该预约将从待协调队列中移除。",
        confirmText: "确认完成",
        success: expect.any(Function),
        fail: expect.any(Function)
      })
    )
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "bookingUpdateCoordination",
        data: {
          id: "booking_2",
          schedulePriority: "normal",
          coordinationStatus: "resolved"
        }
      })
    )
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "已标记为已协调",
      icon: "success"
    })
    expect(page.fetchBookings).toHaveBeenCalled()
  })
})
