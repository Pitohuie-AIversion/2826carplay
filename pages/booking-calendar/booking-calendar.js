const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { buildMonthView, normalizeMonthKey, shiftMonth } = require("../../shared/bookingCalendar")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

const CURRENT_MONTH_KEY = normalizeMonthKey("")
const BOOKING_CALENDAR_LOAD_TIMEOUT_MS = 15 * 1000

const STATUS_LABELS = {
  pending: "待联系",
  contacted: "已联系",
  completed: "已完成"
}

function formatBooking(item) {
  const status = String(item.status || "pending")
  return {
    ...item,
    statusLabel: STATUS_LABELS[status] || "待处理",
    statusClass: `status-${status}`
  }
}

Page({
  data: {
    pageAuthorized: false,
    loading: true,
    loadError: "",
    monthKey: "",
    currentMonthKey: CURRENT_MONTH_KEY,
    isCurrentMonth: true,
    monthTitle: "",
    selectedDate: "",
    weekdayLabels: ["日", "一", "二", "三", "四", "五", "六"],
    calendarCells: [],
    selectedBookings: [],
    allBookings: [],
    summary: {
      bookingCount: 0,
      pendingCount: 0,
      vehicleCount: 0,
      conflictDayCount: 0
    },
    selectedConflictCount: 0,
    truncated: false
  },

  onLoad() {
    activatePageNativeActions(this)
    this.setData({ monthKey: this.data.currentMonthKey, isCurrentMonth: true })
    requirePagePermission(this, {
      required: "canManageBookings",
      noPermissionMessage: "无权查看预约日历",
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

  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    this._bookingCalendarRequestId =
      Number(this._bookingCalendarRequestId || 0) + 1
    this.finishBookingCalendarRequestEffects()
  },

  handlePreviousMonth() {
    this.changeMonth(-1)
  },

  handleNextMonth() {
    this.changeMonth(1)
  },

  handleCurrentMonth() {
    if (this.data.monthKey === this.data.currentMonthKey) {
      return
    }
    this.setData({
      monthKey: this.data.currentMonthKey,
      selectedDate: "",
      isCurrentMonth: true
    })
    this.fetchBookings()
  },

  changeMonth(offset) {
    const monthKey = shiftMonth(this.data.monthKey, offset)
    this.setData({
      monthKey,
      selectedDate: "",
      isCurrentMonth: monthKey === this.data.currentMonthKey
    })
    this.fetchBookings()
  },

  handleDateTap(event) {
    const date = String(event.currentTarget.dataset.date || "")
    if (!date) {
      return
    }
    this.setData({ selectedDate: date })
    this.applyCalendar()
  },

  handleBookingTap(event) {
    const id = String(event.currentTarget.dataset.id || "")
    if (!id) {
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
          title: "预约详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleRetry() {
    this.fetchBookings()
  },

  applyCalendar() {
    const view = buildMonthView(
      this.data.monthKey,
      this.data.allBookings,
      this.data.selectedDate
    )
    this.setData({
      monthKey: view.monthKey,
      isCurrentMonth: view.monthKey === this.data.currentMonthKey,
      monthTitle: view.monthTitle,
      selectedDate: view.selectedDate,
      calendarCells: view.cells,
      selectedBookings: view.selectedBookings.map(formatBooking),
      selectedConflictCount: view.selectedConflictCount,
      summary: view.summary
    })
  },

  fetchBookings(done) {
    this.finishBookingCalendarRequestEffects()
    const requestId = Number(this._bookingCalendarRequestId || 0) + 1
    this._bookingCalendarRequestId = requestId
    this._bookingCalendarRequestDone =
      typeof done === "function" ? done : null

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        loadError: "云能力未初始化"
      })
      this.finishBookingCalendarRequestEffects()
      return
    }

    const monthKey = String(this.data.monthKey || "")
    this.setData({
      loading: true,
      loadError: ""
    })
    let settled = false
    const finishRequest = () => {
      if (settled || this._bookingCalendarRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishBookingCalendarRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        loading: false,
        loadError: message || "预约日历加载失败"
      })
    }

    this._bookingCalendarRequestTimer = setTimeout(() => {
      handleFailure("日历加载超时，请重试")
    }, BOOKING_CALENDAR_LOAD_TIMEOUT_MS)

    const requestOptions = {
      name: "bookingCalendarList",
      data: {
        month: monthKey
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            loading: false,
            loadError: (result && result.message) || "预约日历加载失败"
          })
          return
        }
        this.setData({
          loading: false,
          loadError: "",
          allBookings: Array.isArray(result.list) ? result.list : [],
          truncated: Boolean(result.truncated)
        })
        this.applyCalendar()
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      },
      complete: () => {}
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  finishBookingCalendarRequestEffects() {
    if (this._bookingCalendarRequestTimer) {
      clearTimeout(this._bookingCalendarRequestTimer)
      this._bookingCalendarRequestTimer = null
    }
    if (typeof this._bookingCalendarRequestDone === "function") {
      const done = this._bookingCalendarRequestDone
      this._bookingCalendarRequestDone = null
      done()
    }
  }
})
