const { closePageCsvPreview, openPageCsvPreview, beginPageCsvFileAction, isPageCsvFileActionActive, markPageCsvFileRemoved, applyPageCsvFileRemoval } = require("../../shared/pageCsvFileActions")
const { removeCsvFile } = require("../../shared/csvFile")
const { createPerformanceHelpers } = require('../../shared/performance');
const { formatToastTitle } = require("../../shared/uiFeedback")
const { buildVehicleDisplayIdentity } = require("../../shared/vehicle")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive,
  isPageCurrent
} = require("../../shared/pageNativeAction")
const { triggerHapticFeedback } = require("../../shared/hapticFeedback")
const { getVehicleReadinessCard } = require("../../shared/vehicleChecklist")
const { formatLocationDisplay, resolveServiceHub, hasHubCoordinates, normalizeCity } = require("../../shared/locations")
const { normalizeServiceConfig } = require("../../shared/serviceConfig")
const {
  mapStatusText,
  mapStatusClass,
  canCancelBooking,
  canEditBooking,
  buildProgressSteps,
  buildStatusGuidance: getSharedStatusGuidance
} = require("../../shared/bookingStatus")
const { formatDisplayTime } = require("../../shared/formatTime")
const { getDateSpanText } = require("../../shared/dateUtils")
const { formatYuan } = require("../../shared/rentalPricing")
const {
  buildHandoverReport,
  formatHandoverCsvContent,
  getHandoverFileName
} = require("../../shared/handoverReport")

const BOOKING_DETAIL_LOAD_TIMEOUT_MS = 15 * 1000
const BOOKING_DETAIL_MUTATION_TIMEOUT_MS = 12 * 1000
const SUBSCRIPTION_REQUEST_TIMEOUT_MS = 15 * 1000
const HANDOVER_EXPORT_TIMEOUT_MS = 15 * 1000
const SATISFACTION_TAGS = ["车况极佳", "管家专业", "准时交付", "体验尊享", "手续便捷"]
const DEFAULT_SATISFACTION_TAGS = ["车况极佳", "体验尊享"]

function buildSatisfactionTags(selectedTags) {
  return SATISFACTION_TAGS.map((label) => ({ label, selected: selectedTags.includes(label) }))
}

const buildStatusGuidance = (status) => getSharedStatusGuidance(status, { mode: "detail" })

function normalizeQuote(item) {
  const quote = item && typeof item === "object" ? item : {}
  const moneyText = (field) => quote[`${field}Cents`] !== undefined
    ? formatYuan(quote[`${field}Cents`])
    : /^\d+\.\d{2}$/.test(String(quote[`${field}Text`] || "")) ? quote[`${field}Text`] : "0.00"
  return {
    id: quote.id || "",
    rentalDays: Math.max(0, Number(quote.rentalDays || 0)),
    baseRentalText: moneyText("baseRental"),
    protectionText: moneyText("protection"),
    serviceFeeText: moneyText("serviceFee"),
    deliveryFeeText: moneyText("deliveryFee"),
    otherFeeText: moneyText("otherFee"),
    totalText: moneyText("total"),
    depositText: quote.depositText || "",
    validUntil: quote.validUntil || "",
    customerNote: quote.customerNote || "",
    adjustmentNote: quote.adjustmentNote || "",
    version: Math.max(0, Number(quote.version || 0)),
    status: quote.status || "",
    sentAtText: formatDisplayTime(quote.sentAt) || quote.sentAtText || "",
    confirmedAtText: formatDisplayTime(quote.confirmedAt) || quote.confirmedAtText || "",
    adjustmentRequestedAtText: formatDisplayTime(quote.adjustmentRequestedAt),
    expiredAtText: formatDisplayTime(quote.expiredAt)
  }
}
function getAdjustmentDraftKey(bookingId, quote) {
  if (!bookingId || !quote || !quote.id) return ""
  return JSON.stringify([String(bookingId), String(quote.id), Number(quote.version || 0)])
}
function normalizeHandover(item, booking) {
  if (!item || typeof item !== "object") return {}
  const status = String(item.status || "")
  const report = buildHandoverReport(booking, item)
  return {
    ...item,
    id: String(item.id || ""),
    stage: item.stage === "return" ? "return" : "pickup",
    stageText: item.stage === "return" ? "还车" : "取车",
    statusText: { submitted: "待我核对", confirmed: "已核对", archived: "已归档" }[status] || status,
    mileageText: report.mileageKm === null ? "里程未记录" : `${report.mileageKm} km`,
    energyText: report.energyLevelPercent === null || !report.energyType ? "能源未记录" : `${report.energyType === "electric" ? "电量" : "油量"} ${report.energyLevelPercent}%`,
    submittedAtText: formatDisplayTime(item.submittedAt),
    confirmedAtText: formatDisplayTime(item.confirmedAt),
    photos: (Array.isArray(item.photos) ? item.photos.filter((photo) => photo && photo.url) : []).map((photo) => ({
      ...photo,
      label: photo.label || (photo.angle === "front" ? "车头" : photo.angle === "rear" ? "车尾" : photo.angle === "left" ? "左侧" : photo.angle === "right" ? "右侧" : "留证视角")
    })),
    scratchItems: report.scratchItems || [],
    scratchSummary: report.scratchSummary || "",
    inspectorName: report.inspectorName || "",
    customerConfirmed: report.customerConfirmed
  }
}

function formatBookingReference(value) {
  const id = String(value || "").trim()
  return id ? `#${id.slice(-8).toUpperCase()}` : "—"
}
function getJourneySpanText(startDate, endDate) {
  return getDateSpanText(startDate, endDate, "日期待确认")
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
    location: booking.location || "",
    pickupLocation: booking.pickupLocation || "",
    returnLocation: booking.returnLocation || "",
    category: booking.category || "",
    note: booking.note || "",
    latestQuoteId: booking.latestQuoteId || "",
    latestQuoteVersion: Math.max(0, Number(booking.latestQuoteVersion || 0)),
    latestPickupHandoverId: booking.latestPickupHandoverId || "",
    latestReturnHandoverId: booking.latestReturnHandoverId || "",
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
    contactSaveError: "",
    saving: false,
    cancelling: false,
    bookingStatusTemplateId: "",
    subscriptionEnabled: false,
    subscriptionRequesting: false,
    quoteResponding: false,
    handoverResponding: false,
    handovers: { pickup: {}, return: {} },
    handoverList: [],
    exportingHandover: false,
    exportedHandoverStage: "",
    exportedHandoverPath: "",
    exportedHandoverFileName: "",
    servicePhone: "",
    emergencyPhone: "",
    serviceHubs: [],
    operationConfigFailed: false,
    pickupHub: null,
    canNavigatePickup: false,
    bookingOccupancyTooLong: false,
    latestQuote: {},
    adjustmentNote: "",
    checklistExpanded: true,
    readinessCard: null,
    readinessExpanded: false,
    showVoucherModal: false,
    pickupLocationDisplay: "",
    satisfactionRating: 5,
    satisfactionTags: buildSatisfactionTags(DEFAULT_SATISFACTION_TAGS),
    selectedSatisfactionTags: DEFAULT_SATISFACTION_TAGS.slice(),
    satisfactionNote: "",
    reviewSubmitted: false,
    reviewSubmitting: false,
    editForm: {
      userName: "",
      phone: "",
      city: "",
      note: ""
    }
  },
  applyState(patch) { this.setData(patch) },
  onLoad(options) {
    activatePageNativeActions(this)
    const perf = createPerformanceHelpers(this); this._perf = perf; this.applyState = perf.applyState; this.flushStateNow = perf.flushStateNow;
    this._bookingDetailUnloaded = false
    const id = String((options && options.id) || "").trim()
    this.setData({
      id,
      initialLoading: Boolean(id)
    })
    const app = typeof getApp === "function" ? getApp() : null
    const env = app && app.globalData && app.globalData.cloudEnvId ? app.globalData.cloudEnvId : undefined
    if (typeof wx !== "undefined" && wx.cloud && typeof wx.cloud.init === "function") {
      try {
        wx.cloud.init({
          env,
          traceUser: true
        })
      } catch (error) {}
    }
    try {
      if (id && typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
        const cached = wx.getStorageSync(`booking_detail_${id}`)
        if (cached && cached.booking && cached.booking.id) {
          this.applyBooking(cached.booking, cached.latestQuote, cached.handovers)
        }
      }
    } catch (e) {}
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
        if (booking.id && this.data.booking.id !== booking.id) {
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
    applyPageCsvFileRemoval(this)
    const refreshConfig = this._operationConfigSeenOnShow || this.data.operationConfigFailed
    this._operationConfigSeenOnShow = true
    if (refreshConfig) this.loadNotificationConfig({ force: this.data.operationConfigFailed })
    if (this._cancelModalNeedsReset) {
      this._cancelModalNeedsReset = false
      this._cancelConfirmationSerial = Number(this._cancelConfirmationSerial || 0) + 1
      this.applyState({ cancelling: false })
    }
    if (this._handoverExportNeedsReset) {
      this._handoverExportNeedsReset = false
      this.setData({ exportingHandover: false })
    }
    const quoteConflict = this._quoteResponseConflictPending
    if (quoteConflict) {
      if (quoteConflict === getAdjustmentDraftKey(this.data.id, this.data.latestQuote) && this.data.booking.status === "quoted") {
        if (isPageCurrent(this)) {
          this._quoteResponseConflictPending = ""
          wx.showToast({ title: "申请已更新，请核对", icon: "none" })
        }
        return
      }
      this._quoteResponseConflictPending = ""
    }
    if (
      this.data.id &&
      !this.data.loading &&
      !this.data.editing &&
      !this.data.saving &&
      !this.data.subscriptionRequesting &&
      !this.data.cancelling &&
      !this.data.quoteResponding
      && !this.data.handoverResponding
    ) {
      this.loadDetail()
    }
  },
  onPullDownRefresh() {
    if (
      this.data.editing ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling ||
      this.data.quoteResponding ||
      this.data.handoverResponding ||
      this.data.loading
    ) {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh()
      }
      return
    }
    this.loadNotificationConfig({ force: true })
    this.loadDetail({
      done: () => {
        if (typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh()
        }
      }
    })
  },
  onHide() { closePageCsvPreview(this) },
  handleCloseCsvPreview() { closePageCsvPreview(this) },
  onUnload() {
    closePageCsvPreview(this, { unload: true })
    cancelPageNativeActions(this)
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
    this._quoteResponseRequestId = Number(this._quoteResponseRequestId || 0) + 1
    this._quoteResponseConflictPending = ""
    this._handoverResponseRequestId = Number(this._handoverResponseRequestId || 0) + 1
    this.cancelOperationConfigRequest()
    this.finishDetailLoadEffects()
    this.clearDetailLoadTimer()
    this.clearSaveRequestTimer()
    this.clearCancelRequestTimer()
    this.clearSubscriptionRequestTimer()
    this.clearQuoteResponseTimer()
    this.clearHandoverResponseTimer()
    if (this._handoverExportTimer) {
      clearTimeout(this._handoverExportTimer)
      this._handoverExportTimer = null
    }
    if (this._perf && typeof this._perf.dispose === 'function') try { this._perf.dispose(); } catch(e) {}
  },
  finishDetailLoadEffects() {
    this.clearDetailLoadTimer()
    if (typeof this._detailLoadDone === "function") {
      const done = this._detailLoadDone
      this._detailLoadDone = null
      try {
        done()
      } catch (error) {}
    }
  },
  applyBooking(booking, latestQuote, handovers) {
    const quote = normalizeQuote(latestQuote)
    this._quoteResponseConflictPending = ""
    const adjustmentDraftKey = getAdjustmentDraftKey(booking.id, quote)
    const preserveAdjustmentDraft = Boolean(adjustmentDraftKey) && booking.status === "quoted" && quote.status === "sent" &&
      this._adjustmentDraftQuoteKey === adjustmentDraftKey
    const adjustmentNote = preserveAdjustmentDraft
      ? this.data.adjustmentNote
      : quote.status === "adjustment_requested" ? quote.adjustmentNote : ""
    if (!preserveAdjustmentDraft) this._adjustmentDraftQuoteKey = ""
    const pickupHandover = normalizeHandover(handovers && handovers.pickup, booking)
    const returnHandover = normalizeHandover(handovers && handovers.return, booking)
    let savedReview = null
    if (booking && booking.id && typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
      try {
        savedReview = wx.getStorageSync(`booking_review_${booking.id}`)
      } catch (e) {}
    }
    const hasSavedReview = Boolean(savedReview && savedReview.rating)
    const preserveReviewDraft = Boolean(booking.id) && !hasSavedReview && !this.data.reviewSubmitted &&
      this._satisfactionDraftBookingId === String(booking.id || "")
    const selectedSatisfactionTags = hasSavedReview && Array.isArray(savedReview.tags)
      ? savedReview.tags.filter((tag) => SATISFACTION_TAGS.includes(tag))
      : preserveReviewDraft
        ? this.data.selectedSatisfactionTags.slice()
        : DEFAULT_SATISFACTION_TAGS.slice()
    if (!preserveReviewDraft) this._satisfactionDraftBookingId = ""
    this.applyState({
      booking,
      initialLoading: false,
      loadFailed: false,
      loading: false,
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
      quoteResponding: false,
      latestQuote: quote,
      handoverResponding: false,
      handovers: {
        pickup: pickupHandover,
        return: returnHandover
      },
      handoverList: [pickupHandover, returnHandover].filter((item) => item.id),
      adjustmentNote,
      readinessCard: getVehicleReadinessCard({ name: booking.vehicleName, category: booking.category }),
      bookingOccupancyTooLong: (Date.parse(`${booking.endDate}T00:00:00.000Z`) - Date.parse(`${booking.startDate}T00:00:00.000Z`)) / 86400000 + 1 > 47,
      pickupLocationDisplay: formatLocationDisplay(booking.pickupLocation || booking.location, booking.city),
      reviewSubmitted: hasSavedReview,
      satisfactionRating: hasSavedReview ? savedReview.rating : preserveReviewDraft ? this.data.satisfactionRating : 5,
      selectedSatisfactionTags,
      satisfactionTags: buildSatisfactionTags(selectedSatisfactionTags),
      satisfactionNote: hasSavedReview ? (savedReview.note || "") : preserveReviewDraft ? this.data.satisfactionNote : "",
      editForm: {
        userName: booking.userName,
        phone: booking.phone,
        city: booking.city,
        note: booking.note
      }
    })
    this.syncPickupHub()
    if (booking && booking.id && typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
      try {
        wx.setStorageSync(`booking_detail_${booking.id}`, {
          booking,
          latestQuote: quote,
          handovers: { pickup: pickupHandover, return: returnHandover }
        })
      } catch (e) {}
    }
  },
  loadNotificationConfig(options) {
    this.cancelOperationConfigRequest()
    const handleUnavailable = () => {
      this.applyState({ operationConfigFailed: true, servicePhone: "", emergencyPhone: "", serviceHubs: [], bookingStatusTemplateId: "", subscriptionEnabled: false })
      this.syncPickupHub()
    }
    this._cancelOperationConfigRequest = requestOperationConfig({
      force: Boolean(options && options.force),
      onSuccess: (config) => {
        const templateId = String(config.bookingStatusTemplateId || "").trim()
        const serviceConfig = normalizeServiceConfig(config)
        this.setData({
          operationConfigFailed: false,
          bookingStatusTemplateId: templateId,
          subscriptionEnabled: Boolean(templateId),
          servicePhone: String(config.servicePhone || "").trim(),
          emergencyPhone: serviceConfig.emergencyPhone,
          serviceHubs: serviceConfig.serviceHubs
        })
        this.syncPickupHub()
      },
      onFailure: handleUnavailable,
      onInvalidated: handleUnavailable
    })
  },
  syncPickupHub() {
    const booking = this.data.booking || {}
    const pickupHub = resolveServiceHub(booking.pickupLocation || booking.location, booking.city, this.data.serviceHubs)
    this.applyState({ pickupHub, canNavigatePickup: hasHubCoordinates(pickupHub) })
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
    this.applyState({ subscriptionRequesting: true })
    let settled = false
    const finishRequest = (callback) => {
      if (settled || this._subscriptionRequestId !== requestId) {
        return false
      }
      settled = true
      this.clearSubscriptionRequestTimer()
      this.applyState({ subscriptionRequesting: false })
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
  loadDetail(options) {
    if (
      this.data.editing ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling
    ) {
      if (options && typeof options.done === "function") {
        try { options.done() } catch (e) {}
      }
      return
    }
    const requestId = Number(this._detailRequestId || 0) + 1
    this._detailRequestId = requestId
    this.finishDetailLoadEffects()
    if (!this.data.id) {
      this.applyState({
        initialLoading: false,
        loading: false,
        cancelling: false
      })
      if (options && typeof options.done === "function") {
        try { options.done() } catch (e) {}
      }
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.applyState({
        initialLoading: false,
        loading: false,
        cancelling: false,
        loadFailed: true,
        loadErrorText: "云能力未初始化，请稍后重试"
      })
      if (options && typeof options.done === "function") {
        try { options.done() } catch (e) {}
      }
      return
    }
    this._detailLoadDone = options && typeof options.done === "function" ? options.done : null
    this.applyState({
      loading: true,
      loadFailed: false
    })
    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._detailRequestId) {
        return false
      }
      settled = true
      this.finishDetailLoadEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      if (isPageCurrent(this)) wx.showToast({
        title: "加载失败",
        icon: "none"
      })
      this.applyState({
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
          if (typeof wx !== "undefined" && typeof wx.removeStorageSync === "function") {
            try { wx.removeStorageSync(`booking_detail_${bookingId}`) } catch (e) {}
          }
          if (isPageCurrent(this)) wx.showToast({
          title: formatToastTitle(result && result.message, "预约不存在"),
            icon: "none"
          })
          this.applyState({
            initialLoading: false,
            loading: false,
            cancelling: false,
            loadFailed: result && result.code !== "NOT_FOUND",
            loadErrorText: (result && result.message) || "预约详情加载失败，请稍后重试"
          })
          return
        }
        this.applyBooking(normalizeBooking(current), result.latestQuote, result.handovers)
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
  handleAdjustmentInput(event) {
    if (this.data.quoteResponding || this.data.loading) return
    this._adjustmentDraftQuoteKey = getAdjustmentDraftKey(this.data.id, this.data.latestQuote)
    this.setData({ adjustmentNote: String(event.detail && event.detail.value || "").slice(0, 200) })
  },
  handleConfirmQuote() {
    if (this.data.quoteResponding || this.data.loading || this.data.cancelling || this.data.saving || this.data.editing || this.data.subscriptionRequesting || this.data.handoverResponding || this.data.booking.status !== "quoted" || !this.data.latestQuote.id) return
    if (this.data.bookingOccupancyTooLong) {
      wx.showToast({ title: "长租请联系顾问", icon: "none" })
      return
    }
    const quoteId = this.data.latestQuote.id
    const bookingId = this.data.id
    const action = beginPageNativeAction(this, { requireCurrent: true, exclusiveKey: "quote-confirmation" })
    wx.showModal({
      title: "确认报价",
      content: "确认当前费用方案？确认成功后将保留所选档期，但不代表已经付款或签署合同。",
      confirmText: "确认方案",
      confirmColor: "#528fff",
      success: (res) => {
        if (!isPageNativeActionActive(this, action)) return
        if (this.data.id !== bookingId || this.data.latestQuote.id !== quoteId || this.data.booking.status !== "quoted") {
          wx.showToast({ title: "报价已更新，请核对", icon: "none" })
          return
        }
        if (res && res.confirm) this.respondToQuote("confirm")
      }
    })
  },
  handleRequestQuoteAdjustment() {
    if (this.data.quoteResponding || this.data.loading || this.data.cancelling || this.data.saving || this.data.editing || this.data.subscriptionRequesting || this.data.handoverResponding || this.data.booking.status !== "quoted" || !this.data.latestQuote.id) return
    if (!String(this.data.adjustmentNote || "").trim()) {
      wx.showToast({ title: "请填写需要调整的内容", icon: "none" })
      return
    }
    this.respondToQuote("requestAdjustment")
  },
  respondToQuote(action) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function" || this.data.quoteResponding || this.data.cancelling || this.data.loading || this.data.saving || this.data.editing || this.data.subscriptionRequesting || this.data.handoverResponding) return
    const bookingId = this.data.id
    const quoteId = this.data.latestQuote.id
    const adjustmentNote = action === "requestAdjustment" ? String(this.data.adjustmentNote || "").trim() : ""
    const requestId = Number(this._quoteResponseRequestId || 0) + 1
    this._quoteResponseRequestId = requestId
    this._quoteResponseConflictPending = ""
    this.clearQuoteResponseTimer()
    this.applyState({ quoteResponding: true })
    let settled = false
    const finish = () => {
      if (settled || requestId !== this._quoteResponseRequestId) return false
      settled = true
      this.clearQuoteResponseTimer()
      return true
    }
    const fail = (message) => {
      if (!finish()) return
      this.applyState({ quoteResponding: false })
      if (isPageCurrent(this)) wx.showToast({ title: formatToastTitle(message, "报价操作失败"), icon: "none" })
    }
    this._quoteResponseTimer = setTimeout(() => fail("报价操作超时，请重试"), BOOKING_DETAIL_MUTATION_TIMEOUT_MS)
    try {
      wx.cloud.callFunction({
        name: "bookingQuoteRespond",
        data: {
          bookingId,
          quoteId,
          action,
          adjustmentNote
        },
        success: (res) => {
          if (!finish()) return
          if (this.data.id !== bookingId || this.data.latestQuote.id !== quoteId) { this.applyState({ quoteResponding: false }); return }
          const result = res && res.result
          if (!result || !result.ok) {
            this.applyState({ quoteResponding: false })
            if (result && result.code === "VERSION_CONFLICT" && !isPageCurrent(this)) {
              this._quoteResponseConflictPending = getAdjustmentDraftKey(bookingId, this.data.latestQuote)
            }
            if (isPageCurrent(this)) wx.showToast({
              title: result && result.code === "VERSION_CONFLICT" ? "申请已更新，请核对" : formatToastTitle(result && result.message, "报价操作失败"),
              icon: "none"
            })
            if (isPageCurrent(this) && result && ["QUOTE_EXPIRED", "QUOTE_INVALID", "STATUS_NOT_ALLOWED"].includes(result.code)) this.loadDetail()
            return
          }
          const status = result.bookingStatus || (action === "confirm" ? "confirmed" : "adjustment_requested")
          const savedAdjustmentNote = typeof result.adjustmentNote === "string" ? result.adjustmentNote : adjustmentNote
          this.applyBooking({ ...this.data.booking, status }, { ...this.data.latestQuote, status, ...(action === "requestAdjustment" ? { adjustmentNote: savedAdjustmentNote } : {}) }, this.data.handovers)
          if (isPageCurrent(this)) {
            wx.showToast({ title: action === "confirm" ? "档期已保留，尚未付款" : "调整申请已提交", icon: "none" })
            this.loadDetail()
          }
        },
        fail: (error) => fail(error && (error.errMsg || error.message))
      })
    } catch (error) {
      fail(error && (error.errMsg || error.message))
    }
  },
  clearQuoteResponseTimer() {
    if (!this._quoteResponseTimer) return
    clearTimeout(this._quoteResponseTimer)
    this._quoteResponseTimer = null
  },
  handleCancel() {
    if (
      !this.data.canCancel ||
      this.data.loading ||
      this.data.editing ||
      this.data.saving ||
      this.data.subscriptionRequesting ||
      this.data.cancelling ||
      this.data.quoteResponding ||
      this.data.handoverResponding ||
      !this.data.id
    ) {
      return
    }
    const bookingId = String(this.data.id || "").trim()
    const modalAction = beginPageNativeAction(this, { requireCurrent: true, exclusiveKey: "booking-cancellation" })
    const confirmationSerial = Number(this._cancelConfirmationSerial || 0) + 1
    this._cancelConfirmationSerial = confirmationSerial
    this.applyState({ cancelling: true })
    let confirmationSettled = false
    const finishConfirmation = () => {
      if (
        confirmationSettled ||
        confirmationSerial !== this._cancelConfirmationSerial ||
        !this.isBookingDetailActive()
      ) {
        return false
      }
      if (!isPageNativeActionActive(this, modalAction)) {
        this._cancelModalNeedsReset = true
        return false
      }
      confirmationSettled = true
      this.applyState({ cancelling: false })
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
            this.data.quoteResponding ||
            this.data.handoverResponding ||
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
    this._contactEditBaseline = {
      id: this.data.id,
      values: Object.fromEntries(["userName", "phone", "city", "note"].map((key) => [key, String(booking[key] || "").trim()]))
    }
    this.setData({
      editing: true,
      contactSaveError: "",
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
      editing: false,
      contactSaveError: ""
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
    const baseline = this._contactEditBaseline && this._contactEditBaseline.id === bookingId
      ? this._contactEditBaseline.values
      : Object.fromEntries(["userName", "phone", "city", "note"].map((key) => [key, String((this.data.booking && this.data.booking[key]) || "").trim()]))
    this._saveRequestSerial = saveSerial
    this.clearSaveRequestTimer()
    this.applyState({ saving: true, contactSaveError: "" })
    let settled = false
    const finishRequest = () => {
      if (settled || saveSerial !== this._saveRequestSerial) {
        return false
      }
      settled = true
      this.clearSaveRequestTimer()
      return String(this.data.id || "").trim() === bookingId
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.applyState({ saving: false, contactSaveError: String(message || "保存失败，请重试") })
      if (isPageCurrent(this)) wx.showToast({
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
        ...submittedForm,
        expectedValues: { ...baseline }
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.applyState({ saving: false, contactSaveError: (result && result.message) || "保存失败，请重试" })
          if (isPageCurrent(this)) wx.showToast({
            title: formatToastTitle(result && result.message, "保存失败"),
            icon: "none"
          })
          if (result && ["STATUS_CONFLICT", "STATUS_NOT_ALLOWED"].includes(result.code)) {
            this.applyState({ editing: false })
            if (isPageCurrent(this)) this.loadDetail()
          }
          return
        }
        if (isPageCurrent(this)) wx.showToast({
          title: result.updated ? "联系信息已更新" : "信息未发生变化",
          icon: "none"
        })
        const savedBooking = { ...this.data.booking, ...submittedForm }
        if (normalizeCity(this.data.booking.city) !== normalizeCity(submittedForm.city)) {
          savedBooking.pickupLocation = ""
          savedBooking.location = ""
        }
        if (result.contact && typeof result.contact === "object") {
          for (const key of ["userName", "phone", "city", "note", "pickupLocation", "returnLocation", "location"]) {
            if (typeof result.contact[key] === "string") savedBooking[key] = result.contact[key]
          }
        }
        if (result.status) savedBooking.status = result.status
        this.applyBooking(savedBooking, this.data.latestQuote, this.data.handovers)
        if (isPageCurrent(this)) this.loadDetail()
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
      this.data.quoteResponding ||
      this.data.handoverResponding ||
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
    this.applyState({ loading: true, cancelling: true })
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
      if (isPageCurrent(this)) wx.showToast({
        title: formatToastTitle(message, "取消失败"),
        icon: "none"
      })
      this.applyState({ loading: false, cancelling: false })
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
        if (String(this.data.id || "").trim() !== bookingId) { this.applyState({ loading: false, cancelling: false }); return }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          if (isPageCurrent(this)) wx.showToast({
          title: formatToastTitle(result && result.message, "取消失败"),
            icon: "none"
          })
          this.applyState({ loading: false, cancelling: false })
          if (isPageCurrent(this) && result && ["STATUS_CONFLICT", "STATUS_NOT_ALLOWED"].includes(result.code)) this.loadDetail()
          return
        }
        if (isPageCurrent(this)) wx.showToast({
          title: "预约已取消",
          icon: "none"
        })
        this.applyBooking({ ...this.data.booking, status: "cancelled" }, this.data.latestQuote, this.data.handovers)
        if (isPageCurrent(this)) this.loadDetail()
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
  handleConfirmHandover(event) {
    if (this.data.loading || this.data.handoverResponding) return
    const stage = String(event.currentTarget.dataset.stage || "")
    const record = this.data.handovers && this.data.handovers[stage]
    if (!record || !record.id || record.status !== "submitted") return
    const bookingId = this.data.id
    const modalAction = beginPageNativeAction(this, { requireCurrent: true, exclusiveKey: "handover-confirmation" })
    wx.showModal({
      title: `核对${record.stageText}记录`,
      content: "请确认页面中的照片、里程、油量/电量和说明与交接时所见一致。本操作仅为内容核对，不是电子签章或合同签署。",
      confirmText: "确认已核对",
      confirmColor: "#528fff",
      success: (choice) => {
        if (!isPageNativeActionActive(this, modalAction) || !choice || !choice.confirm) return
        if (this.data.id !== bookingId || !this.data.handovers[stage] || this.data.handovers[stage].id !== record.id) {
          wx.showToast({ title: "记录已更新，请核对", icon: "none" })
          return
        }
        if (this.data.handoverResponding) return
        const requestId = Number(this._handoverResponseRequestId || 0) + 1
        this._handoverResponseRequestId = requestId
        this.clearHandoverResponseTimer()
        this.applyState({ handoverResponding: true })
        let settled = false
        const finish = () => {
          if (settled || this._handoverResponseRequestId !== requestId || !this.isBookingDetailActive()) return false
          settled = true
          this.clearHandoverResponseTimer()
          this.applyState({ handoverResponding: false })
          return true
        }
        const fail = (message) => {
          if (!finish()) return
          if (isPageCurrent(this)) wx.showToast({ title: formatToastTitle(message, "核对失败，请重试"), icon: "none" })
        }
        this._handoverResponseTimer = setTimeout(() => fail("核对超时，请重试"), BOOKING_DETAIL_MUTATION_TIMEOUT_MS)
        const request = {
          name: "bookingHandover",
          data: { action: "confirm", bookingId, handoverId: record.id, stage },
          success: (res) => {
            if (!finish()) return
            const result = res && res.result
            if (!result || !result.ok) {
              if (isPageCurrent(this)) wx.showToast({ title: formatToastTitle(result && result.message, "核对失败"), icon: "none" })
              if (result && ["VERSION_CONFLICT", "STATUS_NOT_ALLOWED"].includes(result.code)) this.loadDetail()
              return
            }
            if (isPageCurrent(this)) wx.showToast({ title: result.duplicate ? "已完成核对" : "交接记录已核对", icon: "none" })
            this.loadDetail()
          },
          fail: () => fail("核对失败，请重试"),
          complete: () => { if (!settled) fail("核对失败，请重试") }
        }
        try { wx.cloud.callFunction(request) } catch (error) { fail("核对失败，请重试") }
      }
    })
  },
  clearHandoverResponseTimer() {
    if (this._handoverResponseTimer) clearTimeout(this._handoverResponseTimer)
    this._handoverResponseTimer = null
  },
  handlePreviewHandoverPhoto(event) {
    const stage = String(event.currentTarget.dataset.stage || "")
    const current = String(event.currentTarget.dataset.url || "")
    const record = this.data.handovers && this.data.handovers[stage]
    const urls = record && Array.isArray(record.photos) ? record.photos.map((photo) => photo.url).filter(Boolean) : []
    const action = beginPageNativeAction(this, { requireCurrent: true })
    if (current && wx.previewImage) wx.previewImage({
      current,
      urls: urls.length ? urls : [current],
      fail: () => {
        if (isPageNativeActionActive(this, action)) wx.showToast({ title: "图片预览失败", icon: "none" })
      }
    })
  },
  handleHandoverImageError() {},
  handleExportHandoverReport(event) {
    if (this.data.exportingHandover) return
    const action = beginPageNativeAction(this, { exclusiveKey: "handover-export", requireCurrent: true })
    const stage = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.stage) || "").trim()
    const handoverId = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id
    const handovers = this.data.handovers || {}
    const list = Array.isArray(this.data.handoverList) ? this.data.handoverList : []
    const target = (stage && handovers[stage]) || (handoverId && list.find((h) => h.id === handoverId)) || list[0] || {}
    if (!target || !target.id) {
      if (isPageNativeActionActive(this, action)) wx.showToast({ title: "暂无交接记录", icon: "none" })
      return
    }
    this.setData({ exportingHandover: true })
    const csvContent = formatHandoverCsvContent(this.data.booking, target)
    const fileName = getHandoverFileName(this.data.booking, target)
    let fs
    try { fs = wx.getFileSystemManager && wx.getFileSystemManager() } catch (error) {}
    if (!fs || !wx.env || !wx.env.USER_DATA_PATH) {
      this.setData({ exportingHandover: false })
      if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: "系统暂不支持文件导出", icon: "none" })
      return
    }
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
    let settled = false
    let writeSuccessHandled = false
    const finish = () => {
      if (settled) return false
      settled = true
      if (this._handoverExportTimer) clearTimeout(this._handoverExportTimer)
      this._handoverExportTimer = null
      if (!isPageNativeActionActive(this, action)) { this._handoverExportNeedsReset = true; return false }
      return true
    }
    const fail = () => {
      if (!finish()) return
      this.setData({ exportingHandover: false })
      wx.showToast({ title: "留证单导出失败", icon: "none" })
    }
    this._handoverExportTimer = setTimeout(fail, HANDOVER_EXPORT_TIMEOUT_MS)
    const writeOptions = {
      filePath,
      data: csvContent,
      encoding: "utf8",
      success: () => {
        if (writeSuccessHandled) return
        writeSuccessHandled = true
        if (!finish()) {
          if (typeof fs.unlink === "function") fs.unlink({ filePath, fail: () => {} })
          return
        }
        const previousPath = this.data.exportedHandoverPath
        closePageCsvPreview(this)
        triggerHapticFeedback("medium")
        this.setData({
          exportingHandover: false,
          exportedHandoverStage: target.stage || stage || "pickup",
          exportedHandoverPath: filePath,
          exportedHandoverFileName: fileName
        })
        if (previousPath && previousPath !== filePath && typeof fs.unlink === "function") {
          try { fs.unlink({ filePath: previousPath, fail: () => {} }) } catch (error) {}
        }
        if (typeof wx !== "undefined" && wx.showToast) wx.showToast({ title: "留证单已导出", icon: "success" })
      },
      fail
    }
    try { fs.writeFile(writeOptions) } catch (error) { fail() }
  },
  handleOpenExportedHandover() {
    return openPageCsvPreview(this, this.data.exportedHandoverPath, this.data.exportedHandoverFileName, "exportedHandoverPath")
  },
  handleShareExportedHandover() {
    const filePath = this.data.exportedHandoverPath
    if (!filePath || typeof wx === "undefined") return
    const action = beginPageNativeAction(this, { requireCurrent: true })
    if (!isPageNativeActionActive(this, action)) return
    if (typeof wx.shareFileMessage !== "function") {
      wx.showToast({ title: "请升级微信后分享", icon: "none" })
      return
    }
    wx.shareFileMessage({
      filePath,
      fail: (error) => {
        if (isPageNativeActionActive(this, action) && !String(error && error.errMsg || "").toLowerCase().includes("cancel")) wx.showToast({ title: "分享文件失败", icon: "none" })
      }
    })
  },
  handleDeleteExportedHandover() {
    const filePath = this.data.exportedHandoverPath
    if (!filePath) return
    const action = beginPageNativeAction(this, { requireCurrent: true })
    if (!isPageNativeActionActive(this, action)) return
    const fileAction = beginPageCsvFileAction(this, filePath, {
      pathField: "exportedHandoverPath",
      clearFields: ["exportedHandoverFileName", "exportedHandoverStage"]
    })
    return removeCsvFile(filePath).then(() => {
      if (!markPageCsvFileRemoved(this, fileAction) || !isPageNativeActionActive(this, action)) return
      applyPageCsvFileRemoval(this)
      wx.showToast({ title: "缓存已清理", icon: "none" })
    }).catch(() => {
      if (!isPageCsvFileActionActive(this, fileAction) || !isPageNativeActionActive(this, action)) return
      wx.showToast({ title: "清理失败", icon: "none" })
    })
  },
  handleCopyHandoverSummary(event) {
    const stage = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.stage) || "").trim()
    const target = (stage && this.data.handovers && this.data.handovers[stage]) || (this.data.handoverList && this.data.handoverList[0]) || {}
    const b = this.data.booking || {}
    if (!target || !target.id) {
      wx.showToast({ title: "暂无留证记录", icon: "none" })
      return
    }
    const report = buildHandoverReport(b, target)
    const lines = [
      `【爱迦租车·验车留证事实备忘】`,
      `交接阶段: ${target.stageText || "取车"}记录`,
      `预约单号: ${formatBookingReference(b.id)}`,
      `尊享车型: ${b.vehicleName || "爱迦座驾"}`,
      `车牌号码: ${b.plateNumber || target.plateNumber || "车牌保密"}`,
      `交接里程: ${report.mileageKm === null ? "未记录" : `${report.mileageKm} km`}`,
      `能源状态: ${report.energyLevelPercent === null || !report.energyType ? "未记录" : `${report.energyTypeText} ${report.energyLevelPercent}%`}`,
      `外观环检: ${report.damageNote}`,
      `验车专员: ${report.inspectorName || "未记录"}`,
      `核验时间: ${target.confirmedAtText || target.submittedAtText || "待核验"}`
    ]
    if (report.scratchSummary && report.scratchSummary !== report.damageNote) lines.push(`补充环检: ${report.scratchSummary}`)
    if (typeof wx === "undefined" || typeof wx.setClipboardData !== "function") return
    wx.setClipboardData({
      data: lines.join("\n"),
      success: () => {
        if (!this.isBookingDetailActive() || !isPageCurrent(this)) return
        triggerHapticFeedback("light")
        wx.showToast({ title: "留证事实已复制", icon: "none" })
      },
      fail: () => {
        if (!this.isBookingDetailActive() || !isPageCurrent(this)) return
        wx.showToast({ title: "复制失败，请重试", icon: "none" })
      }
    })
  },
  handleEmergencyCall() {
    if (!this.isBookingDetailActive()) return
    const phoneNumber = String(this.data.emergencyPhone || "").trim()
    if (!/^\+?[0-9-]{6,20}$/.test(phoneNumber)) {
      wx.showToast({ title: "救援电话暂不可用", icon: "none" })
      return
    }
    triggerHapticFeedback("medium")
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.makePhoneCall({
      phoneNumber,
      fail: (error) => {
        if (isPageNativeActionActive(this, action) && !String(error && error.errMsg || "").includes("cancel")) wx.showToast({ title: "拨号失败，请重试", icon: "none" })
      }
    })
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
  handleCopyBookingId(event) {
    const isVoucher = Boolean(event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.type === "voucher")
    const b = this.data.booking || {}
    const servicePhone = String(this.data.servicePhone || "").trim()
    const voucherText = `【爱迦出行凭证】\n预约单号：${this.data.bookingReference || b.id}\n专属座驾：${b.vehicleName || "预约车辆"}\n用车日期：${b.startDate} 至 ${b.endDate}\n取车网点：${this.data.pickupLocationDisplay || "取车地点待确认"}\n出行人：${b.userName} (${b.phone})${servicePhone ? `\n客服专线：${servicePhone}` : ""}`
    const id = isVoucher ? voucherText : String((b && b.id) || "").trim()
    if (!id || typeof wx.setClipboardData !== "function") {
      wx.showToast({
        title: isVoucher ? "凭证复制失败" : "预约编号复制失败",
        icon: "none"
      })
      return
    }
    wx.setClipboardData({
      data: id,
      success: () => {
        triggerHapticFeedback("light")
        if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
          return
        }
        wx.showToast({
          title: isVoucher ? "凭证信息已复制" : "预约编号已复制",
          icon: "none"
        })
      },
      fail: () => {
        if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
          return
        }
        wx.showToast({
          title: isVoucher ? "凭证复制失败" : "预约编号复制失败",
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
        if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
          return
        }
        wx.showToast({
          title: "车辆详情打开失败",
          icon: "none"
        })
      }
    })
  },
  handleAddToCalendar() {
    if (!this.isBookingDetailActive()) {
      return
    }
    const booking = this.data.booking || {}
    if (!booking.startDate || !booking.endDate) {
      wx.showToast({
        title: "缺少行程日期",
        icon: "none"
      })
      return
    }
    if (typeof wx.addPhoneCalendar !== "function") {
      wx.showToast({
        title: "系统暂不支持",
        icon: "none"
      })
      return
    }
    const parseDateToSeconds = (dateStr, hour) => {
      const parts = String(dateStr).split("-").map(Number)
      if (parts.length === 3) {
        return Math.floor(new Date(parts[0], parts[1] - 1, parts[2], hour, 0, 0).getTime() / 1000)
      }
      return Math.floor(Date.now() / 1000)
    }
    const startTime = parseDateToSeconds(booking.startDate, 10)
    const endTime = parseDateToSeconds(booking.endDate, 18)
    const vehicleName = booking.vehicleName || "尊享座驾"
    const city = String(booking.city || "").trim()
    const bookingRef = this.data.bookingReference || booking.id || ""
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.addPhoneCalendar({
      title: `爱迦租车用车 · ${vehicleName}`,
      startTime,
      endTime,
      location: (this.data.pickupHub && this.data.pickupHub.address) || booking.pickupLocation || booking.location || this.data.pickupLocationDisplay || "取车地点待确认",
      description: `预约编号：${bookingRef}。取车城市：${city}，请提前备齐身份证与驾驶证。`,
      alarm: true,
      alarmOffset: 7200,
      success: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "日程已添加",
          icon: "success"
        })
      },
      fail: (err) => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        const errMsg = String((err && (err.errMsg || err.message)) || "")
        if (errMsg.includes("cancel")) {
          return
        }
        wx.showToast({
          title: "添加未完成",
          icon: "none"
        })
      }
    })
  },
  handleOpenLocation() {
    if (!this.isBookingDetailActive()) {
      return
    }
    this.syncPickupHub()
    const hub = this.data.pickupHub
    if (!hasHubCoordinates(hub)) {
      wx.showToast({ title: "取车地点暂无导航信息", icon: "none" })
      return
    }
    const action = beginPageNativeAction(this, { requireCurrent: true })
    if (typeof wx.openLocation === "function") {
      wx.openLocation({
        latitude: Number(hub.latitude),
        longitude: Number(hub.longitude),
        name: hub.name,
        address: hub.address,
        scale: 15,
        fail: () => {
          if (!isPageNativeActionActive(this, action)) {
            return
          }
          wx.showToast({
            title: "导航打开失败",
            icon: "none"
          })
        }
      })
    } else {
      wx.showToast({
        title: "系统暂不支持",
        icon: "none"
      })
    }
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
          if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
            return
          }
          wx.redirectTo({
            url: "/pages/bookings/bookings",
            fail: () => {
              if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
                return
              }
              wx.reLaunch({
                url: "/pages/bookings/bookings",
                fail: () => {
                  if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
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
        if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
          return
        }
        wx.reLaunch({
          url: "/pages/bookings/bookings",
          fail: () => {
            if (!this.isBookingDetailActive() || !isPageCurrent(this)) {
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
  handleToggleChecklist() {
    triggerHapticFeedback("light")
    this.setData({
      checklistExpanded: !this.data.checklistExpanded
    })
  },
  handleToggleReadiness() {
    triggerHapticFeedback("light")
    this.setData({
      readinessExpanded: !this.data.readinessExpanded
    })
  },
  handleViewVoucherCard() {
    this.setData({ showVoucherModal: true })
  },
  handleCloseVoucherCard() {
    this.setData({ showVoucherModal: false })
  },
  handleRatingTap(event) {
    if (this.data.reviewSubmitted) return
    const rating = Math.max(1, Math.min(5, Number((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.rating) || 5)))
    triggerHapticFeedback("light")
    this.markSatisfactionDraft()
    this.setData({ satisfactionRating: rating })
  },
  handleSatisfactionTagTap(event) {
    if (this.data.reviewSubmitted) return
    const tag = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.tag) || "").trim()
    if (!SATISFACTION_TAGS.includes(tag)) return
    triggerHapticFeedback("selection")
    const current = Array.isArray(this.data.selectedSatisfactionTags) ? [...this.data.selectedSatisfactionTags] : []
    const idx = current.indexOf(tag)
    if (idx >= 0) {
      current.splice(idx, 1)
    } else {
      current.push(tag)
    }
    this.markSatisfactionDraft()
    this.setData({
      selectedSatisfactionTags: current,
      satisfactionTags: buildSatisfactionTags(current)
    })
  },
  handleSatisfactionNoteInput(event) {
    if (this.data.reviewSubmitted) return
    this.markSatisfactionDraft()
    this.setData({ satisfactionNote: String((event && event.detail && event.detail.value) || "").slice(0, 150) })
  },
  markSatisfactionDraft() {
    this._satisfactionDraftBookingId = String((this.data.booking && this.data.booking.id) || this.data.id || "")
  },
  handleSubmitSatisfactionReview() {
    if (!this.isBookingDetailActive() || !isPageCurrent(this) || this.data.reviewSubmitted || this.data.reviewSubmitting) return
    triggerHapticFeedback("medium")
    const id = this.data.id || (this.data.booking && this.data.booking.id)
    if (!id) return
    this.setData({ reviewSubmitting: true })
    const reviewPayload = {
      rating: this.data.satisfactionRating,
      tags: this.data.selectedSatisfactionTags,
      note: this.data.satisfactionNote,
      submittedAt: new Date().toISOString()
    }
    try {
      if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
        throw new Error("Review storage unavailable")
      }
      wx.setStorageSync(`booking_review_${id}`, reviewPayload)
    } catch (error) {
      this.setData({ reviewSubmitting: false })
      if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
        wx.showToast({ title: "评价保存失败，请重试", icon: "none" })
      }
      return
    }
    this._satisfactionDraftBookingId = ""
    this.setData({ reviewSubmitting: false, reviewSubmitted: true })
    if (typeof wx.showToast === "function") {
      wx.showToast({ title: "感谢您的尊享评价", icon: "success" })
    }
  },
  isBookingDetailActive() {
    return this._bookingDetailUnloaded !== true
  }
})
