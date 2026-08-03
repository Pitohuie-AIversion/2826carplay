const { requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")

const STATUS_TEXT_MAP = {
  pending: "待联系",
  contacted: "已联系",
  completed: "已完成",
  cancelled: "已取消"
}

const STATUS_CLASS_MAP = {
  pending: "status-pending",
  contacted: "status-contacted",
  completed: "status-completed",
  cancelled: "status-cancelled"
}

const PRIORITY_TEXT_MAP = {
  priority: "优先",
  normal: "常规",
  standby: "候补"
}

const COORDINATION_TEXT_MAP = {
  pending: "待协调",
  coordinating: "协调中",
  resolved: "已协调"
}

function showStatusUpdateFeedback(result, done) {
  const notificationStatus = String((result && result.notificationStatus) || "")
  if (notificationStatus === "failed") {
    wx.showModal({
      title: "状态已更新",
      content: "预约状态已更新，但提醒发送失败。可在错误日志中查看原因。",
      confirmText: "知道了",
      confirmColor: "#528fff",
      showCancel: false,
      complete: done
    })
    return
  }

  const title =
    notificationStatus === "sent"
      ? "提醒已发送"
      : notificationStatus === "not_subscribed"
        ? "用户未订阅提醒"
        : "状态已更新"
  wx.showToast({
    title,
    icon: "none"
  })
  done()
}

function formatDisplayTime(value) {
  if (!value) {
    return ""
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }

  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function normalizeRemark(value) {
  return String(value || "").slice(0, 200)
}

function normalizePhone(value) {
  const phone = String(value || "").trim()
  const digitCount = phone.replace(/\D/g, "").length
  if (!/^\+?[0-9-]{6,20}$/.test(phone) || digitCount < 6 || digitCount > 15) {
    return ""
  }
  return phone
}

function normalizeBooking(item) {
  const booking = item && typeof item === "object" ? item : {}
  const status = String(booking.status || "pending").trim() || "pending"
  const coordinationStatus =
    status === "completed" || status === "cancelled"
      ? "resolved"
      : COORDINATION_TEXT_MAP[booking.coordinationStatus]
        ? booking.coordinationStatus
        : "pending"
  return {
    id: booking.id || "",
    openid: booking.openid || "",
    vehicleId: booking.vehicleId || "",
    vehicleName: booking.vehicleName || "",
    userName: booking.userName || "",
    phone: booking.phone || "",
    startDate: booking.startDate || "",
    endDate: booking.endDate || "",
    city: booking.city || "",
    note: booking.note || "",
    adminRemark: booking.adminRemark || "",
    adminRemarkDraft: booking.adminRemark || "",
    adminRemarkUpdatedAt: booking.adminRemarkUpdatedAt || "",
    schedulePriority: PRIORITY_TEXT_MAP[booking.schedulePriority]
      ? booking.schedulePriority
      : "normal",
    coordinationStatus,
    coordinationUpdatedAt: booking.coordinationUpdatedAt || "",
    status,
    createdAt: booking.createdAt || "",
    updatedAt: booking.updatedAt || ""
  }
}

function normalizeConflictBooking(item) {
  const booking = item && typeof item === "object" ? item : {}
  const status = String(booking.status || "pending").trim() || "pending"
  const schedulePriority = PRIORITY_TEXT_MAP[booking.schedulePriority]
    ? booking.schedulePriority
    : "normal"
  const coordinationStatus =
    status === "completed" || status === "cancelled"
      ? "resolved"
      : COORDINATION_TEXT_MAP[booking.coordinationStatus]
        ? booking.coordinationStatus
        : "pending"
  return {
    id: booking.id || "",
    userName: booking.userName || "",
    phone: booking.phone || "",
    startDate: booking.startDate || "",
    endDate: booking.endDate || "",
    city: booking.city || "",
    status,
    statusText: STATUS_TEXT_MAP[status] || "待处理",
    statusClass: STATUS_CLASS_MAP[status] || "status-pending",
    schedulePriority,
    schedulePriorityText: PRIORITY_TEXT_MAP[schedulePriority],
    priorityClass: `priority-${schedulePriority}`,
    coordinationStatus,
    coordinationStatusText: COORDINATION_TEXT_MAP[coordinationStatus],
    coordinationClass: `coordination-${coordinationStatus}`
  }
}

Page({
  data: {
    id: "",
    initialLoading: true,
    loading: false,
    loadFailed: false,
    loadErrorText: "预约详情加载失败，请稍后重试",
    pageAuthorized: false,
    booking: {},
    statusText: "待联系",
    statusClass: "status-pending",
    createdAtText: "",
    updatedAtText: "",
    adminRemarkUpdatedAtText: "",
    conflicts: [],
    conflictTotal: 0,
    conflictsTruncated: false,
    conflictsUnavailable: false,
    conflictCheckSkipped: false,
    coordinationLoading: false,
    coordinationEditable: false,
    coordinationUpdatedAtText: ""
  },

  onLoad(options) {
    const id = String((options && options.id) || "").trim()
    this.setData({ id })

    const app = getApp()
    const env = app && app.globalData && app.globalData.cloudEnvId ? app.globalData.cloudEnvId : undefined

    if (wx.cloud && typeof wx.cloud.init === "function") {
      try {
        wx.cloud.init({
          env,
          traceUser: true
        })
      } catch (error) {}
    }

    const eventChannel = this.getOpenerEventChannel && this.getOpenerEventChannel()
    if (eventChannel && typeof eventChannel.on === "function") {
      eventChannel.on("acceptManageBookingDetail", (payload) => {
        const booking = normalizeBooking(payload && payload.booking)
        if (booking.id && this.data.pageAuthorized) {
          this.applyBooking(booking)
        }
      })
    }

    requirePagePermission(this, {
      required: "canManageBookings",
      noPermissionMessage: "无权访问预约详情管理",
      onAuthorized: () => {
        if (this.data.id) {
          this.loadDetail()
          return
        }
        this.setData({ initialLoading: false })
      }
    })
  },

  onShow() {
    if (this.data.pageAuthorized && this.data.id) {
      this.loadDetail()
    }
  },

  applyBooking(booking, conflictResult) {
    const conflictData = conflictResult && typeof conflictResult === "object"
      ? conflictResult
      : {}
    this.setData({
      booking,
      initialLoading: false,
      loadFailed: false,
      statusText: STATUS_TEXT_MAP[booking.status] || "待联系",
      statusClass: STATUS_CLASS_MAP[booking.status] || "status-pending",
      createdAtText: formatDisplayTime(booking.createdAt),
      updatedAtText: formatDisplayTime(booking.updatedAt),
      adminRemarkUpdatedAtText: formatDisplayTime(booking.adminRemarkUpdatedAt),
      coordinationUpdatedAtText: formatDisplayTime(booking.coordinationUpdatedAt),
      coordinationEditable: booking.status === "pending" || booking.status === "contacted",
      coordinationLoading: false,
      conflicts: Array.isArray(conflictData.list)
        ? conflictData.list.map(normalizeConflictBooking)
        : [],
      conflictTotal: Math.max(0, Number(conflictData.total || 0)),
      conflictsTruncated: Boolean(conflictData.truncated),
      conflictsUnavailable: Boolean(conflictData.unavailable),
      conflictCheckSkipped: Boolean(conflictData.skipped)
    })
  },

  loadDetail() {
    if (!this.data.id) {
      this.setData({
        initialLoading: false,
        loading: false
      })
      return
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        initialLoading: false,
        loading: false,
        loadFailed: true,
        loadErrorText: "云能力未初始化，请稍后重试"
      })
      return
    }

    this.setData({
      loading: true,
      loadFailed: false
    })

    wx.cloud.callFunction({
      name: "bookingDetail",
      data: {
        id: this.data.id
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        const current = result && result.ok ? result.detail : null
        if (!current) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "预约不存在"),
            icon: "none"
          })
          this.setData({
            initialLoading: false,
            loading: false,
            loadFailed: true,
            loadErrorText: (result && result.message) || "预约详情加载失败，请稍后重试"
          })
          return
        }

        this.applyBooking(normalizeBooking(current), {
          list: result.conflicts,
          total: result.conflictTotal,
          truncated: result.conflictsTruncated,
          unavailable: result.conflictsUnavailable,
          skipped: result.conflictCheckSkipped
        })
        this.setData({ loading: false })
      },
      fail: (error) => {
        wx.showToast({
          title: "加载失败",
          icon: "none"
        })
        this.setData({
          initialLoading: false,
          loading: false,
          loadFailed: true,
          loadErrorText: (error && (error.errMsg || error.message)) || "预约详情加载失败，请稍后重试"
        })
      }
    })
  },

  handleRemarkInput(event) {
    const value = normalizeRemark(event.detail && event.detail.value)
    this.setData({
      "booking.adminRemarkDraft": value
    })
  },

  handleSaveRemark() {
    if (this.data.loading || !this.data.id) {
      return
    }

    const adminRemark = normalizeRemark(this.data.booking.adminRemarkDraft)

    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: "bookingUpdateAdminRemark",
      data: {
        id: this.data.id,
        adminRemark
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "保存失败"),
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        wx.showToast({
          title: "备注已保存",
          icon: "none"
        })
        this.loadDetail()
      },
      fail: (error) => {
        wx.showToast({
          title: "保存失败",
          icon: "none"
        })
        this.setData({ loading: false })
      }
    })
  },

  handleUpdateCoordination(event) {
    if (this.data.coordinationLoading || !this.data.coordinationEditable || !this.data.id) {
      return
    }

    const field = String(event.currentTarget.dataset.field || "")
    const value = String(event.currentTarget.dataset.value || "")
    if (
      (field !== "schedulePriority" && field !== "coordinationStatus") ||
      (field === "schedulePriority" && !PRIORITY_TEXT_MAP[value]) ||
      (field === "coordinationStatus" && !COORDINATION_TEXT_MAP[value])
    ) {
      return
    }

    const schedulePriority =
      field === "schedulePriority" ? value : this.data.booking.schedulePriority
    const coordinationStatus =
      field === "coordinationStatus" ? value : this.data.booking.coordinationStatus

    if (
      schedulePriority === this.data.booking.schedulePriority &&
      coordinationStatus === this.data.booking.coordinationStatus
    ) {
      return
    }

    this.setData({ coordinationLoading: true })
    wx.cloud.callFunction({
      name: "bookingUpdateCoordination",
      data: {
        id: this.data.id,
        schedulePriority,
        coordinationStatus
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "协调更新失败"),
            icon: "none"
          })
          this.setData({ coordinationLoading: false })
          return
        }

        wx.showToast({
          title: result.changed === false ? "协调安排未变化" : "协调安排已更新",
          icon: "none"
        })
        this.setData({ coordinationLoading: false })
        this.loadDetail()
      },
      fail: (error) => {
        wx.showToast({
          title: "协调更新失败",
          icon: "none"
        })
        this.setData({ coordinationLoading: false })
      }
    })
  },

  callPhone(value) {
    const phone = normalizePhone(value)
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
        if (message && String(message).includes("cancel")) {
          return
        }
        wx.showToast({
          title: "拨号失败，请复制号码",
          icon: "none"
        })
      }
    })
  },

  handleCallPhone() {
    this.callPhone(this.data.booking && this.data.booking.phone)
  },

  handleConflictCall(event) {
    this.callPhone(event.currentTarget.dataset.phone)
  },

  handleConflictTap(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (!id || id === this.data.id) {
      return
    }
    wx.navigateTo({
      url: `/pages/booking-manage-detail/booking-manage-detail?id=${id}`,
      fail: () => {
        wx.showToast({
          title: "冲突预约打开失败",
          icon: "none"
        })
      }
    })
  },

  handleCopyContact(event) {
    const field = String(event.currentTarget.dataset.field || "")
    const labels = {
      phone: "手机号",
      openid: "OpenID"
    }
    if (!labels[field]) {
      return
    }

    const value = String((this.data.booking && this.data.booking[field]) || "").trim()
    if (!value) {
      wx.showToast({
        title: `${labels[field]}为空`,
        icon: "none"
      })
      return
    }

    wx.setClipboardData({
      data: value,
      success: () => {
        wx.showToast({
          title: `${labels[field]}已复制`,
          icon: "none"
        })
      },
      fail: () => {
        wx.showToast({
          title: `${labels[field]}复制失败`,
          icon: "none"
        })
      }
    })
  },

  handleUpdateStatus(event) {
    if (this.data.loading || !this.data.id) {
      return
    }

    const status = String(event.currentTarget.dataset.status || "").trim()
    if (!status) {
      return
    }

    const statusText = STATUS_TEXT_MAP[status] || status

    wx.showModal({
      title: "更新状态",
      content: `确认将该预约更新为「${statusText}」？`,
      confirmText: "确认更新",
      confirmColor: status === "cancelled" ? "#d46868" : "#528fff",
      success: (res) => {
        if (!res.confirm) {
          return
        }

        this.updateStatus(status)
      }
    })
  },

  updateStatus(status) {
    this.setData({ loading: true })

    wx.cloud.callFunction({
      name: "bookingUpdateStatus",
      data: {
        id: this.data.id,
        status
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "更新失败"),
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        showStatusUpdateFeedback(result, () => {
          this.loadDetail()
        })
      },
      fail: (error) => {
        wx.showToast({
          title: "更新失败",
          icon: "none"
        })
        this.setData({ loading: false })
      }
    })
  },

  handleRetryLoad() {
    this.loadDetail()
  },

  handleBackManage() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.redirectTo({
            url: "/pages/booking-manage/booking-manage",
            fail: () => {
              wx.reLaunch({
                url: "/pages/booking-manage/booking-manage",
                fail: () => {
                  wx.showToast({
                    title: "返回预约管理失败",
                    icon: "none"
                  })
                }
              })
            }
          })
        }
      })
      return
    }

    wx.redirectTo({
      url: "/pages/booking-manage/booking-manage",
      fail: () => {
        wx.reLaunch({
          url: "/pages/booking-manage/booking-manage",
          fail: () => {
            wx.showToast({
              title: "返回预约管理失败",
              icon: "none"
            })
          }
        })
      }
    })
  }
})
