const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { isUserCancelError, removeCsvFile } = require("../../shared/csvFile")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageCsvFileActions,
  beginPageCsvFileAction,
  cancelPageCsvFileActions,
  isPageCsvFileActionActive
} = require("../../shared/pageCsvFileActions")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待联系" },
  { value: "contacted", label: "已联系" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" }
]

const STATUS_TEXT_MAP = {
  pending: "待联系",
  contacted: "已联系",
  completed: "已完成",
  cancelled: "已取消"
}

const STATUS_CLASS_MAP = {
  pending: "status-pending",
  contacted: "status-contacted",
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

const PRIORITY_OPTIONS = [
  { value: "all", label: "全部级别" },
  { value: "priority", label: "优先" },
  { value: "normal", label: "常规" },
  { value: "standby", label: "候补" }
]

const COORDINATION_OPTIONS = [
  { value: "all", label: "全部进度" },
  { value: "pending", label: "待协调" },
  { value: "coordinating", label: "协调中" },
  { value: "resolved", label: "已协调" }
]

const DEFAULT_PAGE_SIZE = 20
const BOOKING_MANAGE_LIST_TIMEOUT_MS = 15 * 1000
const BOOKING_MANAGE_MUTATION_TIMEOUT_MS = 20 * 1000
const BOOKING_MANAGE_EXPORT_TIMEOUT_MS = 20 * 1000

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

function buildStatusSummary(stats) {
  return [
    { key: "pending", label: "待联系", value: stats.pending || 0 },
    { key: "contacted", label: "已联系", value: stats.contacted || 0 },
    { key: "completed", label: "已完成", value: stats.completed || 0 },
    { key: "recentCreated7d", label: "近 7 天新增", value: stats.recentCreated7d || 0 }
  ]
}

function buildStatusRatioSegments(stats) {
  const pending = Number(stats && stats.pending) || 0
  const contacted = Number(stats && stats.contacted) || 0
  const completed = Number(stats && stats.completed) || 0
  const total = pending + contacted + completed

  const base = [
    { key: "pending", label: "待联系", value: pending, className: "ratio-pending" },
    { key: "contacted", label: "已联系", value: contacted, className: "ratio-contacted" },
    { key: "completed", label: "已完成", value: completed, className: "ratio-completed" }
  ]

  if (!total) {
    return base.map((item) => ({
      ...item,
      percent: 0,
      percentText: "0%"
    }))
  }

  const rawPercents = base.map((item) => (item.value / total) * 100)
  const floors = rawPercents.map((value) => Math.floor(value))
  let used = floors.reduce((sum, n) => sum + n, 0)
  let remain = 100 - used

  const order = rawPercents
    .map((value, index) => ({
      index,
      frac: value - floors[index]
    }))
    .sort((a, b) => b.frac - a.frac)

  const percents = floors.slice()
  let i = 0
  while (remain > 0 && i < order.length) {
    percents[order[i].index] += 1
    remain -= 1
    i += 1
    if (i >= order.length) {
      i = 0
    }
  }

  return base.map((item, index) => ({
    ...item,
    percent: percents[index],
    percentText: `${percents[index]}%`
  }))
}

function buildRecentCreatedViewModel(list) {
  if (!Array.isArray(list)) {
    return []
  }

  return list.map((item) => {
    const status = item.status || "pending"
    return {
      id: item.id || "",
      vehicleName: item.vehicleName || "—",
      userName: item.userName || "—",
      city: item.city || "—",
      startDate: item.startDate || "—",
      endDate: item.endDate || "—",
      status,
      statusText: STATUS_TEXT_MAP[status] || "待联系",
      statusClass: STATUS_CLASS_MAP[status] || "status-pending",
      createdAtText: formatDisplayTime(item.createdAt)
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

function buildJourneyView(status) {
  const current = String(status || "pending")
  if (current === "contacted") {
    return {
      journeyStage: 2,
      journeyProgress: 67,
      journeyHint: "下一步：完成协调并确认行程",
      journeyClass: "booking-journey-contacted"
    }
  }
  if (current === "completed") {
    return {
      journeyStage: 3,
      journeyProgress: 100,
      journeyHint: "本次预约跟进已完成",
      journeyClass: "booking-journey-completed"
    }
  }
  if (current === "cancelled") {
    return {
      journeyStage: 0,
      journeyProgress: 0,
      journeyHint: "本次预约已取消",
      journeyClass: "booking-journey-cancelled"
    }
  }
  return {
    journeyStage: 1,
    journeyProgress: 33,
    journeyHint: "下一步：联系客户确认需求",
    journeyClass: "booking-journey-pending"
  }
}

function ensureCsvFileName(name) {
  const raw = String(name || "").trim()
  if (!raw) {
    return "bookings.csv"
  }
  if (/\.csv$/i.test(raw)) {
    return raw
  }
  return `${raw}.csv`
}

function getErrorMessage(error) {
  if (!error) {
    return ""
  }

  return String(error.errMsg || error.message || error)
}

function isTapGestureShareError(error) {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes("tap gesture")
}

function isDevtoolsEnv() {
  try {
    if (!wx || typeof wx.getSystemInfoSync !== "function") {
      return false
    }
    const info = wx.getSystemInfoSync()
    return info && info.platform === "devtools"
  } catch (error) {
    return false
  }
}

function isDevtoolsNotSupportedShareError(error) {
  const message = getErrorMessage(error)
  if (!message) {
    return false
  }

  return message.includes("开发者工具") || message.includes("不支持")
}

Page({
  data: {
    loading: false,
    pageAuthorized: false,
    keyword: "",
    currentStatus: "all",
    statusOptions: STATUS_OPTIONS,
    currentPriority: "all",
    priorityOptions: PRIORITY_OPTIONS,
    currentCoordination: "all",
    coordinationOptions: COORDINATION_OPTIONS,
    total: 0,
    truncated: false,
    summaryItems: buildStatusSummary({}),
    statusRatioSegments: buildStatusRatioSegments({}),
    recentCreatedList: [],
    list: [],
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    hasMore: false,
    exportFilePath: "",
    exportFileName: "",
    canShareExport: true,
    emptyTitle: "暂无预约数据",
    emptyDesc: "当前筛选条件下没有匹配的预约记录"
  },

  onLoad() {
    activatePageCsvFileActions(this)
    activatePageNativeActions(this)
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

    this.setData({
      canShareExport: !isDevtoolsEnv() && typeof wx.shareFileMessage === "function"
    })

    requirePagePermission(this, {
      required: "canManageBookings",
      noPermissionMessage: "无权访问预约管理",
      onAuthorized: () => {
        this.fetchList()
      }
    })
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized || this.data.loading) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchList(() => {
      wx.stopPullDownRefresh()
    })
  },

  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageCsvFileActions(this)
    cancelPageNativeActions(this)
    this._bookingListRequestId = Number(this._bookingListRequestId || 0) + 1
    this._bookingMutationRequestId = Number(this._bookingMutationRequestId || 0) + 1
    this._bookingExportRequestId = Number(this._bookingExportRequestId || 0) + 1
    this.finishBookingListRequestEffects()
    this.clearBookingMutationTimer()
    this.clearBookingExportTimer()
  },

  handleKeywordInput(event) {
    const value = String((event.detail && event.detail.value) || "")
    this.setData({ keyword: value })
  },

  handleClearKeyword() {
    if (!this.data.keyword || this.data.loading) {
      return
    }
    const listRequestId = Number(this._bookingListRequestId || 0)
    this.setData({ keyword: "" }, () => {
      if (listRequestId !== Number(this._bookingListRequestId || 0)) {
        return
      }
      this.fetchList()
    })
  },

  handleKeywordConfirm() {
    if (this.data.loading) {
      return
    }
    this.fetchList()
  },

  handleSearch() {
    if (this.data.loading) {
      return
    }
    this.fetchList()
  },

  handleStatusTap(event) {
    const status = event.currentTarget.dataset.status
    if (!status || status === this.data.currentStatus || this.data.loading) {
      return
    }

    this.setData({
      currentStatus: status
    })

    this.fetchList()
  },

  handlePriorityTap(event) {
    const value = String(event.currentTarget.dataset.value || "")
    if (!value || value === this.data.currentPriority || this.data.loading) {
      return
    }
    this.setData({ currentPriority: value })
    this.fetchList()
  },

  handleCoordinationTap(event) {
    const value = String(event.currentTarget.dataset.value || "")
    if (!value || value === this.data.currentCoordination || this.data.loading) {
      return
    }
    this.setData({ currentCoordination: value })
    this.fetchList()
  },

  handleReset() {
    if (this.data.loading) {
      return
    }
    this.setData({
      keyword: "",
      currentStatus: "all",
      currentPriority: "all",
      currentCoordination: "all"
    })

    this.fetchList()
  },

  handleLoadMore() {
    if (this.data.loading || !this.data.hasMore) {
      return
    }

    this.fetchList({ append: true })
  },

  handleExport() {
    if (this.data.loading) {
      return
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const filters = {
      status: this.data.currentStatus,
      schedulePriority: this.data.currentPriority,
      coordinationStatus: this.data.currentCoordination,
      keyword: String(this.data.keyword || ""),
      limit: 500
    }
    const requestId = Number(this._bookingExportRequestId || 0) + 1
    this._bookingExportRequestId = requestId
    this.clearBookingExportTimer()
    this.setData({ loading: true })

    let settled = false
    const isActive = () => !settled && this._bookingExportRequestId === requestId
    const finishRequest = () => {
      if (!isActive()) {
        return false
      }
      settled = true
      this.clearBookingExportTimer()
      return true
    }
    const handleFailure = (message, fallback = "导出失败") => {
      if (!finishRequest()) {
        return
      }
      this.setData({ loading: false })
      wx.showToast({
        title: formatToastTitle(message, fallback),
        icon: "none"
      })
    }

    this._bookingExportRequestTimer = setTimeout(() => {
      handleFailure("导出超时，请重试")
    }, BOOKING_MANAGE_EXPORT_TIMEOUT_MS)

    const requestOptions = {
      name: "bookingExportCsv",
      data: filters,
      success: (res) => {
        if (!isActive()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.csvText) {
          handleFailure(result && result.message)
          return
        }

        this.saveExportedCsv({
          fileName: ensureCsvFileName(result.fileName),
          csvText: result.csvText,
          total: Number(result.total) || 0,
          matchedTotal: Number(result.matchedTotal) || 0,
          sourceTruncated: Boolean(result.sourceTruncated),
          truncated: Boolean(result.truncated),
          finishRequest,
          handleFailure
        })
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

  saveExportedCsv({
    fileName,
    csvText,
    total,
    matchedTotal,
    sourceTruncated,
    truncated,
    finishRequest,
    handleFailure
  }) {
    let fs
    try {
      fs = wx.getFileSystemManager && wx.getFileSystemManager()
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message), "保存失败")
      return
    }
    if (!fs) {
      handleFailure("文件系统不可用", "保存失败")
      return
    }

    const basePath = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : ""
    const filePath = basePath ? `${basePath}/${fileName}` : fileName

    const writeOptions = {
      filePath,
      data: csvText,
      encoding: "utf8",
      success: () => {
        if (!finishRequest()) {
          removeCsvFile(filePath).catch(() => {})
          return
        }
        const previousFilePath = this.data.exportFilePath
        this.setData({
          loading: false,
          exportFilePath: filePath,
          exportFileName: fileName
        })
        if (previousFilePath && previousFilePath !== filePath) {
          removeCsvFile(previousFilePath).catch(() => {})
        }
        if (truncated) {
          wx.showModal({
            title: "CSV 已生成",
            content: sourceTruncated
              ? `已导出最近扫描结果中的 ${total} 条，数据超过 2000 条扫描上限，请缩小筛选范围后分批导出。`
              : `符合条件 ${matchedTotal} 条，本次已导出 ${total} 条，请缩小筛选范围后分批导出。`,
            confirmText: "知道了",
            confirmColor: "#528fff",
            showCancel: false
          })
        } else {
          wx.showToast({
            title: "CSV 已生成",
            icon: "none"
          })
        }
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message), "保存失败")
      }
    }

    try {
      fs.writeFile(writeOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message), "保存失败")
    }
  },

  handleShareExportedFile() {
    if (this.data.loading) {
      return
    }
    if (!this.data.exportFilePath || !this.data.exportFileName) {
      wx.showToast({
        title: "请先导出CSV",
        icon: "none"
      })
      return
    }

    this.shareCsvFile(this.data.exportFilePath, this.data.exportFileName)
  },

  handleOpenExportedFile() {
    if (this.data.loading) {
      return
    }
    if (!this.data.exportFilePath) {
      wx.showToast({
        title: "请先导出CSV",
        icon: "none"
      })
      return
    }

    this.openCsvFile(this.data.exportFilePath)
  },

  handleDeleteExportedFile() {
    const filePath = String(this.data.exportFilePath || "")
    if (this.data.loading || !filePath) {
      return
    }
    const action = beginPageCsvFileAction(this, filePath)
    wx.showModal({
      title: "删除本地 CSV",
      content: "将从当前设备删除这份导出文件，删除后无法恢复。云端预约数据不会受到影响。",
      confirmText: "确认删除",
      confirmColor: "#d46868",
      success: (res) => {
        if (
          this.data.loading ||
          !isPageCsvFileActionActive(this, action) ||
          !res.confirm
        ) {
          return
        }
        removeCsvFile(filePath)
          .then(() => {
            if (!isPageCsvFileActionActive(this, action)) {
              return
            }
            this.setData({
              exportFilePath: "",
              exportFileName: ""
            })
            wx.showToast({
              title: "本地文件已删除",
              icon: "none"
            })
          })
          .catch((error) => {
            if (!isPageCsvFileActionActive(this, action)) {
              return
            }
            wx.showToast({
              title: "删除失败",
              icon: "none"
            })
          })
      }
    })
  },

  shareCsvFile(filePath, fileName) {
    const action = beginPageCsvFileAction(this, filePath)
    const share = wx.shareFileMessage
    if (isDevtoolsEnv()) {
      wx.showToast({
        title: "将打开文件",
        icon: "none"
      })
      this.openCsvFile(filePath)
      return
    }

    if (typeof share === "function") {
      share({
        filePath,
        fileName,
        success: () => {
          if (!isPageCsvFileActionActive(this, action)) {
            return
          }
          wx.showToast({
            title: "文件已生成",
            icon: "none"
          })
        },
        fail: (error) => {
          if (!isPageCsvFileActionActive(this, action)) {
            return
          }
          if (isUserCancelError(error)) {
            return
          }

          if (isTapGestureShareError(error)) {
            wx.showToast({
              title: "将打开文件",
              icon: "none"
            })
            this.openCsvFile(filePath)
            return
          }

          if (isDevtoolsNotSupportedShareError(error)) {
            wx.showToast({
              title: "将打开文件",
              icon: "none"
            })
            this.openCsvFile(filePath)
            return
          }

          wx.showToast({
            title: "分享失败",
            icon: "none"
          })
        }
      })
      return
    }

    this.openCsvFile(filePath)
  },

  openCsvFile(filePath) {
    const action = beginPageCsvFileAction(this, filePath)
    const open = wx.openDocument
    if (typeof open === "function") {
      open({
        filePath,
        fileType: "csv",
        showMenu: true,
        success: () => {},
        fail: () => {
          if (!isPageCsvFileActionActive(this, action)) {
            return
          }
          wx.showToast({
            title: "文件打开失败",
            icon: "none"
          })
        }
      })
      return
    }

    if (!isPageCsvFileActionActive(this, action)) {
      return
    }
    wx.showToast({
      title: "暂不支持打开",
      icon: "none"
    })
  },

  handleRemarkInput(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) {
      return
    }

    const value = normalizeRemark(event.detail && event.detail.value)
    this.setData({
      [`list[${index}].adminRemarkDraft`]: value
    })
  },

  handleViewDetail(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (this.data.loading || !id) {
      return
    }

    const current = this.data.list.find((item) => item.id === id)

    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages/booking-manage-detail/booking-manage-detail?id=${id}`,
      success: (res) => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        if (current && res && res.eventChannel) {
          res.eventChannel.emit("acceptManageBookingDetail", {
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

  handleCallPhone(event) {
    if (this.data.loading) {
      return
    }
    const phone = normalizePhone(event.currentTarget.dataset.phone)
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

  handleUpdateStatus(event) {
    if (this.data.loading) {
      return
    }

    const id = String(event.currentTarget.dataset.id || "").trim()
    const status = String(event.currentTarget.dataset.status || "").trim()
    if (!id || !status) {
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
      success: (modalRes) => {
        if (!isPageNativeActionActive(this, action) || !modalRes || !modalRes.confirm) {
          return
        }

        this.updateStatus(id, status)
      }
    })
  },

  handleSaveRemark(event) {
    if (this.data.loading) {
      return
    }

    const id = String(event.currentTarget.dataset.id || "").trim()
    const index = Number(event.currentTarget.dataset.index)
    if (!id || !Number.isInteger(index) || index < 0) {
      return
    }

    const current = this.data.list[index] || {}
    const adminRemark = normalizeRemark(current.adminRemarkDraft)

    this.saveRemark(id, adminRemark)
  },

  updateStatus(id, status) {
    this.runBookingMutation({
      name: "bookingUpdateStatus",
      data: { id, status },
      timeoutTitle: "更新超时，请重试",
      failureFallback: "更新失败",
      onResult: (result, isCurrent) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "更新失败"),
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        showStatusUpdateFeedback(result, () => {
          if (!isCurrent()) {
            return
          }
          this.setData({ loading: false })
          this.fetchList()
        })
      }
    })
  },

  saveRemark(id, adminRemark) {
    this.runBookingMutation({
      name: "bookingUpdateAdminRemark",
      data: { id, adminRemark },
      timeoutTitle: "保存超时，请重试",
      failureFallback: "保存失败",
      onResult: (result) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "保存失败"),
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        wx.showToast({
          title: "备注已保存",
          icon: "none"
        })

        this.fetchList()
      }
    })
  },

  runBookingMutation(options) {
    const input = options && typeof options === "object" ? options : {}
    if (this.data.loading) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const requestId = Number(this._bookingMutationRequestId || 0) + 1
    this._bookingMutationRequestId = requestId
    this.clearBookingMutationTimer()
    this.setData({ loading: true })

    let settled = false
    const isCurrent = () => this._bookingMutationRequestId === requestId
    const finishRequest = () => {
      if (settled || !isCurrent()) {
        return false
      }
      settled = true
      this.clearBookingMutationTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ loading: false })
      wx.showToast({
        title: formatToastTitle(message, input.failureFallback || "操作失败"),
        icon: "none"
      })
    }

    this._bookingMutationRequestTimer = setTimeout(() => {
      handleFailure(input.timeoutTitle || "操作超时，请重试")
    }, BOOKING_MANAGE_MUTATION_TIMEOUT_MS)

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

  fetchList(input) {
    const done = typeof input === "function" ? input : input && input.done
    const append = Boolean(input && typeof input === "object" && input.append)
    const nextPage = append ? this.data.page + 1 : 0
    const pageSize = this.data.pageSize || DEFAULT_PAGE_SIZE
    const requestId = Number(this._bookingListRequestId || 0) + 1
    this._bookingListRequestId = requestId
    this.finishBookingListRequestEffects()

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        list: []
      })
      if (typeof done === "function") {
        done()
      }
      return
    }

    const filters = {
      status: this.data.currentStatus,
      schedulePriority: this.data.currentPriority,
      coordinationStatus: this.data.currentCoordination,
      keyword: String(this.data.keyword || ""),
      limit: 2000,
      page: nextPage,
      pageSize
    }
    this._bookingListRequestDone = typeof done === "function" ? done : null
    this.setData({
      loading: true
    })

    let settled = false
    const finishRequest = () => {
      if (settled || this._bookingListRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishBookingListRequestEffects()
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
      this.setData({
        loading: false,
        page: append ? this.data.page : 0,
        hasMore: append ? this.data.hasMore : false,
        total: append ? this.data.total : 0,
        truncated: append ? this.data.truncated : false,
        summaryItems: append ? this.data.summaryItems : buildStatusSummary({}),
        statusRatioSegments: append
          ? this.data.statusRatioSegments
          : buildStatusRatioSegments({}),
        recentCreatedList: append ? this.data.recentCreatedList : [],
        list: append ? this.data.list : []
      })
    }

    this._bookingListRequestTimer = setTimeout(() => {
      handleFailure("加载超时，请重试")
    }, BOOKING_MANAGE_LIST_TIMEOUT_MS)

    const requestOptions = {
      name: "bookingList",
      data: filters,
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
          this.setData({
            loading: false,
            page: append ? this.data.page : 0,
            hasMore: append ? this.data.hasMore : false,
            list: append ? this.data.list : []
          })
          return
        }
        const list = Array.isArray(result.list) ? result.list : []
        const formatted = list.map((item) => {
          const status = item.status || "pending"
          const schedulePriority = PRIORITY_TEXT_MAP[item.schedulePriority]
            ? item.schedulePriority
            : "normal"
          const coordinationStatus =
            status === "completed" || status === "cancelled"
              ? "resolved"
              : COORDINATION_TEXT_MAP[item.coordinationStatus]
                ? item.coordinationStatus
                : "pending"
          return {
            ...item,
            statusText: STATUS_TEXT_MAP[status] || "待联系",
            statusClass: STATUS_CLASS_MAP[status] || "status-pending",
            createdAtText: formatDisplayTime(item.createdAt),
            adminRemark: item.adminRemark || "",
            adminRemarkDraft: item.adminRemark || "",
            adminRemarkUpdatedAtText: formatDisplayTime(item.adminRemarkUpdatedAt),
            schedulePriority,
            schedulePriorityText: PRIORITY_TEXT_MAP[schedulePriority],
            priorityClass: `priority-${schedulePriority}`,
            coordinationStatus,
            coordinationStatusText: COORDINATION_TEXT_MAP[coordinationStatus],
            coordinationClass: `coordination-${coordinationStatus}`,
            ...buildJourneyView(status)
          }
        })

        const nextList = append ? this.data.list.concat(formatted) : formatted

        this.setData({
          loading: false,
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          total: result.total || 0,
          truncated: Boolean(result.truncated),
          summaryItems: buildStatusSummary(result.dashboard || {}),
          statusRatioSegments: buildStatusRatioSegments(result.dashboard || {}),
          recentCreatedList: buildRecentCreatedViewModel(result.recentCreatedList || []),
          list: nextList
        })
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

  finishBookingListRequestEffects() {
    if (this._bookingListRequestTimer) {
      clearTimeout(this._bookingListRequestTimer)
      this._bookingListRequestTimer = null
    }
    const done = this._bookingListRequestDone
    this._bookingListRequestDone = null
    if (typeof done === "function") {
      done()
    }
  },

  clearBookingMutationTimer() {
    if (!this._bookingMutationRequestTimer) {
      return
    }
    clearTimeout(this._bookingMutationRequestTimer)
    this._bookingMutationRequestTimer = null
  },

  clearBookingExportTimer() {
    if (!this._bookingExportRequestTimer) {
      return
    }
    clearTimeout(this._bookingExportRequestTimer)
    this._bookingExportRequestTimer = null
  }
})
