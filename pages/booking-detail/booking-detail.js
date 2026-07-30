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

function canEditBooking(status) {
  const value = String(status || "").trim()
  return value === "pending" || value === "contacted"
}

function buildProgressSteps(status) {
  const value = String(status || "pending").trim() || "pending"
  const cancelled = value === "cancelled"
  const activeIndex = value === "completed" ? 2 : value === "contacted" || cancelled ? 1 : 0
  const labels = cancelled ? ["预约已提交", "预约已取消", "流程已结束"] : ["预约已提交", "顾问联系", "行程完成"]

  return labels.map((label, index) => {
    let stateClass = "progress-upcoming"
    if (index < activeIndex) {
      stateClass = "progress-done"
    } else if (index === activeIndex) {
      stateClass = cancelled ? "progress-cancelled" : "progress-current"
    }

    return {
      key: `${value}-${index}`,
      label,
      marker: index < activeIndex ? "✓" : `${index + 1}`,
      stateClass,
      isLast: index === labels.length - 1
    }
  })
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
    initialLoading: true,
    loading: false,
    loadFailed: false,
    loadErrorText: "预约详情加载失败，请稍后重试",
    booking: {},
    statusText: "待联系",
    statusClass: "status-pending",
    createdAtText: "",
    updatedAtText: "",
    progressSteps: buildProgressSteps("pending"),
    canCancel: false,
    canEdit: false,
    editing: false,
    saving: false,
    bookingStatusTemplateId: "",
    subscriptionEnabled: false,
    subscriptionRequesting: false,
    editForm: {
      userName: "",
      phone: "",
      city: "",
      note: ""
    }
  },

  onLoad(options) {
    const id = String((options && options.id) || "").trim()
    this.setData({
      id,
      initialLoading: Boolean(id)
    })

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

    this.loadNotificationConfig()
  },

  onShow() {
    if (this.data.id) {
      this.loadDetail()
    }
  },

  applyBooking(booking) {
    this.setData({
      booking,
      initialLoading: false,
      loadFailed: false,
      statusText: mapStatusText(booking.status),
      statusClass: mapStatusClass(booking.status),
      createdAtText: formatDisplayTime(booking.createdAt),
      updatedAtText: formatDisplayTime(booking.updatedAt),
      progressSteps: buildProgressSteps(booking.status),
      canCancel: canCancelBooking(booking.status),
      canEdit: canEditBooking(booking.status),
      editing: false,
      saving: false,
      editForm: {
        userName: booking.userName,
        phone: booking.phone,
        city: booking.city,
        note: booking.note
      }
    })
  },

  loadNotificationConfig() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return
    }

    wx.cloud.callFunction({
      name: "operationConfigGet",
      success: (res) => {
        const result = res && res.result ? res.result : null
        const templateId =
          result && result.ok && result.config
            ? String(result.config.bookingStatusTemplateId || "").trim()
            : ""
        this.setData({
          bookingStatusTemplateId: templateId,
          subscriptionEnabled: Boolean(templateId)
        })
      },
      fail: () => {}
    })
  },

  handleRequestStatusSubscription() {
    const templateId = String(this.data.bookingStatusTemplateId || "").trim()
    if (
      !this.data.canEdit ||
      !templateId ||
      this.data.subscriptionRequesting ||
      typeof wx.requestSubscribeMessage !== "function"
    ) {
      wx.showToast({
        title: "状态提醒暂不可用",
        icon: "none"
      })
      return
    }

    this.setData({ subscriptionRequesting: true })
    try {
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        success: (result) => {
          const choice = result && result[templateId]
          if (choice === "accept") {
            wx.showToast({
              title: "已订阅下一次状态提醒",
              icon: "none"
            })
            return
          }
          wx.showToast({
            title: "未开启状态提醒",
            icon: "none"
          })
        },
        fail: (error) => {
          const message = error && (error.errMsg || error.message)
          if (message && String(message).includes("cancel")) {
            return
          }
          wx.showToast({
            title: "订阅失败，请稍后重试",
            icon: "none"
          })
        },
        complete: () => {
          this.setData({ subscriptionRequesting: false })
        }
      })
    } catch (error) {
      this.setData({ subscriptionRequesting: false })
      wx.showToast({
        title: "订阅失败，请稍后重试",
        icon: "none"
      })
    }
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
      name: "bookingMyDetail",
      data: { id: this.data.id },
      success: (res) => {
        const result = res && res.result ? res.result : null
        const current = result && result.ok ? result.detail : null

        if (!current) {
          wx.showToast({
            title: (result && result.message) || "预约不存在",
            icon: "none"
          })
          this.setData({
            initialLoading: false,
            loading: false,
            loadFailed: result && result.code !== "NOT_FOUND",
            loadErrorText: (result && result.message) || "预约详情加载失败，请稍后重试"
          })
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
        this.setData({
          initialLoading: false,
          loading: false,
          loadFailed: true,
          loadErrorText: (error && (error.errMsg || error.message)) || "预约详情加载失败，请稍后重试"
        })
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

  handleStartEdit() {
    if (!this.data.canEdit || this.data.loading || this.data.saving) {
      return
    }
    const booking = this.data.booking || {}
    this.setData({
      editing: true,
      editForm: {
        userName: booking.userName || "",
        phone: booking.phone || "",
        city: booking.city || "",
        note: booking.note || ""
      }
    })
  },

  handleEditInput(event) {
    const field = String(event.currentTarget.dataset.field || "")
    if (!["userName", "phone", "city", "note"].includes(field)) {
      return
    }
    let value = String((event.detail && event.detail.value) || "")
    if (field === "phone") {
      value = value.replace(/\D/g, "").slice(0, 11)
    }
    this.setData({
      [`editForm.${field}`]: value
    })
  },

  handleCancelEdit() {
    if (this.data.saving) {
      return
    }
    this.setData({
      editing: false
    })
  },

  validateEditForm() {
    const form = this.data.editForm || {}
    const userName = String(form.userName || "").trim()
    const phone = String(form.phone || "").trim()
    const city = String(form.city || "").trim()
    const note = String(form.note || "").trim()

    if (!userName) {
      return "请输入联系人姓名"
    }
    if (userName.length > 20) {
      return "联系人姓名不能超过 20 字"
    }
    if (!/^1\d{10}$/.test(phone)) {
      return "请输入正确的 11 位手机号"
    }
    if (!city) {
      return "请输入取车城市"
    }
    if (city.length > 20) {
      return "取车城市不能超过 20 字"
    }
    if (note.length > 200) {
      return "备注不能超过 200 字"
    }
    return ""
  },

  handleSaveEdit() {
    if (!this.data.editing || this.data.saving || !this.data.id) {
      return
    }
    const validationMessage = this.validateEditForm()
    if (validationMessage) {
      wx.showToast({
        title: validationMessage,
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

    const form = this.data.editForm
    this.setData({ saving: true })
    wx.cloud.callFunction({
      name: "bookingUpdateMyContact",
      data: {
        id: this.data.id,
        userName: String(form.userName || "").trim(),
        phone: String(form.phone || "").trim(),
        city: String(form.city || "").trim(),
        note: String(form.note || "").trim()
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "保存失败",
            icon: "none"
          })
          if (result && ["STATUS_CONFLICT", "STATUS_NOT_ALLOWED"].includes(result.code)) {
            this.loadDetail()
          }
          return
        }

        wx.showToast({
          title: result.updated ? "联系信息已更新" : "信息未发生变化",
          icon: "none"
        })
        this.setData({ editing: false })
        this.loadDetail()
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "保存失败",
          icon: "none"
        })
      },
      complete: () => {
        this.setData({ saving: false })
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
  },

  handleRetryLoad() {
    this.loadDetail()
  },

  handleBackBookings() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.redirectTo({
            url: "/pages/bookings/bookings"
          })
        }
      })
      return
    }

    wx.redirectTo({
      url: "/pages/bookings/bookings"
    })
  }
})
