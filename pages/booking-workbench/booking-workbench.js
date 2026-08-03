const { requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  buildBookingWorkbench,
  normalizeUsablePhone
} = require("../../shared/bookingWorkbench")

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
  { key: "pickupAttention", label: "用车提醒" },
  { key: "contactIssue", label: "号码异常" },
  { key: "standby", label: "候补" }
]

const SORT_OPTIONS = [
  { key: "smart", label: "智能排序", hint: "优先处理超时、临近用车、号码异常与高优先级预约" },
  { key: "waiting", label: "等待最久", hint: "按提交时间从早到晚排列" },
  { key: "pickup", label: "用车日期", hint: "按预计用车日期从近到远排列" }
]

const PRIORITY_OPTIONS = [
  { key: "priority", label: "优先" },
  { key: "normal", label: "常规" },
  { key: "standby", label: "候补" }
]

function formatSyncTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")
  const second = `${date.getSeconds()}`.padStart(2, "0")
  return `${month}-${day} ${hour}:${minute}:${second}`
}

function formatQueueItem(item) {
  const priority =
    PRIORITY_OPTIONS.find((option) => option.key === item.schedulePriority) ||
    PRIORITY_OPTIONS[1]
  const normalizedPhone = normalizeUsablePhone(item.phone)
  return {
    ...item,
    vehicleName: item.vehicleName || "车辆预约",
    userName: item.userName || "未填写姓名",
    phone: item.phone || "",
    phoneDisplay: normalizedPhone || "手机号待补充",
    phoneAvailable: Boolean(normalizedPhone),
    city: item.city || "未填写城市",
    startDate: item.startDate || "—",
    endDate: item.endDate || "—",
    adminRemark: String(item.adminRemark || "").trim(),
    priorityLabel: priority.label,
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
      item.city,
      item.adminRemark
    ].map((value) => String(value || "").toLowerCase())

    return tokens.every((token) =>
      searchableFields.some((field) => field.includes(token))
    )
  })
}

function getPickupTimestamp(value) {
  const date = String(value || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Number.MAX_SAFE_INTEGER
  }
  const timestamp = new Date(`${date}T00:00:00.000Z`).getTime()
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
}

function sortQueue(queue, mode) {
  if (mode === "smart") {
    return queue
  }

  return queue
    .map((item, index) => ({
      item,
      index
    }))
    .sort((left, right) => {
      if (mode === "waiting") {
        const leftTime = left.item.createdTimestamp || Number.MAX_SAFE_INTEGER
        const rightTime = right.item.createdTimestamp || Number.MAX_SAFE_INTEGER
        return leftTime - rightTime || left.index - right.index
      }

      const pickupDifference =
        getPickupTimestamp(left.item.startDate) -
        getPickupTimestamp(right.item.startDate)
      if (pickupDifference) {
        return pickupDifference
      }
      const leftTime = left.item.createdTimestamp || Number.MAX_SAFE_INTEGER
      const rightTime = right.item.createdTimestamp || Number.MAX_SAFE_INTEGER
      return leftTime - rightTime || left.index - right.index
    })
    .map((entry) => entry.item)
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
    sortOptions: SORT_OPTIONS,
    summary: {
      todo: 0,
      pending: 0,
      priority: 0,
      overdue: 0,
      pickupAttention: 0,
      contactIssue: 0,
      standby: 0,
      coordinating: 0
    },
    truncated: false,
    updatingId: "",
    keyword: "",
    queueTotal: 0,
    selectedSort: "smart",
    sortHint: SORT_OPTIONS[0].hint,
    editingRemarkId: "",
    remarkDraft: "",
    savingRemark: false,
    statusUpdatingId: "",
    lastSyncedText: "",
    viewCustomized: false
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
    const formattedQueue = sortQueue(
      view.queue.map(formatQueueItem),
      this.data.selectedSort
    )
    this.setData({
      selectedMode: view.mode,
      queue: filterQueueByKeyword(formattedQueue, this.data.keyword),
      queueTotal: formattedQueue.length,
      summary: view.summary,
      filterOptions,
      viewCustomized: Boolean(
        view.mode !== "todo" ||
        String(this.data.keyword || "").trim() ||
        this.data.selectedSort !== "smart"
      )
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

  handleManualRefresh() {
    if (
      !this.data.pageAuthorized ||
      this.data.loading ||
      this.data.refreshing ||
      this.data.updatingId ||
      this.data.savingRemark ||
      this.data.statusUpdatingId
    ) {
      return
    }
    this.fetchBookings()
  },

  handleResetView() {
    if (!this.data.viewCustomized) {
      return
    }
    this.setData({
      keyword: "",
      selectedSort: "smart",
      sortHint: SORT_OPTIONS[0].hint
    })
    this.applyWorkbench("todo")
  },

  handleSortTap(event) {
    const selectedSort = String(event.currentTarget.dataset.sort || "")
    const option = SORT_OPTIONS.find((item) => item.key === selectedSort)
    if (!option || selectedSort === this.data.selectedSort) {
      return
    }
    this.setData({
      selectedSort,
      sortHint: option.hint
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
      url: `/pages/booking-manage-detail/booking-manage-detail?id=${id}`,
      fail: () => {
        wx.showToast({
          title: "预约详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleCallPhone(event) {
    const phone = normalizeUsablePhone(event.currentTarget.dataset.phone)
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
            title: "拨号失败，可复制号码",
            icon: "none"
          })
        }
      }
    })
  },

  handleCopyPhone(event) {
    const phone = normalizeUsablePhone(event.currentTarget.dataset.phone)
    if (!phone) {
      wx.showToast({
        title: "手机号不可用",
        icon: "none"
      })
      return
    }
    if (typeof wx.setClipboardData !== "function") {
      wx.showToast({
        title: "当前版本不支持复制",
        icon: "none"
      })
      return
    }
    wx.setClipboardData({
      data: phone,
      success: () => {
        wx.showToast({
          title: "手机号已复制",
          icon: "none"
        })
      },
      fail: () => {
        wx.showToast({
          title: "手机号复制失败",
          icon: "none"
        })
      }
    })
  },

  handlePriorityTap(event) {
    const dataset = event.currentTarget.dataset || {}
    const id = String(dataset.id || "").trim()
    const currentPriority = String(dataset.schedulePriority || "normal")
    const coordinationStatus = String(dataset.coordinationStatus || "pending")
    if (
      !id ||
      this.data.updatingId ||
      this.data.savingRemark ||
      this.data.statusUpdatingId
    ) {
      return
    }

    wx.showActionSheet({
      alertText: "调整预约优先级",
      itemList: PRIORITY_OPTIONS.map((item) => item.label),
      itemColor: "#528fff",
      success: (res) => {
        const option = PRIORITY_OPTIONS[Number(res.tapIndex)]
        if (!option) {
          return
        }
        if (option.key === currentPriority) {
          wx.showToast({
            title: `当前已是${option.label}`,
            icon: "none"
          })
          return
        }
        this.updateCoordination(
          {
            id,
            schedulePriority: option.key,
            coordinationStatus
          },
          "优先级已更新"
        )
      }
    })
  },

  handleOpenRemark(event) {
    const dataset = event.currentTarget.dataset || {}
    const id = String(dataset.id || "").trim()
    if (
      !id ||
      this.data.updatingId ||
      this.data.savingRemark ||
      this.data.statusUpdatingId
    ) {
      return
    }
    this.setData({
      editingRemarkId: id,
      remarkDraft: String(dataset.remark || "").slice(0, 200)
    })
  },

  handleRemarkInput(event) {
    this.setData({
      remarkDraft: String(event.detail.value || "").slice(0, 200)
    })
  },

  handleCancelRemark() {
    if (this.data.savingRemark) {
      return
    }
    this.setData({
      editingRemarkId: "",
      remarkDraft: ""
    })
  },

  handleSaveRemark() {
    const id = String(this.data.editingRemarkId || "").trim()
    const adminRemark = String(this.data.remarkDraft || "").trim()
    if (
      !id ||
      this.data.savingRemark ||
      this.data.updatingId ||
      this.data.statusUpdatingId
    ) {
      return
    }
    const current = this.data.allBookings.find(
      (item) => String(item.id || item._id || "").trim() === id
    )
    if (String((current && current.adminRemark) || "").trim() === adminRemark) {
      this.setData({
        editingRemarkId: "",
        remarkDraft: ""
      })
      wx.showToast({
        title: "备注未发生变化",
        icon: "none"
      })
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({
      savingRemark: true
    })
    wx.cloud.callFunction({
      name: "bookingUpdateAdminRemark",
      data: {
        id,
        adminRemark
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            savingRemark: false
          })
          wx.showToast({
          title: formatToastTitle(result && result.message, "备注保存失败"),
            icon: "none"
          })
          return
        }
        this.setData({
          editingRemarkId: "",
          remarkDraft: "",
          savingRemark: false
        })
        wx.showToast({
          title: adminRemark ? "内部备注已保存" : "内部备注已清空",
          icon: "success"
        })
        this.fetchBookings()
      },
      fail: (error) => {
        this.setData({
          savingRemark: false
        })
        wx.showToast({
          title: "内部备注保存失败",
          icon: "none"
        })
      }
    })
  },

  handleMarkContacted(event) {
    const dataset = event.currentTarget.dataset || {}
    const id = String(dataset.id || "").trim()
    const status = String(dataset.status || "")
    if (
      !id ||
      status !== "pending" ||
      this.data.statusUpdatingId ||
      this.data.updatingId ||
      this.data.savingRemark
    ) {
      return
    }

    this.setData({
      statusUpdatingId: id
    })
    wx.showModal({
      title: "确认已联系客户？",
      content: "预约将更新为「已联系」；如客户已订阅，系统会发送状态提醒。",
      confirmText: "确认更新",
      confirmColor: "#528fff",
      success: (res) => {
        if (res.confirm) {
          this.updateContactedStatus(id)
          return
        }
        this.setData({
          statusUpdatingId: ""
        })
      },
      fail: () => {
        this.setData({
          statusUpdatingId: ""
        })
      }
    })
  },

  updateContactedStatus(id) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        statusUpdatingId: ""
      })
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    wx.cloud.callFunction({
      name: "bookingUpdateStatus",
      data: {
        id,
        status: "contacted"
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            statusUpdatingId: ""
          })
          wx.showToast({
          title: formatToastTitle(result && result.message, "客户更新失败"),
            icon: "none"
          })
          return
        }

        this.setData({
          statusUpdatingId: ""
        })
        if (result.notificationStatus === "failed") {
          wx.showModal({
            title: "状态已更新",
            content: "客户状态已更新，但提醒发送失败。可在错误日志中查看原因。",
            confirmText: "知道了",
            confirmColor: "#528fff",
            showCancel: false,
            complete: () => this.fetchBookings()
          })
          return
        }

        const title =
          result.notificationStatus === "sent"
            ? "已联系，提醒已发送"
            : result.notificationStatus === "not_subscribed"
              ? "已联系，用户未订阅"
              : "已标记为已联系"
        wx.showToast({
          title,
          icon: "none"
        })
        this.fetchBookings()
      },
      fail: (error) => {
        this.setData({
          statusUpdatingId: ""
        })
        wx.showToast({
          title: "客户状态更新失败",
          icon: "none"
        })
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

    if (
      !id ||
      !nextStatus ||
      this.data.updatingId ||
      this.data.savingRemark ||
      this.data.statusUpdatingId
    ) {
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
        confirmColor: "#528fff",
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

  updateCoordination(payload, successTitle) {
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
          title: formatToastTitle(result && result.message, "协调更新失败"),
            icon: "none"
          })
          return
        }
        this.setData({
          updatingId: ""
        })
        wx.showToast({
          title: formatToastTitle(
            successTitle ||
              (payload.coordinationStatus === "resolved"
                ? "已标记为已协调"
                : "已开始协调"),
            "协调状态已更新"
          ),
          icon: "success"
        })
        this.fetchBookings()
      },
      fail: (error) => {
        this.setData({
          updatingId: ""
        })
        wx.showToast({
          title: "协调状态更新失败",
          icon: "none"
        })
      }
    })
  },

  handleOpenBookingManage() {
    wx.navigateTo({
      url: "/pages/booking-manage/booking-manage",
      fail: () => {
        wx.showToast({
          title: "预约管理打开失败",
          icon: "none"
        })
      }
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
          truncated: Boolean(result.truncated),
          lastSyncedText: formatSyncTime(Date.now())
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
