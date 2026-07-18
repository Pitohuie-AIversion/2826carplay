const { requirePagePermission } = require("../../shared/pageAuth")

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

function normalizeBooking(item) {
  const booking = item && typeof item === "object" ? item : {}
  const status = String(booking.status || "pending").trim() || "pending"
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
    status,
    createdAt: booking.createdAt || "",
    updatedAt: booking.updatedAt || ""
  }
}

Page({
  data: {
    id: "",
    loading: false,
    pageAuthorized: false,
    booking: {},
    statusText: "待联系",
    statusClass: "status-pending",
    createdAtText: "",
    updatedAtText: "",
    adminRemarkUpdatedAtText: ""
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
        }
      }
    })
  },

  onShow() {
    if (this.data.pageAuthorized && this.data.id) {
      this.loadDetail()
    }
  },

  applyBooking(booking) {
    this.setData({
      booking,
      statusText: STATUS_TEXT_MAP[booking.status] || "待联系",
      statusClass: STATUS_CLASS_MAP[booking.status] || "status-pending",
      createdAtText: formatDisplayTime(booking.createdAt),
      updatedAtText: formatDisplayTime(booking.updatedAt),
      adminRemarkUpdatedAtText: formatDisplayTime(booking.adminRemarkUpdatedAt)
    })
  },

  loadDetail() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function" || !this.data.id) {
      return
    }

    this.setData({ loading: true })

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
            title: (result && result.message) || "预约不存在",
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        this.applyBooking(normalizeBooking(current))
        this.setData({ loading: false })
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "加载失败",
          icon: "none"
        })
        this.setData({ loading: false })
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
            title: (result && result.message) || "保存失败",
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
          title: (error && (error.errMsg || error.message)) || "保存失败",
          icon: "none"
        })
        this.setData({ loading: false })
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
            title: (result && result.message) || "更新失败",
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        wx.showToast({
          title: "状态已更新",
          icon: "none"
        })
        this.loadDetail()
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "更新失败",
          icon: "none"
        })
        this.setData({ loading: false })
      }
    })
  }
})
