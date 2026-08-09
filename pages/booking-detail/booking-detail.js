const { formatToastTitle } = require("../../shared/uiFeedback")
const { buildVehicleDisplayIdentity } = require("../../shared/vehicle")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const { isPageCurrent } = require("../../shared/pageNativeAction")
const BOOKING_DETAIL_LOAD_TIMEOUT_MS = 15 * 1000
const BOOKING_DETAIL_MUTATION_TIMEOUT_MS = 12 * 1000
const SUBSCRIPTION_REQUEST_TIMEOUT_MS = 15 * 1000

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
    cancelling: false,
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
    this._bookingDetailUnloaded = false
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
      const handleBookingDetail = (payload) => {
        if (
          this._bookingDetailUnloaded ||
          this.data.editing ||
          this.data.saving ||
          this.data.subscriptionRequesting ||
          this.data.cancelling
        ) {
          return
        }
        const booking = normalizeBooking(payload && payload.booking)
        if (booking.id) {
          this.applyBooking(booking)
        }
      }
      this._bookingDetailEventChannel = eventChannel
      this._bookingDetailEventHandler = handleBookingDetail
      eventChannel.on("acceptBookingDetail", handleBookingDetail)
    }

    this.loadNotificationConfig()
  },

  onShow() {
    if (
      this.data.id &&
      !this.data.loading &&
      !this.data.editing &&
      !this.data.saving &&
      !this.data.subscriptionRequesting &&
      !this.data.cancelling
    ) {
      this.loadDetail()
    }
  },

  onUnload() {
    this._bookingDetailUnloaded = true
    this._cancelConfirmationSerial = Number(this._cancelConfirmationSerial || 0) + 1
    if (
      this._bookingDetailEventChannel &&
      typeof this._bookingDetailEventChannel.off === "function" &&
      this._bookingDetailEventHandler
    ) {
      this._bookingDetailEventChannel.off(
        "acceptBookingDetail",
        this._bookingDetailEventHandler
      )
    }
    this._bookingDetailEventChannel = null
    this._bookingDetailEventHandler = null
    this._detailRequestId = Number(this._detailRequestId || 0) + 1
    this._saveRequestSerial = Number(this._saveRequestSerial || 0) + 1
    this._cancelRequestSerial = Number(this._cancelRequestSerial || 0) + 1
    this._subscriptionRequestId = Number(this._subscriptionRequestId || 0) + 1
    this.cancelOperationConfigRequest()
    this.clearDetailLoadTimer()
    this.clearSaveRequestTimer()
    this.clearCancelRequestTimer()
    this.clearSubscriptionRequestTimer()
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
      cancelling: false,
      editForm: {
        userName: booking.userName,
        phone: booking.phone,
        city: booking.city,
        note: booking.note
      }
    })
  },

  loadNotificationConfig() {
    this.cancelOperationConfigRequest()
    this._cancelOperationConfigRequest = requestOperationConfig({
      onSuccess: (config) => {
        const templateId = String(config.bookingStatusTemplateId || "").trim()
        this.setData({
          bookingStatusTemplateId: templateId,
          subscriptionEnabled: Boolean(templateId)
        })
      }
    })
  },

  cancelOperationConfigRequest() {
    if (typeof this._cancelOperationConfigRequest === "function") {
      this._cancelOperationConfigRequest()
      this._cancelOperationConfigRequest = null
    }
  },

  handleRequestStatusSubscription() {
    const templateId = String(this.data.bookingStatusTemplateId || "").trim()
    if (
      this.data.loading ||
      this.data.editing ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling
    ) {
      return
    }
    if (
      !this.data.canEdit ||
      !templateId ||
      typeof wx.requestSubscribeMessage !== "function"
    ) {
      wx.showToast({
        title: "状态提醒暂不可用",
        icon: "none"
      })
      return
    }

    const requestId = Number(this._subscriptionRequestId || 0) + 1
    this._subscriptionRequestId = requestId
    this.clearSubscriptionRequestTimer()
    this.setData({ subscriptionRequesting: true })
    let settled = false
    const finishRequest = (callback) => {
      if (settled || this._subscriptionRequestId !== requestId) {
        return false
      }
      settled = true
      this.clearSubscriptionRequestTimer()
      this.setData({ subscriptionRequesting: false })
      if (typeof callback === "function") {
        callback()
      }
      return true
    }
    this._subscriptionRequestTimer = setTimeout(() => {
      finishRequest(() => {
        wx.showToast({
          title: "订阅请求超时，请重试",
          icon: "none"
        })
      })
    }, SUBSCRIPTION_REQUEST_TIMEOUT_MS)

    try {
      wx.requestSubscribeMessage({
        tmplIds: [templateId],
        success: (result) => {
          finishRequest(() => {
            const choice = result && result[templateId]
            wx.showToast({
              title: choice === "accept" ? "已订阅下一次状态提醒" : "未开启状态提醒",
              icon: "none"
            })
          })
        },
        fail: (error) => {
          finishRequest(() => {
            const message = error && (error.errMsg || error.message)
            if (message && String(message).includes("cancel")) {
              return
            }
            wx.showToast({
              title: "订阅失败，请稍后重试",
              icon: "none"
            })
          })
        },
        complete: () => {
          finishRequest()
        }
      })
    } catch (error) {
      finishRequest(() => {
        wx.showToast({
          title: "订阅失败，请稍后重试",
          icon: "none"
        })
      })
    }
  },

  loadDetail() {
    if (
      this.data.editing ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling
    ) {
      return
    }
    const requestId = Number(this._detailRequestId || 0) + 1
    this._detailRequestId = requestId
    this.clearDetailLoadTimer()

    if (!this.data.id) {
      this.setData({
        initialLoading: false,
        loading: false,
        cancelling: false
      })
      return
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        initialLoading: false,
        loading: false,
        cancelling: false,
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
        cancelling: false,
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
            cancelling: false,
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
    if (
      !this.data.canCancel ||
      this.data.loading ||
      this.data.editing ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling ||
      !this.data.id
    ) {
      return
    }

    const bookingId = String(this.data.id || "").trim()
    const confirmationSerial = Number(this._cancelConfirmationSerial || 0) + 1
    this._cancelConfirmationSerial = confirmationSerial
    this.setData({ cancelling: true })
    let confirmationSettled = false
    const finishConfirmation = () => {
      if (
        confirmationSettled ||
        confirmationSerial !== this._cancelConfirmationSerial ||
        !this.isBookingDetailActive()
      ) {
        return false
      }
      confirmationSettled = true
      this.setData({ cancelling: false })
      return true
    }
    try {
      wx.showModal({
        title: "取消预约",
        content: "已完成的预约不可取消。确认取消当前预约吗？",
        confirmText: "确认取消",
        confirmColor: "#d46868",
        success: (res) => {
          if (
            !this.isBookingDetailActive() ||
            confirmationSerial !== this._cancelConfirmationSerial ||
            !finishConfirmation()
          ) {
            return
          }

          if (
            !res ||
            !res.confirm ||
            this.data.loading ||
            this.data.editing ||
            this.data.saving ||
            this.data.subscriptionRequesting ||
            !this.data.canCancel ||
            String(this.data.id || "").trim() !== bookingId
          ) {
            return
          }

          this._cancelConfirmationSerial = confirmationSerial + 1
          this.cancelBooking(bookingId)
        },
        fail: () => {
          finishConfirmation()
        }
      })
    } catch (error) {
      finishConfirmation()
    }
  },

  handleStartEdit() {
    if (
      !this.data.canEdit ||
      this.data.loading ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling
    ) {
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
    if (
      !this.data.editing ||
      this.data.loading ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling
    ) {
      return
    }
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
    if (
      this.data.loading ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling
    ) {
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
    if (
      !this.data.editing ||
      this.data.loading ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling ||
      !this.data.id
    ) {
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
            this.setData({ editing: false })
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

  cancelBooking(id) {
    const bookingId = String(id || this.data.id || "").trim()
    if (
      !bookingId ||
      this.data.loading ||
      this.data.editing ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling ||
      !this.data.canCancel
    ) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const cancelSerial = Number(this._cancelRequestSerial || 0) + 1
    this._cancelRequestSerial = cancelSerial
    this.clearCancelRequestTimer()
    this.setData({ loading: true, cancelling: true })

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
      this.setData({ loading: false, cancelling: false })
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
          this.setData({ loading: false, cancelling: false })
          return
        }

        wx.showToast({
          title: "预约已取消",
          icon: "none"
        })
        this.setData({ cancelling: false })
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

  clearSubscriptionRequestTimer() {
    if (!this._subscriptionRequestTimer) {
      return
    }
    clearTimeout(this._subscriptionRequestTimer)
    this._subscriptionRequestTimer = null
  },

  handleRetryLoad() {
    if (
      this.data.loading ||
      this.data.editing ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling
    ) {
      return
    }
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
        if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
          return
        }
        wx.showToast({
          title: "预约编号已复制",
          icon: "none"
        })
      },
      fail: () => {
        if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
          return
        }
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
        if (!this.isBookingDetailActive()) {
          return
        }
        wx.showToast({
          title: "车辆详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleBackBookings() {
    if (!this.isBookingDetailActive()) {
      return
    }
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          if (!this.isBookingDetailActive()) {
            return
          }
          wx.redirectTo({
            url: "/pages/bookings/bookings",
            fail: () => {
              if (!this.isBookingDetailActive()) {
                return
              }
              wx.reLaunch({
                url: "/pages/bookings/bookings",
                fail: () => {
                  if (!this.isBookingDetailActive()) {
                    return
                  }
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
        if (!this.isBookingDetailActive()) {
          return
        }
        wx.reLaunch({
          url: "/pages/bookings/bookings",
          fail: () => {
            if (!this.isBookingDetailActive()) {
              return
            }
            wx.showToast({
              title: "返回预约列表失败",
              icon: "none"
            })
          }
        })
      }
    })
  },

  isBookingDetailActive() {
    return this._bookingDetailUnloaded !== true
  }
})
