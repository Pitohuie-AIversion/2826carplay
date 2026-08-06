const { formatToastTitle } = require("../../shared/uiFeedback")
const { buildVehicleDisplayIdentity } = require("../../shared/vehicle")
const BOOKING_DETAIL_LOAD_TIMEOUT_MS = 15 * 1000
const BOOKING_DETAIL_MUTATION_TIMEOUT_MS = 12 * 1000

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

function buildStatusGuidance(status) {
  const value = String(status || "pending").trim() || "pending"
  const guidanceMap = {
    pending: {
      title: "等待顾问联系",
      desc: "预约已提交，请保持手机畅通；联系前仍可修改本次预约的联系信息。",
      tone: "pending"
    },
    contacted: {
      title: "正在确认行程",
      desc: "顾问已联系，请按沟通结果确认车辆档期、价格与取还车安排。",
      tone: "contacted"
    },
    completed: {
      title: "本次行程已完成",
      desc: "预约流程已经结束，感谢使用极境车库服务。",
      tone: "completed"
    },
    cancelled: {
      title: "本次预约已取消",
      desc: "该预约已结束，如仍有用车需求，可返回车库重新选择车辆。",
      tone: "cancelled"
    }
  }
  return guidanceMap[value] || guidanceMap.pending
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
      marker: `${index + 1}`,
      showCheck: index < activeIndex,
      showCancelledMark: cancelled && index === activeIndex,
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

function formatBookingReference(value) {
  const id = String(value || "").trim()
  return id ? `#${id.slice(-8).toUpperCase()}` : "—"
}

function getJourneySpanText(startDate, endDate) {
  const start = new Date(`${String(startDate || "")}T00:00:00`)
  const end = new Date(`${String(endDate || "")}T00:00:00`)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end < start) {
    return "日期待确认"
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86400000)
  return days === 0 ? "当日取还" : `${days} 天跨度`
}

function normalizeBooking(item) {
  const booking = item && typeof item === "object" ? item : {}
  const status = String(booking.status || "pending").trim() || "pending"
  const vehicleIdentity = buildVehicleDisplayIdentity(booking.vehicleName)
  return {
    id: booking.id || "",
    vehicleId: booking.vehicleId || "",
    ...vehicleIdentity,
    vehicleReference: booking.vehicleReference || vehicleIdentity.vehicleReference,
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
    bookingReference: "—",
    journeySpanText: "日期待确认",
    progressSteps: buildProgressSteps("pending"),
    statusGuidance: buildStatusGuidance("pending"),
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

  onUnload() {
    this._detailRequestId = Number(this._detailRequestId || 0) + 1
    this._saveRequestSerial = Number(this._saveRequestSerial || 0) + 1
    this._cancelRequestSerial = Number(this._cancelRequestSerial || 0) + 1
    this.clearDetailLoadTimer()
    this.clearSaveRequestTimer()
    this.clearCancelRequestTimer()
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
      bookingReference: formatBookingReference(booking.id),
      journeySpanText: getJourneySpanText(booking.startDate, booking.endDate),
      progressSteps: buildProgressSteps(booking.status),
      statusGuidance: buildStatusGuidance(booking.status),
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
    const requestId = Number(this._detailRequestId || 0) + 1
    this._detailRequestId = requestId
    this.clearDetailLoadTimer()

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

    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._detailRequestId) {
        return false
      }
      settled = true
      this.clearDetailLoadTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      wx.showToast({
        title: "加载失败",
        icon: "none"
      })
      this.setData({
        initialLoading: false,
        loading: false,
        loadFailed: true,
        loadErrorText: String(message || "预约详情加载失败，请稍后重试")
      })
    }

    this._detailLoadTimer = setTimeout(() => {
      handleFailure("预约详情加载超时，请检查网络后重试")
    }, BOOKING_DETAIL_LOAD_TIMEOUT_MS)

    const bookingId = String(this.data.id || "").trim()
    const requestOptions = {
      name: "bookingMyDetail",
      data: { id: bookingId },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
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
            loadFailed: result && result.code !== "NOT_FOUND",
            loadErrorText: (result && result.message) || "预约详情加载失败，请稍后重试"
          })
          return
        }

        this.applyBooking(normalizeBooking(current))
        this.setData({ loading: false })
      },
      fail: (error) => {
        handleFailure((error && (error.errMsg || error.message)) || "预约详情加载失败，请稍后重试")
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure((error && (error.errMsg || error.message)) || "预约详情加载失败，请稍后重试")
    }
  },

  clearDetailLoadTimer() {
    if (!this._detailLoadTimer) {
      return
    }
    clearTimeout(this._detailLoadTimer)
    this._detailLoadTimer = null
  },

  handleCancel() {
    if (!this.data.canCancel || this.data.loading || !this.data.id) {
      return
    }

    wx.showModal({
      title: "取消预约",
      content: "已完成的预约不可取消。确认取消当前预约吗？",
      confirmText: "确认取消",
      confirmColor: "#d46868",
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
        title: formatToastTitle(validationMessage, "信息格式有误"),
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

    const bookingId = String(this.data.id || "").trim()
    const submittedForm = {
      userName: String((this.data.editForm && this.data.editForm.userName) || "").trim(),
      phone: String((this.data.editForm && this.data.editForm.phone) || "").trim(),
      city: String((this.data.editForm && this.data.editForm.city) || "").trim(),
      note: String((this.data.editForm && this.data.editForm.note) || "").trim()
    }
    const saveSerial = Number(this._saveRequestSerial || 0) + 1
    this._saveRequestSerial = saveSerial
    this.clearSaveRequestTimer()
    this.setData({ saving: true })

    let settled = false
    const finishRequest = () => {
      if (settled || saveSerial !== this._saveRequestSerial) {
        return false
      }
      settled = true
      this.clearSaveRequestTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ saving: false })
      wx.showToast({
        title: formatToastTitle(message, "保存失败"),
        icon: "none"
      })
    }

    this._saveRequestTimer = setTimeout(() => {
      handleFailure("保存超时，请重试")
    }, BOOKING_DETAIL_MUTATION_TIMEOUT_MS)

    const requestOptions = {
      name: "bookingUpdateMyContact",
      data: {
        id: bookingId,
        ...submittedForm
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ saving: false })
          wx.showToast({
            title: formatToastTitle(result && result.message, "保存失败"),
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
        this.setData({ editing: false, saving: false })
        this.loadDetail()
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  clearSaveRequestTimer() {
    if (!this._saveRequestTimer) {
      return
    }
    clearTimeout(this._saveRequestTimer)
    this._saveRequestTimer = null
  },

  cancelBooking() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const bookingId = String(this.data.id || "").trim()
    const cancelSerial = Number(this._cancelRequestSerial || 0) + 1
    this._cancelRequestSerial = cancelSerial
    this.clearCancelRequestTimer()
    this.setData({ loading: true })

    let settled = false
    const finishRequest = () => {
      if (settled || cancelSerial !== this._cancelRequestSerial) {
        return false
      }
      settled = true
      this.clearCancelRequestTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      wx.showToast({
        title: formatToastTitle(message, "取消失败"),
        icon: "none"
      })
      this.setData({ loading: false })
    }

    this._cancelRequestTimer = setTimeout(() => {
      handleFailure("取消预约超时，请重试")
    }, BOOKING_DETAIL_MUTATION_TIMEOUT_MS)

    const requestOptions = {
      name: "bookingCancel",
      data: { id: bookingId },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "取消失败"),
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
        handleFailure(error && (error.errMsg || error.message))
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  clearCancelRequestTimer() {
    if (!this._cancelRequestTimer) {
      return
    }
    clearTimeout(this._cancelRequestTimer)
    this._cancelRequestTimer = null
  },

  handleRetryLoad() {
    this.loadDetail()
  },

  handleCopyBookingId() {
    const id = String((this.data.booking && this.data.booking.id) || "").trim()
    if (!id || typeof wx.setClipboardData !== "function") {
      wx.showToast({
        title: "预约编号复制失败",
        icon: "none"
      })
      return
    }
    wx.setClipboardData({
      data: id,
      success: () => {
        wx.showToast({
          title: "预约编号已复制",
          icon: "none"
        })
      },
      fail: () => {
        wx.showToast({
          title: "预约编号复制失败",
          icon: "none"
        })
      }
    })
  },

  handleViewVehicle() {
    const vehicleId = String((this.data.booking && this.data.booking.vehicleId) || "").trim()
    if (!vehicleId) {
      wx.showToast({
        title: "车辆信息暂不可用",
        icon: "none"
      })
      return
    }
    wx.navigateTo({
      url: `/pages/car-detail/car-detail?carId=${vehicleId}`,
      fail: () => {
        wx.showToast({
          title: "车辆详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleBackBookings() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.redirectTo({
            url: "/pages/bookings/bookings",
            fail: () => {
              wx.reLaunch({
                url: "/pages/bookings/bookings",
                fail: () => {
                  wx.showToast({
                    title: "返回预约列表失败",
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
      url: "/pages/bookings/bookings",
      fail: () => {
        wx.reLaunch({
          url: "/pages/bookings/bookings",
          fail: () => {
            wx.showToast({
              title: "返回预约列表失败",
              icon: "none"
            })
          }
        })
      }
    })
  }
})
