const { formatToastTitle } = require("../../shared/uiFeedback")
const { buildVehicleDisplayIdentity } = require("../../shared/vehicle")

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

  onLoad() {
    const app = getApp()
    const env =
      app &&
      app.globalData &&
      app.globalData.cloudEnvId
        ? app.globalData.cloudEnvId
        : undefined

    if (wx.cloud && typeof wx.cloud.init === "function") {
      try {
        wx.cloud.init({
          env,
          traceUser: true
        })
      } catch (error) {}
    }
  },

  onShow() {
    this.loadList()
  },

  loadList(input) {
    const append = Boolean(input && input.append)
    const nextPage = append ? this.data.page + 1 : 0

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
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
      return
    }

    this.setData({
      loading: true,
      loadFailed: false
    })

    wx.cloud.callFunction({
      name: "bookingMyList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "加载失败"),
            icon: "none"
          })
          this.setData({
            initialLoading: false,
            loading: false,
            loadFailed: true,
            loadErrorText: (result && result.message) || "预约列表加载失败，请稍后重试",
            list: append ? this.data.list : [],
            visibleList: append ? this.data.visibleList : [],
            listSummary: append ? this.data.listSummary : buildListSummary([]),
            page: 0,
            hasMore: false
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
        this.applyBookingList(nextList, {
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore)
        })
        this.setData({
          initialLoading: false,
          loading: false,
          loadFailed: false
        })
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
          loadErrorText: (error && (error.errMsg || error.message)) || "预约列表加载失败，请稍后重试",
          list: append ? this.data.list : [],
          visibleList: append ? this.data.visibleList : [],
          listSummary: append ? this.data.listSummary : buildListSummary([]),
          page: 0,
          hasMore: false
        })
      }
    })
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
    this.setData(patch)
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

    wx.navigateTo({
      url: `/pages/booking-detail/booking-detail?id=${id}`,
      success: (res) => {
        if (current && res && res.eventChannel) {
          res.eventChannel.emit("acceptBookingDetail", {
            booking: current
          })
        }
      },
      fail: () => {
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

    wx.showModal({
      title: "取消预约",
      content: "已完成的预约不可取消。确认取消当前预约吗？",
      confirmText: "确认取消",
      confirmColor: "#d46868",
      success: (res) => {
        if (!res.confirm) {
          return
        }

        this.cancelBooking(id)
      }
    })
  },

  cancelBooking(id) {
    this.setData({
      loading: true
    })

    wx.cloud.callFunction({
      name: "bookingCancel",
      data: { id },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "取消失败"),
            icon: "none"
          })
          this.setData({
            loading: false
          })
          return
        }

        wx.showToast({
          title: "预约已取消",
          icon: "none"
        })
        this.loadList()
      },
      fail: (error) => {
        wx.showToast({
          title: "取消失败",
          icon: "none"
        })
        this.setData({
          loading: false
        })
      }
    })
  },

  handleBackGarage() {
    wx.redirectTo({
      url: "/pages/garage/garage",
      fail: () => {
        wx.reLaunch({
          url: "/pages/garage/garage",
          fail: () => {
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
    this.loadList()
  }
})
