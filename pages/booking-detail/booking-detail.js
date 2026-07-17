function mapStatusText(status) {
  const value = String(status || "").trim()
  if (value === "contacted") {
    return "已联系"
  }
  if (value === "completed") {
    return "已完成"
  }
  if (value === "cancelled") {
    return "已取消"
  }
  return "待联系"
}

function mapStatusClass(status) {
  const value = String(status || "").trim()
  if (value === "contacted") {
    return "status-contacted"
  }
  if (value === "completed") {
    return "status-completed"
  }
  if (value === "cancelled") {
    return "status-cancelled"
  }
  return "status-pending"
}

function canCancelBooking(status) {
  const value = String(status || "").trim()
  return value === "pending" || value === "contacted"
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

function normalizeBooking(item) {
  const booking = item && typeof item === "object" ? item : {}
  const status = String(booking.status || "pending").trim() || "pending"
  return {
    id: booking.id || "",
    vehicleId: booking.vehicleId || "",
    vehicleName: booking.vehicleName || "",
    userName: booking.userName || "",
    phone: booking.phone || "",
    startDate: booking.startDate || "",
    endDate: booking.endDate || "",
    city: booking.city || "",
    note: booking.note || "",
    status,
    createdAt: booking.createdAt || "",
    updatedAt: booking.updatedAt || ""
  }
}

Page({
  data: {
    id: "",
    loading: false,
    booking: {},
    statusText: "待联系",
    statusClass: "status-pending",
    createdAtText: "",
    updatedAtText: "",
    canCancel: false
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
      eventChannel.on("acceptBookingDetail", (payload) => {
        const booking = normalizeBooking(payload && payload.booking)
        if (booking.id) {
          this.applyBooking(booking)
        }
      })
    }
  },

  onShow() {
    if (this.data.id) {
      this.loadDetail()
    }
  },

  applyBooking(booking) {
    this.setData({
      booking,
      statusText: mapStatusText(booking.status),
      statusClass: mapStatusClass(booking.status),
      createdAtText: formatDisplayTime(booking.createdAt),
      updatedAtText: formatDisplayTime(booking.updatedAt),
      canCancel: canCancelBooking(booking.status)
    })
  },

  loadDetail() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function" || !this.data.id) {
      return
    }

    this.setData({ loading: true })

    wx.cloud.callFunction({
      name: "bookingMyList",
      data: { limit: 100 },
      success: (res) => {
        const result = res && res.result ? res.result : null
        const rawList = result && result.ok && Array.isArray(result.list) ? result.list : []
        const current = rawList.find((item) => item.id === this.data.id)

        if (!current) {
          wx.showToast({
            title: "预约不存在",
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

  handleCancel() {
    if (!this.data.canCancel || this.data.loading || !this.data.id) {
      return
    }

    wx.showModal({
      title: "取消预约",
      content: "已完成的预约不可取消。确认取消当前预约吗？",
      success: (res) => {
        if (!res.confirm) {
          return
        }

        this.cancelBooking()
      }
    })
  },

  cancelBooking() {
    this.setData({ loading: true })

    wx.cloud.callFunction({
      name: "bookingCancel",
      data: { id: this.data.id },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "取消失败",
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        wx.showToast({
          title: "预约已取消",
          icon: "none"
        })
        this.loadDetail()
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "取消失败",
          icon: "none"
        })
        this.setData({ loading: false })
      }
    })
  }
})
