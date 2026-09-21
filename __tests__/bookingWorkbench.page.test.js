const fs = require("fs")
const path = require("path")

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
    jest.useRealTimers()
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
    expect(page.data.lastSyncedText).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
  })

  test("列表请求超时后结束刷新并忽略迟到结果", () => {
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
      allBookings: [{ id: "existing_booking" }]
    })
    const done = jest.fn()

    page.fetchBookings(done)
    jest.advanceTimersByTime(15 * 1000)

    expect(page.data.loading).toBe(false)
    expect(page.data.refreshing).toBe(false)
    expect(page.data.loadError).toBe("待协调预约加载超时，请检查网络后重试")
    expect(done).toHaveBeenCalledTimes(1)

    requestOptions.success({
      result: {
        ok: true,
        list: [{ id: "late_booking" }]
      }
    })
    expect(page.data.allBookings).toEqual([{ id: "existing_booking" }])
  })

  test("新列表请求覆盖旧请求并保留最新队列", () => {
    const requests = []
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      }
    }
    const page = createPage(loadPageDefinition())
    const firstDone = jest.fn()

    page.fetchBookings(firstDone)
    page.fetchBookings()
    requests[1].success({
      result: {
        ok: true,
        list: [{ id: "latest_booking", status: "pending" }]
      }
    })
    requests[0].success({
      result: {
        ok: true,
        list: [{ id: "stale_booking", status: "pending" }]
      }
    })

    expect(firstDone).toHaveBeenCalledTimes(1)
    expect(page.data.allBookings[0].id).toBe("latest_booking")
  })

  test("支持切换队列、拨号和进入预约详情", () => {
    global.wx = {
      makePhoneCall: jest.fn(),
      navigateTo: jest.fn(),
      setClipboardData: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
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
    page.handleCopyPhone({
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
    expect(global.wx.setClipboardData).toHaveBeenCalledWith({
      data: "13800000000",
      success: expect.any(Function),
      fail: expect.any(Function)
    })
    expect(global.wx.navigateTo).toHaveBeenCalledWith(expect.objectContaining({
      url: "/pages/booking-manage-detail/booking-manage-detail?id=booking_1",
      fail: expect.any(Function)
    }))
  })

  test("ignores phone and clipboard callbacks after the workbench unloads", () => {
    let phoneOptions
    let clipboardOptions
    global.wx = {
      makePhoneCall: jest.fn((options) => {
        phoneOptions = options
      }),
      setClipboardData: jest.fn((options) => {
        clipboardOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), { loading: false })
    const event = { currentTarget: { dataset: { phone: "13800000000" } } }

    page.handleCallPhone(event)
    page.handleCopyPhone(event)
    page.onUnload()
    phoneOptions.fail(new Error("phone failed"))
    clipboardOptions.success()
    clipboardOptions.fail(new Error("copy failed"))

    expect(global.wx.showToast).not.toHaveBeenCalled()
  })

  test("支持按多个字段本地搜索并清空关键词", () => {
    const page = createPage(loadPageDefinition(), {
      loading: false,
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
          adminRemark: "客户希望周五回电",
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

    page.handleKeywordInput({
      detail: {
        value: "周五回电"
      }
    })
    expect(page.data.queue.map((item) => item.id)).toEqual([
      "booking_hangzhou"
    ])
  })

  test("支持手动刷新并在同步过程中阻止重复请求", () => {
    const page = createPage(loadPageDefinition(), {
      pageAuthorized: true,
      loading: false,
      refreshing: false
    })
    page.fetchBookings = jest.fn()

    page.handleManualRefresh()
    page.data.refreshing = true
    page.handleManualRefresh()

    expect(page.fetchBookings).toHaveBeenCalledTimes(1)
  })

  test("手机号缺失时显示异常状态并阻止复制", () => {
    global.wx = {
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      allBookings: [
        {
          id: "booking_without_phone",
          status: "pending",
          coordinationStatus: "pending",
          phone: "invalid"
        }
      ]
    })

    page.applyWorkbench()
    page.handleCopyPhone({
      currentTarget: {
        dataset: {
          phone: "invalid"
        }
      }
    })

    expect(page.data.queue[0].phoneAvailable).toBe(false)
    expect(page.data.queue[0].phoneDisplay).toBe("手机号待补充")
    expect(page.data.summary.contactIssue).toBe(1)
    page.handleFilterTap({
      currentTarget: {
        dataset: {
          mode: "contactIssue"
        }
      }
    })
    expect(page.data.queue.map((item) => item.id)).toEqual([
      "booking_without_phone"
    ])
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "手机号不可用",
      icon: "none"
    })
  })

  test("支持按智能优先、等待时间和用车日期切换排序", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-01T00:00:00.000Z"))
    const page = createPage(loadPageDefinition(), {
      allBookings: [
        {
          id: "priority_newer",
          startDate: "2026-08-20",
          status: "pending",
          schedulePriority: "priority",
          coordinationStatus: "pending",
          createdAt: "2026-01-03T00:00:00.000Z"
        },
        {
          id: "oldest",
          startDate: "2026-08-25",
          status: "pending",
          schedulePriority: "normal",
          coordinationStatus: "pending",
          createdAt: "2026-01-01T00:00:00.000Z"
        },
        {
          id: "pickup_first",
          startDate: "2026-08-10",
          status: "pending",
          schedulePriority: "normal",
          coordinationStatus: "pending",
          createdAt: "2026-01-02T00:00:00.000Z"
        }
      ]
    })

    page.applyWorkbench()
    expect(page.data.queue[0].id).toBe("priority_newer")

    page.handleSortTap({
      currentTarget: {
        dataset: {
          sort: "waiting"
        }
      }
    })
    expect(page.data.queue[0].id).toBe("oldest")
    expect(page.data.sortHint).toBe("按提交时间从早到晚排列")

    page.handleSortTap({
      currentTarget: {
        dataset: {
          sort: "pickup"
        }
      }
    })
    expect(page.data.queue[0].id).toBe("pickup_first")
    expect(page.data.selectedSort).toBe("pickup")
  })

  test("存在筛选、搜索或排序条件时可一键重置视图", () => {
    const page = createPage(loadPageDefinition(), {
      allBookings: [
        {
          id: "booking_reset",
          userName: "测试客户",
          status: "pending",
          coordinationStatus: "pending"
        }
      ]
    })

    page.handleKeywordInput({
      detail: {
        value: "测试客户"
      }
    })
    page.handleSortTap({
      currentTarget: {
        dataset: {
          sort: "waiting"
        }
      }
    })
    page.handleFilterTap({
      currentTarget: {
        dataset: {
          mode: "pending"
        }
      }
    })

    expect(page.data.viewCustomized).toBe(true)

    page.handleResetView()

    expect(page.data.keyword).toBe("")
    expect(page.data.selectedSort).toBe("smart")
    expect(page.data.selectedMode).toBe("todo")
    expect(page.data.viewCustomized).toBe(false)
    expect(page.data.queue).toHaveLength(1)
  })

  test("工作台排序偏好支持本地持久化与启动恢复", () => {
    const storage = {}
    global.wx = {
      getStorageSync: jest.fn((key) => storage[key] || ""),
      setStorageSync: jest.fn((key, value) => {
        storage[key] = value
      })
    }

    const page = createPage(loadPageDefinition(), {
      allBookings: [
        {
          id: "booking_1",
          startDate: "2026-10-01",
          createdTimestamp: 1000,
          status: "pending",
          coordinationStatus: "pending"
        },
        {
          id: "booking_2",
          startDate: "2026-09-20",
          createdTimestamp: 2000,
          status: "pending",
          coordinationStatus: "pending"
        }
      ]
    })

    // 1. 切换排序为 pickup 时写入存储
    page.handleSortTap({
      currentTarget: {
        dataset: {
          sort: "pickup"
        }
      }
    })
    expect(global.wx.setStorageSync).toHaveBeenCalledWith("workbench_sort_preference", "pickup")
    expect(storage.workbench_sort_preference).toBe("pickup")

    // 2. 模拟下次打开页面，restoreSortPreference 从本地存储恢复偏好
    const freshPage = createPage(loadPageDefinition())
    freshPage.restoreSortPreference()
    expect(freshPage.data.selectedSort).toBe("pickup")
    expect(freshPage.data.sortHint).toBe("按预计用车日期从近到远排列")
    expect(freshPage.data.viewCustomized).toBe(true)

    // 3. 一键重置视图后将存储恢复为 smart
    freshPage.handleResetView()
    expect(global.wx.setStorageSync).toHaveBeenCalledWith("workbench_sort_preference", "smart")
    expect(storage.workbench_sort_preference).toBe("smart")
    expect(freshPage.data.selectedSort).toBe("smart")
    expect(freshPage.data.viewCustomized).toBe(false)
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
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false
    })
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

  test("协调更新超时后解锁操作并忽略迟到回调", () => {
    jest.useFakeTimers()
    let requestOptions = null
    global.wx = {
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false
    })
    page.fetchBookings = jest.fn()
    const event = {
      currentTarget: {
        dataset: {
          id: "booking_timeout",
          schedulePriority: "normal",
          coordinationStatus: "pending"
        }
      }
    }

    page.handleQuickCoordination(event)
    page.handleQuickCoordination(event)
    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(20 * 1000)
    expect(page.data.updatingId).toBe("")
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "协调更新超时，请重试",
      icon: "none"
    })

    requestOptions.success({ result: { ok: true } })
    expect(page.fetchBookings).not.toHaveBeenCalled()
  })

  test("可在工作台快速调整优先级并刷新重排", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              changed: true
            }
          })
        })
      },
      showActionSheet: jest.fn(({ success }) => {
        success({
          tapIndex: 0
        })
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false
    })
    page.fetchBookings = jest.fn()

    page.handlePriorityTap({
      currentTarget: {
        dataset: {
          id: "booking_priority",
          schedulePriority: "normal",
          coordinationStatus: "pending"
        }
      }
    })

    expect(global.wx.showActionSheet).toHaveBeenCalledWith({
      alertText: "调整预约优先级",
      itemList: ["优先", "常规", "候补"],
      itemColor: "#528fff",
      success: expect.any(Function)
    })
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingUpdateCoordination",
      data: {
        id: "booking_priority",
        schedulePriority: "priority",
        coordinationStatus: "pending"
      },
      success: expect.any(Function),
      fail: expect.any(Function)
    })
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "优先级已更新",
      icon: "success"
    })
    expect(page.fetchBookings).toHaveBeenCalled()
  })

  test("可在队列卡片内编辑并保存内部备注", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              adminRemark: "客户希望周五回电"
            }
          })
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false,
      allBookings: [
        {
          id: "booking_remark",
          adminRemark: "原备注"
        }
      ]
    })
    page.fetchBookings = jest.fn()

    page.handleOpenRemark({
      currentTarget: {
        dataset: {
          id: "booking_remark",
          remark: "原备注"
        }
      }
    })
    page.handleRemarkInput({
      detail: {
        value: "  客户希望周五回电  "
      }
    })
    page.handleSaveRemark()

    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingUpdateAdminRemark",
      data: {
        id: "booking_remark",
        adminRemark: "客户希望周五回电"
      },
      success: expect.any(Function),
      fail: expect.any(Function)
    })
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "内部备注已保存",
      icon: "success"
    })
    expect(page.data.editingRemarkId).toBe("")
    expect(page.data.savingRemark).toBe(false)
    expect(page.fetchBookings).toHaveBeenCalled()
  })

  test("内部备注同步异常时立即结束保存状态", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("cloud down")
        })
      },
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false,
      editingRemarkId: "booking_remark_error",
      remarkDraft: "新备注",
      allBookings: [
        {
          id: "booking_remark_error",
          adminRemark: "旧备注"
        }
      ]
    })

    expect(() => page.handleSaveRemark()).not.toThrow()
    expect(page.data.savingRemark).toBe(false)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "cloud down",
      icon: "none"
    })
  })

  test("待联系预约确认后可标记已联系并反馈提醒结果", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              status: "contacted",
              notificationStatus: "sent"
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
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false
    })
    page.fetchBookings = jest.fn()

    page.handleMarkContacted({
      currentTarget: {
        dataset: {
          id: "booking_contact",
          status: "pending"
        }
      }
    })

    expect(global.wx.showModal).toHaveBeenCalledWith({
      title: "确认已联系客户？",
      content: "预约将更新为「已联系」；如客户已订阅，系统会发送状态提醒。",
      confirmText: "确认更新",
      confirmColor: "#528fff",
      success: expect.any(Function),
      fail: expect.any(Function)
    })
    expect(global.wx.cloud.callFunction).toHaveBeenCalledWith({
      name: "bookingUpdateStatus",
      data: {
        id: "booking_contact",
        status: "contacted"
      },
      success: expect.any(Function),
      fail: expect.any(Function)
    })
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "已联系，提醒已发送",
      icon: "none"
    })
    expect(page.fetchBookings).toHaveBeenCalled()
    expect(page.data.statusUpdatingId).toBe("")
  })

  test("客户状态更新成功但提醒失败时给出明确反馈", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              status: "contacted",
              notificationStatus: "failed"
            }
          })
        })
      },
      showModal: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false
    })
    page.fetchBookings = jest.fn()

    page.updateContactedStatus("booking_notify_failed")

    expect(global.wx.showModal).toHaveBeenCalledWith({
      title: "状态已更新",
      content: "客户状态已更新，但提醒发送失败。可在错误日志中查看原因。",
      confirmText: "知道了",
      confirmColor: "#528fff",
      showCancel: false,
      complete: expect.any(Function)
    })
    expect(global.wx.showToast).not.toHaveBeenCalled()
    expect(page.data.statusUpdatingId).toBe("booking_notify_failed")
    page.updateContactedStatus("booking_second")
    expect(global.wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    global.wx.showModal.mock.calls[0][0].complete()
    global.wx.showModal.mock.calls[0][0].complete()
    expect(page.fetchBookings).toHaveBeenCalledTimes(1)
    expect(page.data.statusUpdatingId).toBe("")
  })

  test("离开工作台后不再执行提醒弹窗的迟到刷新", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn(({ success }) => {
          success({
            result: {
              ok: true,
              notificationStatus: "failed"
            }
          })
        })
      },
      showModal: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false
    })
    page.fetchBookings = jest.fn()

    page.updateContactedStatus("booking_unloaded")
    page.onUnload()
    global.wx.showModal.mock.calls[0][0].complete()
    global.wx.showModal.mock.calls[0][0].complete()

    expect(page.fetchBookings).not.toHaveBeenCalled()
  })

  test("列表刷新期间所有写入口都拒绝旧记录操作", () => {
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showActionSheet: jest.fn(),
      showModal: jest.fn(),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: true,
      editingRemarkId: "booking_refresh",
      remarkDraft: "刷新期间的旧备注",
      allBookings: [
        {
          id: "booking_refresh",
          adminRemark: "原备注"
        }
      ]
    })

    page.handlePriorityTap({
      currentTarget: {
        dataset: {
          id: "booking_refresh",
          schedulePriority: "normal",
          coordinationStatus: "pending"
        }
      }
    })
    page.handleMarkContacted({
      currentTarget: {
        dataset: { id: "booking_refresh", status: "pending" }
      }
    })
    page.handleQuickCoordination({
      currentTarget: {
        dataset: {
          id: "booking_refresh",
          schedulePriority: "normal",
          coordinationStatus: "pending"
        }
      }
    })
    page.handleSaveRemark()
    page.updateContactedStatus("booking_refresh")
    page.updateCoordination({
      id: "booking_refresh",
      schedulePriority: "priority",
      coordinationStatus: "coordinating"
    })

    expect(global.wx.showActionSheet).not.toHaveBeenCalled()
    expect(global.wx.showModal).not.toHaveBeenCalled()
    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(page.data.savingRemark).toBe(false)
    expect(page.data.statusUpdatingId).toBe("")
    expect(page.data.updatingId).toBe("")
  })

  test("优先级选择器在刷新开始后返回时不更新旧记录", () => {
    let actionSheetOptions = null
    global.wx = {
      cloud: {
        callFunction: jest.fn()
      },
      showActionSheet: jest.fn((options) => {
        actionSheetOptions = options
      }),
      showToast: jest.fn()
    }
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false
    })

    page.handlePriorityTap({
      currentTarget: {
        dataset: {
          id: "booking_stale_priority",
          schedulePriority: "normal",
          coordinationStatus: "pending"
        }
      }
    })
    page.setData({ refreshing: true })
    actionSheetOptions.success({ tapIndex: 0 })

    expect(global.wx.cloud.callFunction).not.toHaveBeenCalled()
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
    const page = createPage(loadPageDefinition(), {
      loading: false,
      refreshing: false
    })
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
        confirmColor: "#528fff",
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

  test("工作台队列使用原生业务图标与日期路线组件", () => {
    const pageDir = path.resolve(__dirname, "../pages/booking-workbench")
    const wxml = fs.readFileSync(path.join(pageDir, "booking-workbench.wxml"), "utf8")
    const wxss = fs.readFileSync(path.join(pageDir, "booking-workbench.wxss"), "utf8")

    expect(wxml).toContain("summary-native-icon-todo")
    expect(wxml).toContain("summary-native-icon-priority")
    expect(wxml).toContain("summary-card-active-primary")
    expect(wxml).toContain("summary-card-active-warning")
    expect(wxml).toContain("summary-card-active-danger")
    expect(wxml).toContain("summary-card-active-muted")
    expect(wxml).not.toContain("summary-card summary-card-main")
    expect(wxml).toContain('hover-class="summary-card-pressed"')
    expect(wxml).toContain('hover-class="stage-item-pressed"')
    expect(wxml).toContain('aria-pressed="{{selectedMode === item.key}}"')
    expect(wxml).toContain('scroll-into-view="workbench-filter-{{selectedMode}}"')
    expect(wxml).toContain('id="workbench-filter-{{item.key}}"')
    expect(wxml).toContain('aria-pressed="{{selectedSort === item.key}}"')
    expect(wxml).toContain('class="workbench-skeleton"')
    expect(wxml).toContain("workbench-skeleton-summary-grid")
    expect(wxml).toContain("workbench-skeleton-stage-row")
    expect(wxml).toContain("workbench-skeleton-booking")
    expect(wxml).not.toContain('class="state-loader"')
    expect(wxml).toContain("queue-vehicle-icon")
    expect(wxml).toContain("phone-copy-native-icon")
    expect(wxml).toContain("workbench-inline-pressed")
    expect(wxml).toContain('aria-disabled="{{!item.phoneAvailable}}"')
    expect(wxml).toContain('aria-label="编辑 {{item.userName}} 的内部备注"')
    expect(wxml).toContain("date-route-chevron")
    expect(wxml).toContain("remark-add-native-icon")
    expect(wxml).toContain("coordination-native-icon")
    expect(wxml).toContain("queue-call-native-icon")
    expect(wxml).toContain("queue-detail-native-icon")
    expect(wxml).toContain("manage-native-icon")
    expect(wxml).toContain("reset-view-native-icon")
    expect(wxml).toContain("inline-error-native-icon")
    expect(wxml).toContain('aria-label="清除工作台筛选与排序"')
    expect(wxml).toContain('class="reset-view" aria-role="button"')
    expect(wxml).toContain('hover-class="reset-view-pressed"')
    expect(wxml).toContain("status-pill-pressed")
    expect(wxml).not.toContain("{{item.startDate}} → {{item.endDate}}")
    expect(wxml).not.toContain("＋ 添加内部备注")
    expect(wxss).toContain(".date-route")
    expect(wxss).toContain(".remark-save-native-icon")
    expect(wxss).toContain(".scope-tip-with-icon")
    expect(wxss).toContain(".reset-view-native-icon")
    expect(wxss).toContain(".reset-view-pressed")
    expect(wxss).toContain(".status-pill-pressed")
    expect(wxss).toContain(".workbench-skeleton-summary")
    expect(wxss).toContain(".workbench-skeleton-queue")
    expect(wxss).toContain(".inline-error-native-mark")
    expect(wxss).toContain(".summary-card-active-warning")
    expect(wxss).toContain(".summary-card-pressed")
    expect(wxss).toContain(".workbench-inline-pressed")
    expect(wxml).toContain("workbench-button-pressed")
    expect(wxss).toContain(".workbench-button-pressed")
    expect(wxml).toContain('bindconfirm="handleKeywordConfirm"')
  })

  test("工作台搜索框软键盘确认 handleKeywordConfirm 立即触发过滤", () => {
    const page = createPage(loadPageDefinition(), {
      allBookings: [
        { id: "b1", vehicleName: "保时捷 911", userName: "张三", phone: "13800000001", status: "pending" },
        { id: "b2", vehicleName: "法拉利 F8", userName: "李四", phone: "13800000002", status: "pending" }
      ]
    })
    page.handleKeywordConfirm({ detail: { value: "保时捷" } })
    expect(page.data.keyword).toBe("保时捷")
    expect(page.data.queue.length).toBe(1)
    expect(page.data.queue[0].vehicleName).toBe("保时捷 911")
  })
})
