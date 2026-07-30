const { requirePagePermission } = require("../../shared/pageAuth")
const { buildBookingWorkbench } = require("../../shared/bookingWorkbench")

const STATUS_LABELS = {
  pending: "待联系",
  contacted: "已联系"
}

const FILTER_OPTIONS = [
  { key: "todo", label: "全部待办" },
  { key: "pending", label: "待启动" },
  { key: "coordinating", label: "协调中" },
  { key: "priority", label: "优先" },
  { key: "overdue", label: "超时" },
  { key: "standby", label: "候补" }
]

function normalizePhone(value) {
  const phone = String(value || "").trim()
  const digitCount = phone.replace(/\D/g, "").length
  if (!/^\+?[0-9-]{6,20}$/.test(phone) || digitCount < 6 || digitCount > 15) {
    return ""
  }
  return phone
}

function formatQueueItem(item) {
  return {
    ...item,
    vehicleName: item.vehicleName || "车辆预约",
    userName: item.userName || "未填写姓名",
    phone: item.phone || "",
    city: item.city || "未填写城市",
    startDate: item.startDate || "--",
    endDate: item.endDate || "--",
    statusLabel: STATUS_LABELS[item.status] || "待处理",
    statusClass: `status-${item.status || "pending"}`
  }
}

function filterQueueByKeyword(queue, keyword) {
  const tokens = String(keyword || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (!tokens.length) {
    return queue
  }

  return queue.filter((item) => {
    const searchableFields = [
      item.id,
      item.vehicleName,
      item.userName,
      item.phone,
      item.city
    ].map((value) => String(value || "").toLowerCase())

    return tokens.every((token) =>
      searchableFields.some((field) => field.includes(token))
    )
  })
}

Page({
  data: {
    pageAuthorized: false,
    loading: true,
    refreshing: false,
    loadError: "",
    selectedMode: "todo",
    allBookings: [],
    queue: [],
    filterOptions: FILTER_OPTIONS,
    summary: {
      todo: 0,
      pending: 0,
      priority: 0,
      overdue: 0,
      standby: 0,
      coordinating: 0
    },
    truncated: false,
    updatingId: "",
    keyword: "",
    queueTotal: 0
  },

  onLoad() {
    requirePagePermission(this, {
      required: "canManageBookings",
      noPermissionMessage: "无权访问待协调工作台",
      onAuthorized: () => this.fetchBookings()
    })
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchBookings(() => wx.stopPullDownRefresh())
  },

  onShow() {
    if (this.data.pageAuthorized && this.data.allBookings.length) {
      this.fetchBookings()
    }
  },

  applyWorkbench(mode) {
    const view = buildBookingWorkbench(
      this.data.allBookings,
      mode || this.data.selectedMode,
      Date.now()
    )
    const filterOptions = FILTER_OPTIONS.map((item) => ({
      ...item,
      count: Number(view.summary[item.key]) || 0
    }))
    const formattedQueue = view.queue.map(formatQueueItem)
    this.setData({
      selectedMode: view.mode,
      queue: filterQueueByKeyword(formattedQueue, this.data.keyword),
      queueTotal: formattedQueue.length,
      summary: view.summary,
      filterOptions
    })
  },

  handleKeywordInput(event) {
    this.setData({
      keyword: String(event.detail.value || "").slice(0, 40)
    })
    this.applyWorkbench()
  },

  handleClearKeyword() {
    if (!this.data.keyword) {
      return
    }
    this.setData({
      keyword: ""
    })
    this.applyWorkbench()
  },

  handleFilterTap(event) {
    const mode = String(event.currentTarget.dataset.mode || "")
    if (!mode || mode === this.data.selectedMode) {
      return
    }
    this.applyWorkbench(mode)
  },

  handleSummaryTap(event) {
    const mode = String(event.currentTarget.dataset.mode || "")
    if (!mode) {
      return
    }
    this.applyWorkbench(mode)
  },

  handleViewDetail(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (!id) {
      return
    }
    wx.navigateTo({
      url: `/pages/booking-manage-detail/booking-manage-detail?id=${id}`
    })
  },

  handleCallPhone(event) {
    const phone = normalizePhone(event.currentTarget.dataset.phone)
    if (!phone) {
      wx.showToast({
        title: "手机号不可用",
        icon: "none"
      })
      return
    }
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: (error) => {
        const message = error && (error.errMsg || error.message)
        if (!message || !String(message).includes("cancel")) {
          wx.showToast({
            title: "拨号失败，请进入详情复制",
            icon: "none"
          })
        }
      }
    })
  },

  handleQuickCoordination(event) {
    const dataset = event.currentTarget.dataset || {}
    const id = String(dataset.id || "").trim()
    const currentStatus = String(dataset.coordinationStatus || "pending")
    const schedulePriority = String(dataset.schedulePriority || "normal")
    const nextStatus =
      currentStatus === "pending"
        ? "coordinating"
        : currentStatus === "coordinating"
          ? "resolved"
          : ""

    if (!id || !nextStatus || this.data.updatingId) {
      return
    }

    const update = () => {
      this.updateCoordination({
        id,
        schedulePriority,
        coordinationStatus: nextStatus
      })
    }

    if (nextStatus === "resolved") {
      this.setData({
        updatingId: id
      })
      wx.showModal({
        title: "确认完成协调？",
        content: "完成后，该预约将从待协调队列中移除。",
        confirmText: "确认完成",
        success: (res) => {
          if (res.confirm) {
            update()
            return
          }
          this.setData({
            updatingId: ""
          })
        },
        fail: () => {
          this.setData({
            updatingId: ""
          })
        }
      })
      return
    }

    update()
  },

  updateCoordination(payload) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        updatingId: ""
      })
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({
      updatingId: payload.id
    })
    wx.cloud.callFunction({
      name: "bookingUpdateCoordination",
      data: payload,
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            updatingId: ""
          })
          wx.showToast({
            title: (result && result.message) || "协调状态更新失败",
            icon: "none"
          })
          return
        }
        this.setData({
          updatingId: ""
        })
        wx.showToast({
          title: payload.coordinationStatus === "resolved" ? "已标记为已协调" : "已开始协调",
          icon: "success"
        })
        this.fetchBookings()
      },
      fail: (error) => {
        this.setData({
          updatingId: ""
        })
        wx.showToast({
          title:
            (error && (error.errMsg || error.message)) || "协调状态更新失败",
          icon: "none"
        })
      }
    })
  },

  handleOpenBookingManage() {
    wx.navigateTo({
      url: "/pages/booking-manage/booking-manage"
    })
  },

  handleRetry() {
    this.fetchBookings()
  },

  fetchBookings(done) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        refreshing: false,
        loadError: "云能力未初始化"
      })
      if (typeof done === "function") {
        done()
      }
      return
    }

    this.setData({
      loading: !this.data.allBookings.length,
      refreshing: Boolean(this.data.allBookings.length),
      loadError: ""
    })
    wx.cloud.callFunction({
      name: "bookingList",
      data: {
        status: "all",
        limit: 2000
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            loading: false,
            refreshing: false,
            loadError: (result && result.message) || "待协调预约加载失败"
          })
          return
        }
        this.setData({
          loading: false,
          refreshing: false,
          allBookings: Array.isArray(result.list) ? result.list : [],
          truncated: Boolean(result.truncated)
        })
        this.applyWorkbench()
      },
      fail: (error) => {
        this.setData({
          loading: false,
          refreshing: false,
          loadError:
            (error && (error.errMsg || error.message)) || "待协调预约加载失败"
        })
      },
      complete: () => {
        if (typeof done === "function") {
          done()
        }
      }
    })
  }
})
