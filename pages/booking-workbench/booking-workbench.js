const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const {
  buildBookingWorkbench,
  normalizeUsablePhone
} = require("../../shared/bookingWorkbench")

const WORKBENCH_LOAD_TIMEOUT_MS = 15 * 1000
const WORKBENCH_WRITE_TIMEOUT_MS = 20 * 1000

const STATUS_LABELS = {
  pending: "待联系",
  contacted: "已联系",
  quoted: "已报价",
  adjustment_requested: "待调整",
  confirmed: "已确认"
}

const FILTER_OPTIONS = [
  { key: "todo", label: "全部待办" },
  { key: "pending", label: "待启动" },
  { key: "coordinating", label: "协调中" },
  { key: "priority", label: "优先" },
  { key: "overdue", label: "超时" },
  { key: "pickupAttention", label: "用车提醒" },
  { key: "contactIssue", label: "号码异常" },
  { key: "standby", label: "候补" }
]

const SORT_OPTIONS = [
  { key: "smart", label: "智能排序", hint: "优先处理超时、临近用车、号码异常与高优先级预约" },
  { key: "waiting", label: "等待最久", hint: "按提交时间从早到晚排列" },
  { key: "pickup", label: "用车日期", hint: "按预计用车日期从近到远排列" }
]

const PRIORITY_OPTIONS = [
  { key: "priority", label: "优先" },
  { key: "normal", label: "常规" },
  { key: "standby", label: "候补" }
]

function formatSyncTime(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")
  const second = `${date.getSeconds()}`.padStart(2, "0")
  return `${month}-${day} ${hour}:${minute}:${second}`
}

function formatQueueItem(item) {
  const priority =
    PRIORITY_OPTIONS.find((option) => option.key === item.schedulePriority) ||
    PRIORITY_OPTIONS[1]
  const normalizedPhone = normalizeUsablePhone(item.phone)
  return {
    ...item,
    vehicleName: item.vehicleName || "车辆预约",
    userName: item.userName || "未填写姓名",
    phone: item.phone || "",
    phoneDisplay: normalizedPhone || "手机号待补充",
    phoneAvailable: Boolean(normalizedPhone),
    city: item.city || "未填写城市",
    startDate: item.startDate || "—",
    endDate: item.endDate || "—",
    adminRemark: String(item.adminRemark || "").trim(),
    priorityLabel: priority.label,
    statusLabel: STATUS_LABELS[item.status] || "待处理",
    statusClass: `status-${item.status || "pending"}`
  }
}

function filterQueueByKeyword(queue, keyword) {
  const tokens = String(keyword || "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)

  if (!tokens.length) {
    return queue
  }

  return queue.filter((item) => {
    const searchableFields = [
      item.id,
      item.vehicleName,
      item.userName,
      item.phone,
      item.city,
      item.adminRemark
    ].map((value) => String(value || "").toLowerCase())

    return tokens.every((token) =>
      searchableFields.some((field) => field.includes(token))
    )
  })
}

function getPickupTimestamp(value) {
  const date = String(value || "").trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return Number.MAX_SAFE_INTEGER
  }
  const timestamp = new Date(`${date}T00:00:00.000Z`).getTime()
  return Number.isFinite(timestamp) ? timestamp : Number.MAX_SAFE_INTEGER
}

function sortQueue(queue, mode) {
  if (mode === "smart") {
    return queue
  }

  return queue
    .map((item, index) => ({
      item,
      index
    }))
    .sort((left, right) => {
      if (mode === "waiting") {
        const leftTime = left.item.createdTimestamp || Number.MAX_SAFE_INTEGER
        const rightTime = right.item.createdTimestamp || Number.MAX_SAFE_INTEGER
        return leftTime - rightTime || left.index - right.index
      }

      const pickupDifference =
        getPickupTimestamp(left.item.startDate) -
        getPickupTimestamp(right.item.startDate)
      if (pickupDifference) {
        return pickupDifference
      }
      const leftTime = left.item.createdTimestamp || Number.MAX_SAFE_INTEGER
      const rightTime = right.item.createdTimestamp || Number.MAX_SAFE_INTEGER
      return leftTime - rightTime || left.index - right.index
    })
    .map((entry) => entry.item)
}

Page({
  data: {
    pageAuthorized: false,
    loading: true,
    refreshing: false,
    loadError: "",
    selectedMode: "todo",
    allBookings: [],
    queue: [],
    filterOptions: FILTER_OPTIONS,
    sortOptions: SORT_OPTIONS,
    summary: {
      todo: 0,
      pending: 0,
      priority: 0,
      overdue: 0,
      pickupAttention: 0,
      contactIssue: 0,
      standby: 0,
      coordinating: 0
    },
    truncated: false,
    updatingId: "",
    keyword: "",
    queueTotal: 0,
    selectedSort: "smart",
    sortHint: SORT_OPTIONS[0].hint,
    editingRemarkId: "",
    remarkDraft: "",
    savingRemark: false,
    statusUpdatingId: "",
    lastSyncedText: "",
    viewCustomized: false
  },

  onLoad() {
    activatePageNativeActions(this)
    requirePagePermission(this, {
      required: "canManageBookings",
      noPermissionMessage: "无权访问待协调工作台",
      onAuthorized: () => this.fetchBookings()
    })
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized || this.isWorkbenchWriteBusy()) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchBookings(() => wx.stopPullDownRefresh())
  },

  onShow() {
    if (
      this.data.pageAuthorized &&
      this.data.allBookings.length &&
      !this.data.loading &&
      !this.data.refreshing &&
      !this.isWorkbenchWriteBusy()
    ) {
      this.fetchBookings()
    }
  },

  isWorkbenchWriteBusy() {
    return Boolean(
      this._workbenchWriteActive ||
      this._workbenchStatusFeedbackPending ||
      this.data.updatingId ||
      this.data.savingRemark ||
      this.data.statusUpdatingId
    )
  },

  isWorkbenchInteractionBusy() {
    return Boolean(
      this.data.loading ||
      this.data.refreshing ||
      this.isWorkbenchWriteBusy()
    )
  },

  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    this._workbenchLoadRequestId =
      Number(this._workbenchLoadRequestId || 0) + 1
    this._workbenchWriteRequestId =
      Number(this._workbenchWriteRequestId || 0) + 1
    this.finishWorkbenchLoadRequestEffects()
    this.clearWorkbenchWriteTimer()
    this._workbenchWriteActive = false
    this._workbenchStatusFeedbackPending = false
  },

  applyWorkbench(mode) {
    const view = buildBookingWorkbench(
      this.data.allBookings,
      mode || this.data.selectedMode,
      Date.now()
    )
    const filterOptions = FILTER_OPTIONS.map((item) => ({
      ...item,
      count: Number(view.summary[item.key]) || 0
    }))
    const formattedQueue = sortQueue(
      view.queue.map(formatQueueItem),
      this.data.selectedSort
    )
    this.setData({
      selectedMode: view.mode,
      queue: filterQueueByKeyword(formattedQueue, this.data.keyword),
      queueTotal: formattedQueue.length,
      summary: view.summary,
      filterOptions,
      viewCustomized: Boolean(
        view.mode !== "todo" ||
        String(this.data.keyword || "").trim() ||
        this.data.selectedSort !== "smart"
      )
    })
  },

  handleKeywordInput(event) {
    this.setData({
      keyword: String(event.detail.value || "").slice(0, 40)
    })
    this.applyWorkbench()
  },

  handleClearKeyword() {
    if (!this.data.keyword) {
      return
    }
    this.setData({
      keyword: ""
    })
    this.applyWorkbench()
  },

  handleManualRefresh() {
    if (
      !this.data.pageAuthorized ||
      this.data.loading ||
      this.data.refreshing ||
      this.data.updatingId ||
      this.data.savingRemark ||
      this.data.statusUpdatingId
    ) {
      return
    }
    this.fetchBookings()
  },

  handleResetView() {
    if (!this.data.viewCustomized) {
      return
    }
    this.setData({
      keyword: "",
      selectedSort: "smart",
      sortHint: SORT_OPTIONS[0].hint
    })
    this.applyWorkbench("todo")
  },

  handleSortTap(event) {
    const selectedSort = String(event.currentTarget.dataset.sort || "")
    const option = SORT_OPTIONS.find((item) => item.key === selectedSort)
    if (!option || selectedSort === this.data.selectedSort) {
      return
    }
    this.setData({
      selectedSort,
      sortHint: option.hint
    })
    this.applyWorkbench()
  },

  handleFilterTap(event) {
    const mode = String(event.currentTarget.dataset.mode || "")
    if (!mode || mode === this.data.selectedMode) {
      return
    }
    this.applyWorkbench(mode)
  },

  handleSummaryTap(event) {
    const mode = String(event.currentTarget.dataset.mode || "")
    if (!mode) {
      return
    }
    this.applyWorkbench(mode)
  },

  handleViewDetail(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (this.isWorkbenchInteractionBusy() || !id) {
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

  handleCallPhone(event) {
    if (this.isWorkbenchInteractionBusy()) {
      return
    }
    const phone = normalizeUsablePhone(event.currentTarget.dataset.phone)
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
        if (!message || !String(message).includes("cancel")) {
          wx.showToast({
            title: "拨号失败，可复制号码",
            icon: "none"
          })
        }
      }
    })
  },

  handleCopyPhone(event) {
    if (this.isWorkbenchInteractionBusy()) {
      return
    }
    const phone = normalizeUsablePhone(event.currentTarget.dataset.phone)
    if (!phone) {
      wx.showToast({
        title: "手机号不可用",
        icon: "none"
      })
      return
    }
    if (typeof wx.setClipboardData !== "function") {
      wx.showToast({
        title: "当前版本不支持复制",
        icon: "none"
      })
      return
    }
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.setClipboardData({
      data: phone,
      success: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "手机号已复制",
          icon: "none"
        })
      },
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "手机号复制失败",
          icon: "none"
        })
      }
    })
  },

  handlePriorityTap(event) {
    const dataset = event.currentTarget.dataset || {}
    const id = String(dataset.id || "").trim()
    const currentPriority = String(dataset.schedulePriority || "normal")
    const coordinationStatus = String(dataset.coordinationStatus || "pending")
    if (
      !id ||
      this.isWorkbenchInteractionBusy()
    ) {
      return
    }

    const action = beginPageNativeAction(this)
    wx.showActionSheet({
      alertText: "调整预约优先级",
      itemList: PRIORITY_OPTIONS.map((item) => item.label),
      itemColor: "#528fff",
      success: (res) => {
        if (!isPageNativeActionActive(this, action) || !res) {
          return
        }
        const option = PRIORITY_OPTIONS[Number(res.tapIndex)]
        if (!option) {
          return
        }
        if (option.key === currentPriority) {
          wx.showToast({
            title: `当前已是${option.label}`,
            icon: "none"
          })
          return
        }
        this.updateCoordination(
          {
            id,
            schedulePriority: option.key,
            coordinationStatus
          },
          "优先级已更新"
        )
      }
    })
  },

  handleOpenRemark(event) {
    const dataset = event.currentTarget.dataset || {}
    const id = String(dataset.id || "").trim()
    if (
      !id ||
      this.isWorkbenchInteractionBusy()
    ) {
      return
    }
    this.setData({
      editingRemarkId: id,
      remarkDraft: String(dataset.remark || "").slice(0, 200)
    })
  },

  handleRemarkInput(event) {
    this.setData({
      remarkDraft: String(event.detail.value || "").slice(0, 200)
    })
  },

  handleCancelRemark() {
    if (this.data.savingRemark) {
      return
    }
    this.setData({
      editingRemarkId: "",
      remarkDraft: ""
    })
  },

  handleSaveRemark() {
    const id = String(this.data.editingRemarkId || "").trim()
    const adminRemark = String(this.data.remarkDraft || "").trim()
    if (
      !id ||
      this.isWorkbenchInteractionBusy()
    ) {
      return
    }
    const current = this.data.allBookings.find(
      (item) => String(item.id || item._id || "").trim() === id
    )
    if (String((current && current.adminRemark) || "").trim() === adminRemark) {
      this.setData({
        editingRemarkId: "",
        remarkDraft: ""
      })
      wx.showToast({
        title: "备注未发生变化",
        icon: "none"
      })
      return
    }
    this.setData({
      savingRemark: true
    })
    this.runWorkbenchWrite({
      name: "bookingUpdateAdminRemark",
      data: {
        id,
        adminRemark
      },
      timeoutTitle: "备注保存超时，请重试",
      failureFallback: "内部备注保存失败",
      clearState: () => this.setData({ savingRemark: false }),
      onResult: (result, isCurrent) => {
        if (!result || !result.ok) {
          this.setData({
            savingRemark: false
          })
          wx.showToast({
            title: formatToastTitle(result && result.message, "备注保存失败"),
            icon: "none"
          })
          return
        }
        this.setData({
          editingRemarkId: "",
          remarkDraft: "",
          savingRemark: false
        })
        wx.showToast({
          title: adminRemark ? "内部备注已保存" : "内部备注已清空",
          icon: "success"
        })
        if (isCurrent()) {
          this.fetchBookings()
        }
      }
    })
  },

  handleMarkContacted(event) {
    const dataset = event.currentTarget.dataset || {}
    const id = String(dataset.id || "").trim()
    const status = String(dataset.status || "")
    if (
      !id ||
      status !== "pending" ||
      this.isWorkbenchInteractionBusy()
    ) {
      return
    }

    this.setData({
      statusUpdatingId: id
    })
    const action = beginPageNativeAction(this)
    wx.showModal({
      title: "确认已联系客户？",
      content: "预约将更新为「已联系」；如客户已订阅，系统会发送状态提醒。",
      confirmText: "确认更新",
      confirmColor: "#528fff",
      success: (res) => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        if (res && res.confirm) {
          this.updateContactedStatus(id)
          return
        }
        this.setData({
          statusUpdatingId: ""
        })
      },
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        this.setData({
          statusUpdatingId: ""
        })
      }
    })
  },

  updateContactedStatus(id) {
    const bookingId = String(id || "").trim()
    if (
      !bookingId ||
      this.data.loading ||
      this.data.refreshing ||
      this._workbenchWriteActive ||
      this._workbenchStatusFeedbackPending ||
      this.data.updatingId ||
      this.data.savingRemark ||
      (this.data.statusUpdatingId && this.data.statusUpdatingId !== bookingId)
    ) {
      return
    }
    this.setData({
      statusUpdatingId: bookingId
    })
    this.runWorkbenchWrite({
      name: "bookingUpdateStatus",
      data: {
        id: bookingId,
        status: "contacted"
      },
      timeoutTitle: "状态更新超时，请重试",
      failureFallback: "客户状态更新失败",
      clearState: () => this.setData({ statusUpdatingId: "" }),
      onResult: (result, isCurrent) => {
        if (!result || !result.ok) {
          this.setData({
            statusUpdatingId: ""
          })
          wx.showToast({
            title: formatToastTitle(result && result.message, "客户更新失败"),
            icon: "none"
          })
          return
        }

        if (result.notificationStatus === "failed") {
          this._workbenchStatusFeedbackPending = true
          let feedbackSettled = false
          const finishFeedback = () => {
            if (feedbackSettled) {
              return
            }
            feedbackSettled = true
            this._workbenchStatusFeedbackPending = false
            if (!isCurrent()) {
              return
            }
            this.setData({ statusUpdatingId: "" })
            this.fetchBookings()
          }
          if (typeof wx.showModal !== "function") {
            finishFeedback()
            return
          }
          try {
            wx.showModal({
              title: "状态已更新",
              content: "客户状态已更新，但提醒发送失败。可在错误日志中查看原因。",
              confirmText: "知道了",
              confirmColor: "#528fff",
              showCancel: false,
              complete: finishFeedback
            })
          } catch (error) {
            finishFeedback()
          }
          return
        }

        this.setData({
          statusUpdatingId: ""
        })
        const title =
          result.notificationStatus === "sent"
            ? "已联系，提醒已发送"
            : result.notificationStatus === "not_subscribed"
              ? "已联系，用户未订阅"
              : "已标记为已联系"
        wx.showToast({
          title,
          icon: "none"
        })
        if (isCurrent()) {
          this.fetchBookings()
        }
      }
    })
  },

  handleQuickCoordination(event) {
    const dataset = event.currentTarget.dataset || {}
    const id = String(dataset.id || "").trim()
    const currentStatus = String(dataset.coordinationStatus || "pending")
    const schedulePriority = String(dataset.schedulePriority || "normal")
    const nextStatus =
      currentStatus === "pending"
        ? "coordinating"
        : currentStatus === "coordinating"
          ? "resolved"
          : ""

    if (
      !id ||
      !nextStatus ||
      this.isWorkbenchInteractionBusy()
    ) {
      return
    }

    const update = () => {
      this.updateCoordination({
        id,
        schedulePriority,
        coordinationStatus: nextStatus
      })
    }

    if (nextStatus === "resolved") {
      this.setData({
        updatingId: id
      })
      const action = beginPageNativeAction(this)
      wx.showModal({
        title: "确认完成协调？",
        content: "完成后，该预约将从待协调队列中移除。",
        confirmText: "确认完成",
        confirmColor: "#528fff",
        success: (res) => {
          if (!isPageNativeActionActive(this, action)) {
            return
          }
          if (res && res.confirm) {
            update()
            return
          }
          this.setData({
            updatingId: ""
          })
        },
        fail: () => {
          if (!isPageNativeActionActive(this, action)) {
            return
          }
          this.setData({
            updatingId: ""
          })
        }
      })
      return
    }

    update()
  },

  updateCoordination(payload, successTitle) {
    const coordinationPayload = {
      id: String((payload && payload.id) || "").trim(),
      schedulePriority: String(
        (payload && payload.schedulePriority) || "normal"
      ),
      coordinationStatus: String(
        (payload && payload.coordinationStatus) || "pending"
      )
    }

    if (!coordinationPayload.id) {
      return
    }

    if (
      this.data.loading ||
      this.data.refreshing ||
      this._workbenchWriteActive ||
      this._workbenchStatusFeedbackPending ||
      this.data.savingRemark ||
      this.data.statusUpdatingId ||
      (this.data.updatingId && this.data.updatingId !== coordinationPayload.id)
    ) {
      return
    }

    this.setData({
      updatingId: coordinationPayload.id
    })
    this.runWorkbenchWrite({
      name: "bookingUpdateCoordination",
      data: coordinationPayload,
      timeoutTitle: "协调更新超时，请重试",
      failureFallback: "协调状态更新失败",
      clearState: () => this.setData({ updatingId: "" }),
      onResult: (result, isCurrent) => {
        if (!result || !result.ok) {
          this.setData({
            updatingId: ""
          })
          wx.showToast({
            title: formatToastTitle(result && result.message, "协调更新失败"),
            icon: "none"
          })
          return
        }
        this.setData({
          updatingId: ""
        })
        wx.showToast({
          title: formatToastTitle(
            successTitle ||
              (coordinationPayload.coordinationStatus === "resolved"
                ? "已标记为已协调"
                : "已开始协调"),
            "协调状态已更新"
          ),
          icon: "success"
        })
        if (isCurrent()) {
          this.fetchBookings()
        }
      }
    })
  },

  clearWorkbenchWriteTimer() {
    if (this._workbenchWriteTimer) {
      clearTimeout(this._workbenchWriteTimer)
      this._workbenchWriteTimer = null
    }
  },

  runWorkbenchWrite(options) {
    const input = options || {}
    const clearState =
      typeof input.clearState === "function" ? input.clearState : () => {}
    if (
      this._workbenchWriteActive ||
      this._workbenchStatusFeedbackPending ||
      this.data.loading ||
      this.data.refreshing
    ) {
      clearState()
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      clearState()
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const requestId = Number(this._workbenchWriteRequestId || 0) + 1
    this._workbenchWriteRequestId = requestId
    this._workbenchWriteActive = true
    this.clearWorkbenchWriteTimer()
    let settled = false
    const isCurrent = () => this._workbenchWriteRequestId === requestId
    const finish = () => {
      if (settled || !isCurrent()) {
        return false
      }
      settled = true
      this._workbenchWriteActive = false
      this.clearWorkbenchWriteTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finish()) {
        return
      }
      clearState()
      wx.showToast({
        title: formatToastTitle(message, input.failureFallback || "操作失败"),
        icon: "none"
      })
    }

    this._workbenchWriteTimer = setTimeout(() => {
      handleFailure(input.timeoutTitle || "操作超时，请重试")
    }, WORKBENCH_WRITE_TIMEOUT_MS)

    const requestOptions = {
      name: input.name,
      data: input.data,
      success: (res) => {
        if (!finish()) {
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

  handleOpenBookingManage() {
    if (this.isWorkbenchInteractionBusy()) {
      return
    }
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: "/pages/booking-manage/booking-manage",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "预约管理打开失败",
          icon: "none"
        })
      }
    })
  },

  handleRetry() {
    if (this.data.loading || this.data.refreshing || this.isWorkbenchWriteBusy()) {
      return
    }
    this.fetchBookings()
  },

  finishWorkbenchLoadRequestEffects() {
    if (this._workbenchLoadTimer) {
      clearTimeout(this._workbenchLoadTimer)
      this._workbenchLoadTimer = null
    }
    if (typeof this._workbenchLoadDone === "function") {
      const done = this._workbenchLoadDone
      this._workbenchLoadDone = null
      done()
    }
  },

  fetchBookings(done) {
    this.finishWorkbenchLoadRequestEffects()
    const requestId = Number(this._workbenchLoadRequestId || 0) + 1
    this._workbenchLoadRequestId = requestId
    this._workbenchLoadDone = typeof done === "function" ? done : null

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        refreshing: false,
        loadError: "云能力未初始化"
      })
      this.finishWorkbenchLoadRequestEffects()
      return
    }

    this.setData({
      loading: !this.data.allBookings.length,
      refreshing: Boolean(this.data.allBookings.length),
      loadError: ""
    })
    let settled = false
    const finishRequest = () => {
      if (settled || this._workbenchLoadRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishWorkbenchLoadRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        loading: false,
        refreshing: false,
        loadError: message || "待协调预约加载失败"
      })
    }

    this._workbenchLoadTimer = setTimeout(() => {
      handleFailure("待协调预约加载超时，请检查网络后重试")
    }, WORKBENCH_LOAD_TIMEOUT_MS)

    const requestOptions = {
      name: "bookingList",
      data: {
        status: "all",
        limit: 2000
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            loading: false,
            refreshing: false,
            loadError: (result && result.message) || "待协调预约加载失败"
          })
          return
        }
        this.setData({
          loading: false,
          refreshing: false,
          allBookings: Array.isArray(result.list) ? result.list : [],
          truncated: Boolean(result.truncated),
          lastSyncedText: formatSyncTime(Date.now())
        })
        this.applyWorkbench()
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
  }
})
