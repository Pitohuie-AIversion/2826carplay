const { createPerformanceHelpers } = require('../../shared/performance');
const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

const BOOKING_DETAIL_LOAD_TIMEOUT_MS = 15 * 1000
const BOOKING_DETAIL_WRITE_TIMEOUT_MS = 20 * 1000
const HANDOVER_ANGLES = [
  { angle: "front", label: "车头" },
  { angle: "rear", label: "车尾" },
  { angle: "left", label: "左侧" },
  { angle: "right", label: "右侧" }
]
const HANDOVER_MAX_IMAGE_BYTES = 10 * 1024 * 1024

const STATUS_TEXT_MAP = {
  pending: "待联系",
  contacted: "已联系",
  quoted: "已报价",
  adjustment_requested: "待调整",
  confirmed: "已确认",
  completed: "已完成",
  cancelled: "已取消"
}

const STATUS_CLASS_MAP = {
  pending: "status-pending",
  contacted: "status-contacted",
  quoted: "status-quoted",
  adjustment_requested: "status-adjustment-requested",
  confirmed: "status-confirmed",
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
  const next = typeof done === "function" ? done : () => {}
  let settled = false
  const finish = () => {
    if (settled) {
      return
    }
    settled = true
    next()
  }
  const notificationStatus = String((result && result.notificationStatus) || "")
  if (notificationStatus === "failed") {
    if (typeof wx.showModal !== "function") {
      finish()
      return
    }
    try {
      wx.showModal({
        title: "状态已更新",
        content: "预约状态已更新，但提醒发送失败。可在错误日志中查看原因。",
        confirmText: "知道了",
        confirmColor: "#528fff",
        showCancel: false,
        complete: finish
      })
    } catch (error) {
      finish()
    }
    return
  }

  const title =
    notificationStatus === "sent"
      ? "提醒已发送"
      : notificationStatus === "not_subscribed"
        ? "用户未订阅提醒"
        : "状态已更新"
  try {
    wx.showToast({
      title,
      icon: "none"
    })
  } finally {
    finish()
  }
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

function formatYuan(cents) {
  const value = Math.max(0, Number(cents || 0))
  return (value / 100).toFixed(2)
}

function normalizeQuote(item) {
  const quote = item && typeof item === "object" ? item : {}
  return {
    id: quote.id || "",
    bookingId: quote.bookingId || "",
    startDate: quote.startDate || "",
    endDate: quote.endDate || "",
    rentalDays: Math.max(0, Number(quote.rentalDays || 0)),
    baseRentalCents: Math.max(0, Number(quote.baseRentalCents || 0)),
    protectionCents: Math.max(0, Number(quote.protectionCents || 0)),
    serviceFeeCents: Math.max(0, Number(quote.serviceFeeCents || 0)),
    deliveryFeeCents: Math.max(0, Number(quote.deliveryFeeCents || 0)),
    otherFeeCents: Math.max(0, Number(quote.otherFeeCents || 0)),
    totalCents: Math.max(0, Number(quote.totalCents || 0)),
    totalText: formatYuan(quote.totalCents),
    depositText: quote.depositText || "",
    validUntil: quote.validUntil || "",
    customerNote: quote.customerNote || "",
    adjustmentNote: quote.adjustmentNote || "",
    version: Math.max(0, Number(quote.version || 0)),
    status: quote.status || "",
    statusText: {
      sent: "已发送",
      confirmed: "用户已确认",
      adjustment_requested: "用户申请调整",
      expired: "已失效"
    }[quote.status] || "草稿",
    sentAtText: formatDisplayTime(quote.sentAt),
    confirmedAtText: formatDisplayTime(quote.confirmedAt),
    adjustmentRequestedAtText: formatDisplayTime(quote.adjustmentRequestedAt),
    expiredAtText: formatDisplayTime(quote.expiredAt)
  }
}

function createQuoteForm(quote) {
  const source = quote && typeof quote === "object" ? quote : {}
  return {
    baseRentalAmount: formatYuan(source.baseRentalCents),
    protectionAmount: formatYuan(source.protectionCents),
    serviceFeeAmount: formatYuan(source.serviceFeeCents),
    deliveryFeeAmount: formatYuan(source.deliveryFeeCents),
    otherFeeAmount: formatYuan(source.otherFeeCents),
    depositText: source.depositText || "",
    validUntil: source.validUntil || "",
    customerNote: source.customerNote || ""
  }
}

function getChinaToday() {
  return new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function createHandoverForm() {
  return {
    mileageKm: "",
    energyType: "fuel",
    energyLevelPercent: "",
    damageNote: "",
    additionalNote: "",
    photos: HANDOVER_ANGLES.map((item) => ({ ...item, fileId: "", url: "" }))
  }
}

function normalizeHandover(item) {
  const record = item && typeof item === "object" ? item : {}
  const status = String(record.status || "")
  return {
    ...record,
    id: String(record.id || ""),
    stageText: record.stage === "return" ? "还车" : "取车",
    statusText: { submitted: "待用户核对", confirmed: "用户已核对", superseded: "已被新版本替代", archived: "已归档" }[status] || status,
    energyText: `${record.energyType === "electric" ? "电量" : "油量"} ${Math.max(0, Number(record.energyLevelPercent || 0))}%`,
    submittedAtText: formatDisplayTime(record.submittedAt),
    confirmedAtText: formatDisplayTime(record.confirmedAt),
    photos: Array.isArray(record.photos) ? record.photos : []
  }
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
    latestQuoteId: booking.latestQuoteId || "",
    latestQuoteVersion: Math.max(0, Number(booking.latestQuoteVersion || 0)),
    latestPickupHandoverId: booking.latestPickupHandoverId || "",
    latestPickupHandoverVersion: Math.max(0, Number(booking.latestPickupHandoverVersion || 0)),
    latestReturnHandoverId: booking.latestReturnHandoverId || "",
    latestReturnHandoverVersion: Math.max(0, Number(booking.latestReturnHandoverVersion || 0)),
    pickupHandoverConfirmedAt: booking.pickupHandoverConfirmedAt || "",
    returnHandoverConfirmedAt: booking.returnHandoverConfirmedAt || "",
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
    remarkDirty: false,
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
    coordinationUpdatedAtText: "",
    quoteLoading: false,
    quoteDirty: false,
    quoteDraft: {},
    quoteHistory: [],
    quotesUnavailable: false,
    quoteMinDate: getChinaToday(),
    quoteForm: createQuoteForm(),
    handoverLoading: false,
    handoverEnergyOptions: ["燃油", "纯电"],
    handoverStage: "pickup",
    handoverForm: createHandoverForm(),
    handoverHistory: [],
    handoverReadyForCompletion: false
  },

  applyState(patch) { this.setData(patch) },

  onLoad(options) {
    const perf = createPerformanceHelpers(this); this._perf = perf; this.applyState = perf.applyState; this.flushStateNow = perf.flushStateNow;
    activatePageNativeActions(this)
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
      const eventAction = beginPageNativeAction(this)
      const handleManageBookingDetail = (payload) => {
        if (!isPageNativeActionActive(this, eventAction)) {
          return
        }
        const booking = normalizeBooking(payload && payload.booking)
        if (
          booking.id &&
          this.data.pageAuthorized &&
          !this.data.remarkDirty &&
          !this.isBookingDetailInteractionBusy()
        ) {
          this.applyBooking(booking)
        }
      }
      this._manageBookingDetailEventChannel = eventChannel
      this._manageBookingDetailEventHandler = handleManageBookingDetail
      eventChannel.on("acceptManageBookingDetail", handleManageBookingDetail)
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
    if (
      this.data.pageAuthorized &&
      this.data.id &&
      !this.data.remarkDirty &&
      !this._bookingDetailMutationActive &&
      !this._bookingDetailStatusFeedbackPending
    ) {
      this.loadDetail()
    }
  },

  isBookingDetailInteractionBusy() {
    return Boolean(
      this.data.loading ||
      this.data.coordinationLoading ||
      this.data.quoteLoading ||
      this.data.handoverLoading ||
      this._bookingDetailMutationActive ||
      this._bookingDetailStatusFeedbackPending
    )
  },

  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    if (
      this._manageBookingDetailEventChannel &&
      typeof this._manageBookingDetailEventChannel.off === "function" &&
      this._manageBookingDetailEventHandler
    ) {
      this._manageBookingDetailEventChannel.off(
        "acceptManageBookingDetail",
        this._manageBookingDetailEventHandler
      )
    }
    this._manageBookingDetailEventChannel = null
    this._manageBookingDetailEventHandler = null
    this._bookingDetailRequestId = Number(this._bookingDetailRequestId || 0) + 1
    this._bookingDetailMutationRequestId =
      Number(this._bookingDetailMutationRequestId || 0) + 1
    this.clearBookingDetailTimer()
    this.clearBookingDetailMutationTimer()
    this._bookingDetailMutationActive = false
    this._bookingDetailStatusFeedbackPending = false
    this._handoverRequestId = Number(this._handoverRequestId || 0) + 1
    this.cleanupPendingHandoverUploads()
    if (this._perf && typeof this._perf.dispose === 'function') try { this._perf.dispose(); } catch(e) {}
  },

  applyBooking(booking, conflictResult, quoteResult, handoverResult) {
    const conflictData = conflictResult && typeof conflictResult === "object"
      ? conflictResult
      : {}
    const quoteData = quoteResult && typeof quoteResult === "object" ? quoteResult : {}
    const quoteDraft = normalizeQuote(quoteData.draft)
    const quoteHistory = Array.isArray(quoteData.history)
      ? quoteData.history.map(normalizeQuote)
      : []
    const handoverHistory = Array.isArray(handoverResult)
      ? handoverResult.map(normalizeHandover)
      : []
    const latestPickup = handoverHistory.find((item) => item.id === booking.latestPickupHandoverId)
    const latestReturn = handoverHistory.find((item) => item.id === booking.latestReturnHandoverId)
    this.applyState({
      booking,
      remarkDirty: false,
      initialLoading: false,
      loading: false,
      loadFailed: false,
      statusText: STATUS_TEXT_MAP[booking.status] || "待联系",
      statusClass: STATUS_CLASS_MAP[booking.status] || "status-pending",
      createdAtText: formatDisplayTime(booking.createdAt),
      updatedAtText: formatDisplayTime(booking.updatedAt),
      adminRemarkUpdatedAtText: formatDisplayTime(booking.adminRemarkUpdatedAt),
      coordinationUpdatedAtText: formatDisplayTime(booking.coordinationUpdatedAt),
      coordinationEditable: !["completed", "cancelled"].includes(booking.status),
      coordinationLoading: false,
      quoteLoading: false,
      quoteDirty: false,
      quoteDraft,
      quoteHistory,
      quotesUnavailable: Boolean(quoteData.unavailable),
      quoteForm: createQuoteForm(quoteDraft),
      handoverLoading: false,
      handoverHistory,
      handoverReadyForCompletion: Boolean(latestPickup && latestPickup.status === "confirmed" && latestReturn && latestReturn.status === "confirmed"),
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
    const id = String(this.data.id || "").trim()
    if (!id) {
      this.applyState({
        initialLoading: false,
        loading: false
      })
      return
    }

    if (
      this.data.coordinationLoading ||
      this.data.remarkDirty ||
      this._bookingDetailMutationActive ||
      this._bookingDetailStatusFeedbackPending
    ) {
      return
    }

    const requestId = Number(this._bookingDetailRequestId || 0) + 1
    this._bookingDetailRequestId = requestId
    this.clearBookingDetailTimer()

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.applyState({
        initialLoading: false,
        loading: false,
        loadFailed: true,
        loadErrorText: "云能力未初始化，请稍后重试"
      })
      return
    }

    this.applyState({
      loading: true,
      loadFailed: false
    })

    let settled = false
    const finishRequest = () => {
      if (settled || this._bookingDetailRequestId !== requestId) {
        return false
      }
      settled = true
      this.clearBookingDetailTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      wx.showToast({
        title: formatToastTitle(message, "加载失败"),
        icon: "none"
      })
      this.applyState({
        initialLoading: false,
        loading: false,
        loadFailed: true,
        loadErrorText: message || "预约详情加载失败，请稍后重试"
      })
    }

    this._bookingDetailTimer = setTimeout(() => {
      handleFailure("详情加载超时，请重试")
    }, BOOKING_DETAIL_LOAD_TIMEOUT_MS)

    const requestOptions = {
      name: "bookingDetail",
      data: {
        id
      },
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
          this.applyState({
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
        }, {
          draft: result.quoteDraft,
          history: result.quoteHistory,
          unavailable: result.quotesUnavailable
        }, result.handoverHistory)
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

  handleRemarkInput(event) {
    if (this.isBookingDetailInteractionBusy()) {
      return
    }
    const value = normalizeRemark(event.detail && event.detail.value)
    const savedValue = normalizeRemark(
      this.data.booking && this.data.booking.adminRemark
    )
    this.setData({
      "booking.adminRemarkDraft": value,
      remarkDirty: value !== savedValue
    })
  },

  handleSaveRemark() {
    if (
      this.data.loading ||
      this.data.coordinationLoading ||
      this._bookingDetailMutationActive ||
      !this.data.id
    ) {
      return
    }

    const id = String(this.data.id || "").trim()
    const adminRemark = normalizeRemark(this.data.booking.adminRemarkDraft)

    this.runBookingDetailMutation({
      name: "bookingUpdateAdminRemark",
      data: {
        id,
        adminRemark
      },
      startState: { loading: true },
      endState: { loading: false },
      timeoutTitle: "保存超时，请重试",
      failureFallback: "保存失败",
      onResult: (result, isCurrent) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "保存失败"),
            icon: "none"
          })
          this.applyState({ loading: false })
          return
        }

        wx.showToast({
          title: "备注已保存",
          icon: "none"
        })
        if (isCurrent()) {
          this.applyState({ remarkDirty: false, loading: false })
          this.loadDetail()
        }
      }
    })
  },

  handleQuoteInput(event) {
    if (this.isBookingDetailInteractionBusy()) return
    const field = String(event.currentTarget.dataset.field || "")
    const allowed = ["baseRentalAmount", "protectionAmount", "serviceFeeAmount", "deliveryFeeAmount", "otherFeeAmount", "depositText", "customerNote"]
    if (!allowed.includes(field)) return
    const maxLength = field === "customerNote" ? 300 : field === "depositText" ? 200 : 20
    this.setData({ [`quoteForm.${field}`]: String(event.detail && event.detail.value || "").slice(0, maxLength), quoteDirty: true })
  },

  handleQuoteValidUntilChange(event) {
    if (this.isBookingDetailInteractionBusy()) return
    this.setData({ "quoteForm.validUntil": String(event.detail && event.detail.value || ""), quoteDirty: true })
  },

  buildQuotePayload(action) {
    const form = this.data.quoteForm || {}
    return {
      action,
      bookingId: String(this.data.id || ""),
      baseRentalAmount: form.baseRentalAmount,
      protectionAmount: form.protectionAmount,
      serviceFeeAmount: form.serviceFeeAmount,
      deliveryFeeAmount: form.deliveryFeeAmount,
      otherFeeAmount: form.otherFeeAmount,
      depositText: form.depositText,
      validUntil: form.validUntil,
      customerNote: form.customerNote
    }
  },

  handleSaveQuoteDraft() {
    if (this.isBookingDetailInteractionBusy() || !this.data.id) return
    this.runBookingDetailMutation({
      name: "bookingQuoteManage",
      data: this.buildQuotePayload("saveDraft"),
      startState: { quoteLoading: true },
      endState: { quoteLoading: false },
      timeoutTitle: "报价保存超时，请重试",
      failureFallback: "报价保存失败",
      onResult: (result, isCurrent) => {
        if (!result || !result.ok) {
          wx.showToast({ title: formatToastTitle(result && result.message, "报价保存失败"), icon: "none" })
          this.applyState({ quoteLoading: false })
          return
        }
        wx.showToast({ title: "报价草稿已保存", icon: "none" })
        this.applyState({ quoteLoading: false, quoteDirty: false })
        if (isCurrent()) this.loadDetail()
      }
    })
  },

  handleSendQuote() {
    if (this.isBookingDetailInteractionBusy() || this.data.quoteDirty || !this.data.quoteDraft.id) return
    const action = beginPageNativeAction(this, { exclusiveKey: "quote-send-confirmation" })
    wx.showModal({
      title: "发送报价",
      content: `确认发送报价 v${this.data.quoteDraft.version}？发送后该版本不可修改。`,
      confirmText: "确认发送",
      confirmColor: "#528fff",
      success: (res) => {
        if (!isPageNativeActionActive(this, action) || !res || !res.confirm) return
        const requestId = `quote_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
        this.runBookingDetailMutation({
          name: "bookingQuoteManage",
          data: { action: "send", bookingId: this.data.id, requestId },
          startState: { quoteLoading: true },
          endState: { quoteLoading: false },
          timeoutTitle: "报价发送超时，请重试",
          failureFallback: "报价发送失败",
          onResult: (result, isCurrent) => {
            if (!result || !result.ok) {
              wx.showToast({ title: formatToastTitle(result && result.message, "报价发送失败"), icon: "none" })
              this.applyState({ quoteLoading: false })
              return
            }
            showStatusUpdateFeedback(result, () => {
              this.applyState({ quoteLoading: false })
              if (isCurrent()) this.loadDetail()
            })
          }
        })
      }
    })
  },

  handleExpireQuote(event) {
    if (this.isBookingDetailInteractionBusy()) return
    const quoteId = String(event.currentTarget.dataset.id || "")
    if (!quoteId) return
    this.runBookingDetailMutation({
      name: "bookingQuoteManage",
      data: { action: "expire", bookingId: this.data.id, quoteId },
      startState: { quoteLoading: true },
      endState: { quoteLoading: false },
      timeoutTitle: "报价失效操作超时",
      failureFallback: "报价失效操作失败",
      onResult: (result, isCurrent) => {
        wx.showToast({ title: formatToastTitle(result && result.message, result && result.ok ? "报价已失效" : "操作失败"), icon: "none" })
        this.applyState({ quoteLoading: false })
        if (result && result.ok && isCurrent()) this.loadDetail()
      }
    })
  },

  handleUpdateCoordination(event) {
    if (
      this.data.loading ||
      this.data.coordinationLoading ||
      this.data.quoteLoading ||
      this._bookingDetailMutationActive ||
      this.data.remarkDirty ||
      !this.data.coordinationEditable ||
      !this.data.id
    ) {
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

    const id = String(this.data.id || "").trim()
    this.runBookingDetailMutation({
      name: "bookingUpdateCoordination",
      data: {
        id,
        schedulePriority,
        coordinationStatus
      },
      startState: { coordinationLoading: true },
      endState: { coordinationLoading: false },
      timeoutTitle: "协调更新超时，请重试",
      failureFallback: "协调更新失败",
      onResult: (result, isCurrent) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "协调更新失败"),
            icon: "none"
          })
          this.applyState({ coordinationLoading: false })
          return
        }

        wx.showToast({
          title: result.changed === false ? "协调安排未变化" : "协调安排已更新",
          icon: "none"
        })
        this.applyState({ coordinationLoading: false })
        if (isCurrent()) {
          this.loadDetail()
        }
      }
    })
  },

  callPhone(value) {
    if (this.isBookingDetailInteractionBusy()) {
      return
    }
    const phone = normalizePhone(value)
    if (!phone) {
      wx.showToast({
        title: "手机号不可用",
        icon: "none"
      })
      return
    }

    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: (error) => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
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
    if (this.isBookingDetailInteractionBusy() || !id || id === this.data.id) {
      return
    }
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages/booking-manage-detail/booking-manage-detail?id=${id}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "冲突预约打开失败",
          icon: "none"
        })
      }
    })
  },

  handleCopyContact(event) {
    if (this.isBookingDetailInteractionBusy()) {
      return
    }
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

    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.setClipboardData({
      data: value,
      success: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: `${labels[field]}已复制`,
          icon: "none"
        })
      },
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: `${labels[field]}复制失败`,
          icon: "none"
        })
      }
    })
  },

  handleHandoverStageChange(event) {
    if (this.data.handoverLoading) return
    const stage = String(event.currentTarget.dataset.stage || "")
    if (!["pickup", "return"].includes(stage) || stage === this.data.handoverStage) return
    this.cleanupPendingHandoverUploads()
    this.setData({ handoverStage: stage, handoverForm: createHandoverForm() })
  },

  handleHandoverInput(event) {
    if (this.data.handoverLoading) return
    const field = String(event.currentTarget.dataset.field || "")
    if (!["mileageKm", "energyLevelPercent", "damageNote", "additionalNote"].includes(field)) return
    const maxLength = field.includes("Note") ? 500 : 8
    this.setData({ [`handoverForm.${field}`]: String(event.detail && event.detail.value || "").slice(0, maxLength) })
  },

  handleHandoverEnergyType(event) {
    if (this.data.handoverLoading) return
    const values = ["fuel", "electric"]
    this.setData({ "handoverForm.energyType": values[Number(event.detail && event.detail.value)] || "fuel" })
  },

  handleChooseHandoverPhoto(event) {
    if (this.data.handoverLoading || !wx.chooseImage || !wx.cloud || !wx.cloud.uploadFile) return
    const angle = String(event.currentTarget.dataset.angle || "")
    const index = this.data.handoverForm.photos.findIndex((item) => item.angle === angle)
    if (index < 0) return
    wx.chooseImage({
      count: 1,
      sizeType: ["compressed", "original"],
      sourceType: ["camera", "album"],
      success: (selection) => {
        const path = selection && selection.tempFilePaths && selection.tempFilePaths[0]
        const file = selection && selection.tempFiles && selection.tempFiles[0]
        const extension = String(path || "").split(".").pop().toLowerCase()
        if (!path || !["jpg", "jpeg", "png", "webp"].includes(extension) || Number(file && file.size || 0) > HANDOVER_MAX_IMAGE_BYTES) {
          wx.showToast({ title: "图片格式或大小有误", icon: "none" })
          return
        }
        const stage = this.data.handoverStage
        const cloudPath = `handover-images/${this.data.id}/${stage}/${Date.now()}_${angle}.${extension}`
        this.applyState({ handoverLoading: true })
        wx.cloud.uploadFile({
          cloudPath,
          filePath: path,
          success: (upload) => {
            const fileId = String(upload && upload.fileID || "")
            if (!fileId) {
              wx.showToast({ title: "图片上传失败", icon: "none" })
              return
            }
            const oldFileId = this.data.handoverForm.photos[index].fileId
            if (oldFileId) this.queueHandoverUploadCleanup([oldFileId], stage)
            this.setData({
              [`handoverForm.photos[${index}].fileId`]: fileId,
              [`handoverForm.photos[${index}].url`]: path
            })
          },
          fail: () => wx.showToast({ title: "图片上传失败，请重试", icon: "none" }),
          complete: () => this.applyState({ handoverLoading: false })
        })
      },
      fail: (error) => {
        if (!String(error && error.errMsg || "").includes("cancel")) wx.showToast({ title: "选择图片失败，请重试", icon: "none" })
      }
    })
  },

  queueHandoverUploadCleanup(fileList, stage) {
    const files = (Array.isArray(fileList) ? fileList : []).filter(Boolean)
    if (!files.length || !wx.cloud || !wx.cloud.callFunction) return
    wx.cloud.callFunction({
      name: "bookingHandover",
      data: { action: "cleanupUpload", bookingId: this.data.id, stage: stage || this.data.handoverStage, fileList: files },
      fail: () => {}
    })
  },

  cleanupPendingHandoverUploads() {
    const form = this.data && this.data.handoverForm
    const fileList = form && Array.isArray(form.photos) ? form.photos.map((item) => item.fileId).filter(Boolean) : []
    if (fileList.length) this.queueHandoverUploadCleanup(fileList, this.data.handoverStage)
  },

  handleSubmitHandover() {
    if (this.data.handoverLoading || this.data.booking.status !== "confirmed") return
    const form = this.data.handoverForm
    const mileageKm = Number(form.mileageKm)
    const energyLevelPercent = Number(form.energyLevelPercent)
    if (!String(form.mileageKm).trim() || !String(form.energyLevelPercent).trim() || !Number.isInteger(mileageKm) || mileageKm < 0 || !Number.isInteger(energyLevelPercent) || energyLevelPercent < 0 || energyLevelPercent > 100 || !String(form.damageNote).trim() || form.photos.some((item) => !item.fileId)) {
      wx.showToast({ title: "请完善交接信息", icon: "none" })
      return
    }
    const stage = this.data.handoverStage
    const requestId = `handover_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    const requestSerial = Number(this._handoverRequestId || 0) + 1
    this._handoverRequestId = requestSerial
    this.applyState({ handoverLoading: true })
    wx.cloud.callFunction({
      name: "bookingHandover",
      data: {
        action: "submit", bookingId: this.data.id, stage, requestId,
        mileageKm, energyType: form.energyType, energyLevelPercent,
        damageNote: String(form.damageNote).trim(), additionalNote: String(form.additionalNote).trim(),
        photos: form.photos.map((item) => ({ angle: item.angle, fileId: item.fileId }))
      },
      success: (res) => {
        if (this._handoverRequestId !== requestSerial) return
        const result = res && res.result
        if (!result || !result.ok) {
          wx.showToast({ title: formatToastTitle(result && result.message, "提交失败"), icon: "none" })
          return
        }
        this.setData({ handoverForm: createHandoverForm() })
        wx.showToast({ title: result.duplicate ? "记录已提交" : "交接记录已提交", icon: "none" })
        this._reloadHandoverAfterMutation = true
      },
      fail: () => wx.showToast({ title: "提交失败，请重试", icon: "none" }),
      complete: () => {
        if (this._handoverRequestId === requestSerial) {
          this.applyState({ handoverLoading: false })
          if (this._reloadHandoverAfterMutation) {
            this._reloadHandoverAfterMutation = false
            this.loadDetail()
          }
        }
      }
    })
  },

  handlePreviewHandoverPhoto(event) {
    const url = String(event.currentTarget.dataset.url || "")
    const urls = (event.currentTarget.dataset.urls || []).filter(Boolean)
    const action = beginPageNativeAction(this)
    if (url && wx.previewImage) wx.previewImage({
      current: url,
      urls: urls.length ? urls : [url],
      fail: () => {
        if (isPageNativeActionActive(this, action)) wx.showToast({ title: "图片预览失败", icon: "none" })
      }
    })
  },

  handleHandoverImageError() {},

  handleArchiveHandover(event) {
    if (this.data.handoverLoading) return
    const handoverId = String(event.currentTarget.dataset.id || "")
    const stage = String(event.currentTarget.dataset.stage || "")
    const action = beginPageNativeAction(this, { exclusiveKey: "handover-archive-confirmation" })
    wx.showModal({
      title: "归档交接记录",
      content: "归档会清除该版本的交接照片，文字审计信息会保留。确认继续？",
      confirmText: "确认归档",
      confirmColor: "#d46868",
      success: (choice) => {
        if (!isPageNativeActionActive(this, action) || !choice || !choice.confirm) return
        this.applyState({ handoverLoading: true })
        wx.cloud.callFunction({
          name: "bookingHandover",
          data: { action: "archive", bookingId: this.data.id, handoverId, stage },
          success: (res) => {
            const result = res && res.result
            wx.showToast({ title: result && result.ok ? "已归档并进入清理队列" : formatToastTitle(result && result.message, "归档失败"), icon: "none" })
            if (result && result.ok) this._reloadHandoverAfterMutation = true
          },
          fail: () => wx.showToast({ title: "归档失败，请重试", icon: "none" }),
          complete: () => {
            this.applyState({ handoverLoading: false })
            if (this._reloadHandoverAfterMutation) {
              this._reloadHandoverAfterMutation = false
              this.loadDetail()
            }
          }
        })
      }
    })
  },

  handleUpdateStatus(event) {
    if (
      this.data.loading ||
      this.data.coordinationLoading ||
      this.data.quoteLoading ||
      this._bookingDetailMutationActive ||
      this.data.remarkDirty ||
      !this.data.id
    ) {
      return
    }

    const status = String(event.currentTarget.dataset.status || "").trim()
    if (!status) {
      return
    }

    const statusText = STATUS_TEXT_MAP[status] || status

    const action = beginPageNativeAction(this, {
      exclusiveKey: "booking-status-confirmation"
    })
    wx.showModal({
      title: "更新状态",
      content: `确认将该预约更新为「${statusText}」？`,
      confirmText: "确认更新",
      confirmColor: status === "cancelled" ? "#d46868" : "#528fff",
      success: (res) => {
        if (!isPageNativeActionActive(this, action) || !res || !res.confirm) {
          return
        }

        this.updateStatus(status)
      }
    })
  },

  updateStatus(status) {
    if (
      this.data.loading ||
      this.data.coordinationLoading ||
      this._bookingDetailMutationActive ||
      this._bookingDetailStatusFeedbackPending ||
      this.data.remarkDirty
    ) {
      return
    }
    const id = String(this.data.id || "").trim()
    if (!id) {
      return
    }

    this.runBookingDetailMutation({
      name: "bookingUpdateStatus",
      data: {
        id,
        status
      },
      startState: { loading: true },
      endState: { loading: false },
      timeoutTitle: "更新超时，请重试",
      failureFallback: "更新失败",
      onResult: (result, isCurrent) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "更新失败"),
            icon: "none"
          })
          this.applyState({ loading: false })
          return
        }

        this.applyState({ loading: false })
        this._bookingDetailStatusFeedbackPending = true
        showStatusUpdateFeedback(result, () => {
          this._bookingDetailStatusFeedbackPending = false
          if (isCurrent()) {
            this.loadDetail()
          }
        })
      }
    })
  },

  runBookingDetailMutation(options) {
    const input = options && typeof options === "object" ? options : {}
    if (
      this.data.loading ||
      this.data.coordinationLoading ||
      this._bookingDetailMutationActive ||
      this._bookingDetailStatusFeedbackPending
    ) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      if (input.endState) {
        this.applyState(input.endState)
      }
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const requestId = Number(this._bookingDetailMutationRequestId || 0) + 1
    this._bookingDetailMutationRequestId = requestId
    this._bookingDetailMutationActive = true
    this.clearBookingDetailMutationTimer()
    if (input.startState) {
      this.applyState(input.startState)
    }

    let settled = false
    const isCurrent = () =>
      this._bookingDetailMutationRequestId === requestId
    const finishRequest = () => {
      if (settled || !isCurrent()) {
        return false
      }
      settled = true
      this._bookingDetailMutationActive = false
      this.clearBookingDetailMutationTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      if (input.endState) {
        this.applyState(input.endState)
      }
      wx.showToast({
        title: formatToastTitle(message, input.failureFallback || "操作失败"),
        icon: "none"
      })
    }

    this._bookingDetailMutationTimer = setTimeout(() => {
      handleFailure(input.timeoutTitle || "操作超时，请重试")
    }, BOOKING_DETAIL_WRITE_TIMEOUT_MS)

    const requestOptions = {
      name: input.name,
      data: input.data,
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (typeof input.onResult === "function") {
          input.onResult(result, isCurrent)
        }
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

  clearBookingDetailTimer() {
    if (this._bookingDetailTimer) {
      clearTimeout(this._bookingDetailTimer)
      this._bookingDetailTimer = null
    }
  },

  clearBookingDetailMutationTimer() {
    if (this._bookingDetailMutationTimer) {
      clearTimeout(this._bookingDetailMutationTimer)
      this._bookingDetailMutationTimer = null
    }
  },

  handleRetryLoad() {
    if (this.isBookingDetailInteractionBusy() || this.data.remarkDirty) {
      return
    }
    this.loadDetail()
  },

  handleBackManage() {
    const action = beginPageNativeAction(this)
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          if (!isPageNativeActionActive(this, action)) {
            return
          }
          wx.redirectTo({
            url: "/pages/booking-manage/booking-manage",
            fail: () => {
              if (!isPageNativeActionActive(this, action)) {
                return
              }
              wx.reLaunch({
                url: "/pages/booking-manage/booking-manage",
                fail: () => {
                  if (!isPageNativeActionActive(this, action)) {
                    return
                  }
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
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.reLaunch({
          url: "/pages/booking-manage/booking-manage",
          fail: () => {
            if (!isPageNativeActionActive(this, action)) {
              return
            }
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
