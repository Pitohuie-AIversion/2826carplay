const { createPerformanceHelpers } = require('../../shared/performance');
const { formatToastTitle } = require("../../shared/uiFeedback")
const { buildVehicleDisplayIdentity } = require("../../shared/vehicle")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const { onNetworkReconnect } = require("../../shared/networkStatus")
const { mapStatusText, mapStatusClass, canCancelBooking } = require("../../shared/bookingStatus")
const BOOKINGS_LOAD_TIMEOUT_MS = 15 * 1000
const BOOKING_CANCEL_TIMEOUT_MS = 12 * 1000



function buildStatusGuidance(status) {
  const value = String(status || "pending").trim() || "pending"
  const guidanceMap = {
    pending: {
      title: "等待顾问联系",
      desc: "预约已提交，请保持手机畅通；联系前可修改资料或取消预约。",
      tone: "pending"
    },
    contacted: {
      title: "正在确认行程",
      desc: "顾问已联系，请按沟通结果确认档期、价格与取还车安排。",
      tone: "contacted"
    },
    quoted: { title: "报价待确认", desc: "请进入详情核对费用并确认或申请调整。", tone: "quoted" },
    adjustment_requested: { title: "报价调整中", desc: "顾问正在根据你的说明重新报价。", tone: "adjustment" },
    confirmed: { title: "报价已确认", desc: "当前方案已确认但尚未付款，请关注后续安排。", tone: "confirmed" },
    completed: {
      title: "本次行程已完成",
      desc: "预约流程已结束，可返回车库继续浏览其他车辆。",
      tone: "completed"
    },
    cancelled: {
      title: "本次预约已取消",
      desc: "该记录已结束，如仍有用车需求可重新选择车辆提交预约。",
      tone: "cancelled"
    }
  }
  return guidanceMap[value] || guidanceMap.pending
}

function buildJourneyProgress(status) {
  const value = String(status || "pending").trim() || "pending"
  const progressMap = {
    pending: {
      stageText: "第 1 阶段 · 等待联系",
      width: "4%",
      tone: "pending",
      stepOneClass: "journey-step-current",
      stepTwoClass: "journey-step-upcoming",
      stepThreeClass: "journey-step-upcoming"
    },
    contacted: {
      stageText: "第 2 阶段 · 行程确认",
      width: "50%",
      tone: "contacted",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-current",
      stepThreeClass: "journey-step-upcoming"
    },
    quoted: {
      stageText: "第 2 阶段 · 报价确认",
      width: "67%",
      tone: "quoted",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-current",
      stepThreeClass: "journey-step-upcoming"
    },
    adjustment_requested: {
      stageText: "第 2 阶段 · 报价调整",
      width: "67%",
      tone: "adjustment",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-current",
      stepThreeClass: "journey-step-upcoming"
    },
    confirmed: {
      stageText: "第 3 阶段 · 方案已确认",
      width: "90%",
      tone: "confirmed",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-complete",
      stepThreeClass: "journey-step-current"
    },
    completed: {
      stageText: "第 3 阶段 · 行程完成",
      width: "100%",
      tone: "completed",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-complete",
      stepThreeClass: "journey-step-current"
    },
    cancelled: {
      stageText: "流程已结束",
      width: "100%",
      tone: "cancelled",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-upcoming",
      stepThreeClass: "journey-step-cancelled"
    }
  }
  return progressMap[value] || progressMap.pending
}

function buildListSummary(list) {
  return (Array.isArray(list) ? list : []).reduce(
    (summary, item) => {
      const status = String((item && item.status) || "pending").trim()
      if (status === "completed") {
        summary.completed += 1
      } else if (status === "cancelled") {
        summary.cancelled += 1
      } else {
        summary.ongoing += 1
      }
      return summary
    },
    {
      ongoing: 0,
      completed: 0,
      cancelled: 0
    }
  )
}

function filterBookings(list, filter) {
  const source = Array.isArray(list) ? list : []
  if (filter === "ongoing") {
    return source.filter((item) => !["completed", "cancelled"].includes(item.status))
  }
  if (filter === "completed") {
    return source.filter((item) => item.status === "completed")
  }
  if (filter === "cancelled") {
    return source.filter((item) => item.status === "cancelled")
  }
  return source
}

const FILTER_LABELS = {
  all: "全部预约",
  ongoing: "进行中",
  completed: "已完成",
  cancelled: "已取消"
}

Page({
  data: {
    initialLoading: true,
    loading: false,
    loadFailed: false,
    loadErrorText: "预约列表加载失败，请稍后重试",
    list: [],
    visibleList: [],
    currentFilter: "all",
    currentFilterLabel: FILTER_LABELS.all,
    listSummary: {
      ongoing: 0,
      completed: 0,
      cancelled: 0
    },
    page: 0,
    pageSize: 20,
    hasMore: false
  },

  applyState(patch) { this.setData(patch) },

  onLoad() {
    const perf = createPerformanceHelpers(this); this._perf = perf; this.applyState = perf.applyState; this.flushStateNow = perf.flushStateNow;
    activatePageNativeActions(this)
    const app = typeof getApp === "function" ? getApp() : null
    const env =
      app &&
      app.globalData &&
      app.globalData.cloudEnvId
        ? app.globalData.cloudEnvId
        : undefined

    if (typeof wx !== "undefined" && wx.cloud && typeof wx.cloud.init === "function") {
      try {
        wx.cloud.init({
          env,
          traceUser: true
        })
      } catch (error) {}
    }

    try {
      if (typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
        const snapshot = wx.getStorageSync("bookings_last_snapshot")
        if (Array.isArray(snapshot) && snapshot.length > 0) {
          this.applyBookingList(snapshot, {
            initialLoading: false,
            loading: false,
            loadFailed: false,
            page: 0,
            hasMore: true
          })
        }
      }
    } catch (e) {}

    this._unsubscribeNetwork = onNetworkReconnect(() => {
      if (this.data.loadError) {
        this.loadList()
      }
    })
  },

  onReachBottom() {
    this.handleLoadMore()
  },

  onShow() {
    if (this.data.loading || this._bookingCancelTimer) {
      return
    }
    const now = Date.now()
    const isFresh =
      Boolean(this._lastBookingsLoadedAt) &&
      now - this._lastBookingsLoadedAt < 30 * 1000 &&
      Array.isArray(this.data.list) &&
      this.data.list.length > 0
    if (!isFresh) {
      this.loadList()
    }
  },

  onPullDownRefresh() {
    if (this.data.loading || this._bookingCancelTimer) {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh()
      }
      return
    }
    this.loadList({
      done: () => {
        if (typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh()
        }
      }
    })
  },

  onUnload() {
    cancelPageNativeActions(this)
    if (typeof this._unsubscribeNetwork === "function") {
      this._unsubscribeNetwork()
      this._unsubscribeNetwork = null
    }
    this._bookingsRequestId = Number(this._bookingsRequestId || 0) + 1
    this._bookingCancelSerial = Number(this._bookingCancelSerial || 0) + 1
    this.finishBookingsLoadEffects()
    this.clearBookingCancelTimer()
    if (this._perf && typeof this._perf.dispose === 'function') try { this._perf.dispose(); } catch(e) {}
  },

  finishBookingsLoadEffects() {
    this.clearBookingsLoadTimer()
    if (typeof this._bookingsLoadDone === "function") {
      const done = this._bookingsLoadDone
      this._bookingsLoadDone = null
      try {
        done()
      } catch (error) {}
    }
  },

  loadList(input) {
    const append = Boolean(input && input.append)
    const nextPage = append ? this.data.page + 1 : 0
    const requestId = Number(this._bookingsRequestId || 0) + 1
    this._bookingsRequestId = requestId
    this.finishBookingsLoadEffects()

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.applyState({
        initialLoading: false,
        loading: false,
        loadFailed: true,
        loadErrorText: "云能力未初始化，请稍后重试",
        list: [],
        visibleList: [],
        listSummary: buildListSummary([]),
        page: 0,
        hasMore: false
      })
      if (input && typeof input.done === "function") {
        try {
          input.done()
        } catch (error) {}
      }
      return
    }

    this._bookingsLoadDone = input && typeof input.done === "function" ? input.done : null
    this.applyState({
      loading: true,
      loadFailed: false
    })

    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._bookingsRequestId) {
        return false
      }
      settled = true
      this.finishBookingsLoadEffects()
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
      this.applyState({
        initialLoading: false,
        loading: false,
        loadFailed: true,
        loadErrorText: String(message || "预约列表加载失败，请稍后重试"),
        list: append ? this.data.list : [],
        visibleList: append ? this.data.visibleList : [],
        listSummary: append ? this.data.listSummary : buildListSummary([]),
        page: append ? this.data.page : 0,
        hasMore: append ? this.data.hasMore : false
      })
    }

    this._bookingsLoadTimer = setTimeout(() => {
      handleFailure("预约列表加载超时，请检查网络后重试")
    }, BOOKINGS_LOAD_TIMEOUT_MS)

    const requestOptions = {
      name: "bookingMyList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "加载失败"),
            icon: "none"
          })
          this.applyState({
            initialLoading: false,
            loading: false,
            loadFailed: true,
            loadErrorText: (result && result.message) || "预约列表加载失败，请稍后重试",
            list: append ? this.data.list : [],
            visibleList: append ? this.data.visibleList : [],
            listSummary: append ? this.data.listSummary : buildListSummary([]),
            page: append ? this.data.page : 0,
            hasMore: append ? this.data.hasMore : false
          })
          return
        }

        const rawList = Array.isArray(result.list) ? result.list : []
        const list = rawList.map((item) => {
          const vehicleIdentity = buildVehicleDisplayIdentity(item.vehicleName)
          return {
            ...item,
            ...vehicleIdentity,
            vehicleReference: item.vehicleReference || vehicleIdentity.vehicleReference,
            statusText: mapStatusText(item.status),
            statusClass: mapStatusClass(item.status),
            canCancel: canCancelBooking(item.status),
            statusGuidance: buildStatusGuidance(item.status),
            journeyProgress: buildJourneyProgress(item.status)
          }
        })
        const nextList = append ? this.data.list.concat(list) : list
        if (!append && typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
          try { wx.setStorageSync("bookings_last_snapshot", nextList) } catch (e) {}
        }
        this.applyBookingList(nextList, {
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          initialLoading: false,
          loading: false,
          loadFailed: false
        })
      },
      fail: (error) => {
        handleFailure((error && (error.errMsg || error.message)) || "预约列表加载失败，请稍后重试")
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure((error && (error.errMsg || error.message)) || "预约列表加载失败，请稍后重试")
    }
  },

  clearBookingsLoadTimer() {
    if (!this._bookingsLoadTimer) {
      return
    }
    clearTimeout(this._bookingsLoadTimer)
    this._bookingsLoadTimer = null
  },

  applyBookingList(list, options) {
    const input = options && typeof options === "object" ? options : {}
    const filter = Object.prototype.hasOwnProperty.call(FILTER_LABELS, input.filter)
      ? input.filter
      : this.data.currentFilter
    const nextList = Array.isArray(list) ? list : []
    const patch = {
      list: nextList,
      visibleList: filterBookings(nextList, filter),
      listSummary: buildListSummary(nextList),
      currentFilter: filter,
      currentFilterLabel: FILTER_LABELS[filter]
    }
    if (Number.isInteger(input.page)) {
      patch.page = input.page
    }
    if (typeof input.hasMore === "boolean") {
      patch.hasMore = input.hasMore
    }
    if (typeof input.initialLoading !== "undefined") {
      patch.initialLoading = input.initialLoading
    }
    if (typeof input.loading !== "undefined") {
      patch.loading = input.loading
    }
    if (typeof input.loadFailed !== "undefined") {
      patch.loadFailed = input.loadFailed
    }
    this._lastBookingsLoadedAt = Date.now()
    this.applyState(patch)
  },

  handleFilterTap(event) {
    const filter = String(event.currentTarget.dataset.filter || "")
    if (
      !Object.prototype.hasOwnProperty.call(FILTER_LABELS, filter) ||
      filter === this.data.currentFilter
    ) {
      return
    }
    this.applyBookingList(this.data.list, {
      filter
    })
  },

  handleShowAllBookings() {
    if (this.data.currentFilter !== "all") {
      this.applyBookingList(this.data.list, {
        filter: "all"
      })
    }
  },

  handleLoadMore() {
    if (this.data.loading || !this.data.hasMore) {
      return
    }

    this.loadList({ append: true })
  },

  handleViewDetail(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (!id) {
      return
    }

    const current = this.data.list.find((item) => item.id === id)

    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages/booking-detail/booking-detail?id=${id}`,
      success: (res) => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        if (current && res && res.eventChannel) {
          res.eventChannel.emit("acceptBookingDetail", {
            booking: current
          })
        }
      },
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "页面跳转失败",
          icon: "none"
        })
      }
    })
  },

  handleCancel(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (!id || this.data.loading) {
      return
    }

    const action = beginPageNativeAction(this, {
      exclusiveKey: "booking-cancel-confirmation"
    })
    wx.showModal({
      title: "取消预约",
      content: "已完成的预约不可取消。确认取消当前预约吗？",
      confirmText: "确认取消",
      confirmColor: "#d46868",
      success: (res) => {
        if (!isPageNativeActionActive(this, action) || !res || !res.confirm) {
          return
        }

        this.cancelBooking(id)
      }
    })
  },

  cancelBooking(id) {
    const bookingId = String(id || "").trim()
    if (!bookingId || this.data.loading) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const cancelSerial = Number(this._bookingCancelSerial || 0) + 1
    this._bookingCancelSerial = cancelSerial
    this.clearBookingCancelTimer()
    this.applyState({
      loading: true
    })

    let settled = false
    const finishRequest = () => {
      if (settled || cancelSerial !== this._bookingCancelSerial) {
        return false
      }
      settled = true
      this.clearBookingCancelTimer()
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
      this.applyState({
        loading: false
      })
    }

    this._bookingCancelTimer = setTimeout(() => {
      handleFailure("取消预约超时，请重试")
    }, BOOKING_CANCEL_TIMEOUT_MS)

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
          this.applyState({
            loading: false
          })
          return
        }

        wx.showToast({
          title: "预约已取消",
          icon: "none"
        })
        this.applyState({ loading: false })
        this.loadList()
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

  clearBookingCancelTimer() {
    if (!this._bookingCancelTimer) {
      return
    }
    clearTimeout(this._bookingCancelTimer)
    this._bookingCancelTimer = null
  },

  handleBackGarage() {
    const action = beginPageNativeAction(this)
    wx.redirectTo({
      url: "/pages/garage/garage",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.reLaunch({
          url: "/pages/garage/garage",
          fail: () => {
            if (!isPageNativeActionActive(this, action)) {
              return
            }
            wx.showToast({
              title: "返回车库失败",
              icon: "none"
            })
          }
        })
      }
    })
  },

  handleRetryLoad() {
    if (this.data.loading || this._bookingCancelTimer) {
      return
    }
    this.loadList()
  }
})
