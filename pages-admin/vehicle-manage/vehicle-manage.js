const vehicleUtils = require("../../shared/vehicle")
const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "active", label: "在用" },
  { value: "idle", label: "闲置" },
  { value: "maintenance", label: "维修" },
  { value: "retired", label: "停用" }
]
const STATUS_LABEL_MAP = {
  active: "在用",
  idle: "闲置",
  maintenance: "维修",
  retired: "停用"
}
const STATUS_CLASS_MAP = {
  active: "status-active",
  idle: "status-idle",
  maintenance: "status-maintenance",
  retired: "status-retired"
}
const STATUS_OP_OPTIONS = [
  { value: "idle", label: "设为闲置" },
  { value: "active", label: "设为在用" },
  { value: "maintenance", label: "设为维修" }
]
const VEHICLE_TYPE_LABEL_MAP = {
  sedan: "轿车",
  suv: "SUV",
  mpv: "MPV",
  sports: "跑车",
  truck: "卡车",
  other: "其他"
}
const TRANSMISSION_LABEL_MAP = {
  manual: "手动挡",
  automatic: "自动挡"
}
const FUEL_TYPE_LABEL_MAP = {
  gasoline: "燃油",
  electric: "纯电",
  hybrid: "混动"
}
const DEFAULT_PAGE_SIZE = 20
const VEHICLE_LIST_TIMEOUT_MS = 15 * 1000
const VEHICLE_MUTATION_TIMEOUT_MS = 20 * 1000
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
function buildStatusSummary(stats) {
  return [
    { key: "idle", label: "在库", value: stats.idle || 0 },
    { key: "active", label: "在用", value: stats.active || 0 },
    { key: "maintenance", label: "维修中", value: stats.maintenance || 0 },
    { key: "recentAdded7d", label: "近7天新增", value: stats.recentAdded7d || 0 }
  ]
}
function buildStatusRatioSegments(stats) {
  const idle = Number(stats && stats.idle) || 0
  const active = Number(stats && stats.active) || 0
  const maintenance = Number(stats && stats.maintenance) || 0
  const total = idle + active + maintenance
  const base = [
    { key: "idle", label: "在库", value: idle, className: "ratio-idle" },
    { key: "active", label: "在用", value: active, className: "ratio-active" },
    { key: "maintenance", label: "维修中", value: maintenance, className: "ratio-maintenance" }
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
function formatPriceDayText(priceDay) {
  if (Number.isInteger(priceDay) && priceDay > 0) {
    return `￥${priceDay} / 24小时`
  }
  return "—"
}
function buildMediaHealth(item) {
  const source = item && typeof item === "object" ? item : {}
  const imageCount = Math.max(0, Number(source.imageCount) || 0)
  const hasCover = Boolean(source.coverImage)
  if (!hasCover) {
    return {
      imageCount,
      mediaStatusText: "待补封面",
      mediaStatusClass: "media-health-missing",
      mediaProgress: 0
    }
  }
  if (imageCount < 3) {
    return {
      imageCount,
      mediaStatusText: "基础素材",
      mediaStatusClass: "media-health-basic",
      mediaProgress: Math.round((imageCount / 3) * 100)
    }
  }
  return {
    imageCount,
    mediaStatusText: "素材充足",
    mediaStatusClass: "media-health-ready",
    mediaProgress: 100
  }
}
function buildArchiveSummary(stats) {
  const source = stats && typeof stats === "object" ? stats : {}
  return [
    { key: "current", label: "已复核", value: Number(source.current) || 0, className: "archive-summary-current" },
    { key: "pending", label: "待复核", value: Number(source.pending) || 0, className: "archive-summary-pending" },
    { key: "stale", label: "已过期", value: Number(source.stale) || 0, className: "archive-summary-stale" },
    { key: "missing", label: "资料缺失", value: Number(source.missing) || 0, className: "archive-summary-missing" }
  ]
}
function buildArchiveHealthView(item) {
  const health = item && item.archiveHealth && typeof item.archiveHealth === "object"
    ? item.archiveHealth
    : { status: "missing", statusText: "资料缺失", missingCount: 6, freshnessDays: null }
  return {
    archiveStatus: health.status || "missing",
    archiveStatusText: health.statusText || "资料缺失",
    archiveStatusClass: `archive-health-${health.status || "missing"}`,
    archiveUpdatedText: health.lastUpdatedDate || "暂无更新日期",
    archiveHealthMeta: Number.isInteger(health.freshnessDays)
      ? `${health.freshnessDays} 天前更新 · 缺失 ${Number(health.missingCount) || 0} 项`
      : `暂无有效更新日期 · 缺失 ${Number(health.missingCount) || 0} 项`
  }
}
function buildRecentAddedViewModel(list) {
  if (!Array.isArray(list)) {
    return []
  }
  return list.map((item) => ({
    id: item.id || "",
    plateNumber: vehicleUtils.normalizePlateNumber(item.plateNumber),
    brandModel: item.brandModel || "—",
    status: item.status || "",
    statusText: STATUS_LABEL_MAP[item.status] || item.status || "未知",
    statusClass: STATUS_CLASS_MAP[item.status] || "status-idle",
    locationText: item.location ? String(item.location).trim() : "—",
    createdAtText: formatDisplayTime(item.createdAt)
  }))
}
Page({
  data: {
    loading: false,
    updatingId: "",
    deletingId: "",
    pageAuthorized: false,
    keyword: "",
    currentStatus: "all",
    statusOptions: STATUS_OPTIONS,
    statusOpOptions: STATUS_OP_OPTIONS,
    total: 0,
    truncated: false,
    summaryItems: buildStatusSummary({}),
    statusRatioSegments: buildStatusRatioSegments({}),
    archiveSummaryItems: buildArchiveSummary({}),
    recentAddedList: [],
    list: [],
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    hasMore: false,
    emptyTitle: "暂无车辆数据",
    emptyDesc: "当前筛选条件下没有匹配的车辆记录"
  },
  onLoad() {
    activatePageNativeActions(this)
    requirePagePermission(this, {
      required: "canManageVehicles",
      noPermissionMessage: "无权访问车辆管理",
      onAuthorized: () => {
        this.fetchList()
      }
    })
  },
  onShow() {
    if (
      !this.data.pageAuthorized ||
      this.data.loading ||
      this.isVehicleMutationBusy()
    ) {
      return
    }
    this.fetchList()
  },
  onPullDownRefresh() {
    if (
      !this.data.pageAuthorized ||
      this.isVehicleMutationBusy()
    ) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchList(() => {
      wx.stopPullDownRefresh()
    })
  },
  onReachBottom() {
    if (
      !this.data.pageAuthorized ||
      this.data.loading ||
      !this.data.hasMore ||
      this.isVehicleMutationBusy()
    ) {
      return
    }
    this.fetchList({ append: true })
  },
  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    this._vehicleListRequestId = Number(this._vehicleListRequestId || 0) + 1
    this._vehicleMutationRequestId = Number(this._vehicleMutationRequestId || 0) + 1
    this.finishVehicleListRequestEffects()
    this.finishVehicleMutationEffects()
  },
  isVehicleMutationBusy() {
    return Boolean(
      this.data.updatingId ||
      this.data.deletingId ||
      this._vehicleMutationLoadingVisible
    )
  },
  handleKeywordInput(event) {
    const value = String((event.detail && event.detail.value) || "")
    this.setData({
      keyword: value
    })
  },
  handleClearKeyword() {
    if (!this.data.keyword || this.data.loading || this.isVehicleMutationBusy()) {
      return
    }
    const listRequestId = Number(this._vehicleListRequestId || 0)
    this.setData({ keyword: "" }, () => {
      if (listRequestId !== Number(this._vehicleListRequestId || 0)) {
        return
      }
      this.fetchList()
    })
  },
  handleKeywordConfirm() {
    if (this.data.loading || this.isVehicleMutationBusy()) {
      return
    }
    this.fetchList()
  },
  handleStatusTap(event) {
    const status = event.currentTarget.dataset.status
    if (
      !status ||
      status === this.data.currentStatus ||
      this.data.loading ||
      this.isVehicleMutationBusy()
    ) {
      return
    }
    this.setData({
      currentStatus: status
    })
    this.fetchList()
  },
  handleReset() {
    if (this.data.loading || this.isVehicleMutationBusy()) {
      return
    }
    this.setData({
      keyword: "",
      currentStatus: "all"
    })
    this.fetchList()
  },
  handleLoadMore() {
    if (this.data.loading || this.isVehicleMutationBusy() || !this.data.hasMore) {
      return
    }
    this.fetchList({ append: true })
  },
  handleGoCreate() {
    if (this.data.loading || this.isVehicleMutationBusy()) {
      return
    }
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: "/pages-admin/vehicle-create/vehicle-create",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "新建页面打开失败",
          icon: "none"
        })
      }
    })
  },
  handleEdit(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (this.data.loading || this.isVehicleMutationBusy()) {
      return
    }
    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      return
    }
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages-admin/vehicle-edit/vehicle-edit?id=${id}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "编辑页面打开失败",
          icon: "none"
        })
      }
    })
  },
  handleViewDetail(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (this.data.loading || this.isVehicleMutationBusy()) {
      return
    }
    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      return
    }
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages-admin/vehicle-detail-manage/vehicle-detail-manage?id=${id}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "车辆详情打开失败",
          icon: "none"
        })
      }
    })
  },
  handleCoverImageError(event) {
    const index = Number(event.currentTarget.dataset.index)
    const list = Array.isArray(this.data.list) ? this.data.list : []
    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
      return
    }
    const nextList = list.map((item, itemIndex) => itemIndex === index
      ? {
          ...item,
          coverImage: "",
          coverLoadFailed: true,
          mediaStatusText: "封面不可用",
          mediaStatusClass: "media-health-missing",
          mediaProgress: 0
        }
      : item)
    this.setData({ list: nextList })
  },
  handleUpdateStatus(event) {
    if (this.data.loading || this.data.updatingId || this.data.deletingId) {
      return
    }
    const id = String(event.currentTarget.dataset.id || "").trim()
    const status = String(event.currentTarget.dataset.status || "").trim()
    const currentStatus = String(event.currentTarget.dataset.currentStatus || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()
    if (!id || !status) {
      return
    }
    if (status === currentStatus) {
      return
    }
    const statusText = STATUS_LABEL_MAP[status] || status
    const action = beginPageNativeAction(this, {
      exclusiveKey: "vehicle-write-confirmation"
    })
    wx.showModal({
      title: "更新状态",
      content: `确认将车辆 ${plateNumber || id} 状态更新为「${statusText}」？`,
      confirmText: "确认更新",
      confirmColor: "#528fff",
      success: (modalRes) => {
        if (!isPageNativeActionActive(this, action) || !modalRes || !modalRes.confirm) {
          return
        }
        this.updateVehicleStatus(id, status)
      }
    })
  },
  handleRetire(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()
    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      return
    }
    if (this.data.updatingId || this.data.deletingId) {
      return
    }
    const action = beginPageNativeAction(this, {
      exclusiveKey: "vehicle-write-confirmation"
    })
    wx.showModal({
      title: "停用车辆",
      content: `确认将车辆 ${plateNumber || id} 标记为停用？`,
      confirmText: "确认停用",
      confirmColor: "#d46868",
      success: (modalRes) => {
        if (!isPageNativeActionActive(this, action) || !modalRes || !modalRes.confirm) {
          return
        }
        this.retireVehicle(id)
      }
    })
  },
  handleRestore(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()
    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      return
    }
    if (this.data.updatingId || this.data.deletingId) {
      return
    }
    const action = beginPageNativeAction(this, {
      exclusiveKey: "vehicle-write-confirmation"
    })
    wx.showModal({
      title: "恢复启用",
      content: `确认将车辆 ${plateNumber || id} 恢复为可管理状态？`,
      confirmText: "确认恢复",
      confirmColor: "#528fff",
      success: (modalRes) => {
        if (!isPageNativeActionActive(this, action) || !modalRes || !modalRes.confirm) {
          return
        }
        this.restoreVehicle(id)
      }
    })
  },
  handleDelete(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()
    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      return
    }
    if (this.data.updatingId || this.data.deletingId) {
      return
    }
    const action = beginPageNativeAction(this, {
      exclusiveKey: "vehicle-write-confirmation"
    })
    wx.showModal({
      title: "删除车辆",
      content: `确认删除车辆 ${plateNumber || id}？仅无预约历史的车辆可删除；有预约历史请改为停用。删除后不可恢复。`,
      confirmText: "确认删除",
      confirmColor: "#d46868",
      success: (modalRes) => {
        if (!isPageNativeActionActive(this, action) || !modalRes || !modalRes.confirm) {
          return
        }
        this.deleteVehicle(id)
      }
    })
  },
  updateVehicleStatus(id, status) {
    this.runVehicleMutation({
      id,
      stateField: "updatingId",
      name: "vehicleUpdateStatus",
      data: { id, status },
      loadingTitle: "更新中…",
      timeoutTitle: "更新超时，请重试",
      failureFallback: "更新失败",
      onResult: (result) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "更新失败"),
            icon: "none"
          })
          return
        }
        wx.showToast({
        title: formatToastTitle(result.message, "状态已更新"),
          icon: "success"
        })
        this.fetchList()
      }
    })
  },
  retireVehicle(id) {
    this.runVehicleMutation({
      id,
      stateField: "updatingId",
      name: "vehicleRetire",
      data: { id },
      loadingTitle: "停用中…",
      timeoutTitle: "停用超时，请重试",
      failureFallback: "停用失败",
      onResult: (result) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "停用失败"),
            icon: "none"
          })
          return
        }
        wx.showToast({
        title: formatToastTitle(result.message, "停用成功"),
          icon: "success"
        })
        this.fetchList()
      }
    })
  },
  restoreVehicle(id) {
    this.runVehicleMutation({
      id,
      stateField: "updatingId",
      name: "vehicleRestore",
      data: { id },
      loadingTitle: "恢复中…",
      timeoutTitle: "恢复超时，请重试",
      failureFallback: "恢复失败",
      onResult: (result) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "恢复失败"),
            icon: "none"
          })
          return
        }
        wx.showToast({
        title: formatToastTitle(result.message, "恢复成功"),
          icon: "success"
        })
        this.fetchList()
      }
    })
  },
  deleteVehicle(id) {
    if (this.data.deletingId) {
      return
    }
    this.runVehicleMutation({
      id,
      stateField: "deletingId",
      name: "vehicleDelete",
      data: { id },
      loadingTitle: "删除中…",
      timeoutTitle: "删除超时，请重试",
      failureFallback: "删除失败",
      onResult: (result) => {
        if (!result || !result.ok) {
          this.showDeleteFailure(id, result)
          return
        }
        wx.showToast({
        title: formatToastTitle(result.message, "删除成功"),
          icon: "success"
        })
        this.fetchList()
      },
      onFailure: () => {
        this.showDeleteFailure(id, null)
      }
    })
  },
  runVehicleMutation(options) {
    const input = options && typeof options === "object" ? options : {}
    const id = String(input.id || "").trim()
    if (!id || this.data.loading || this.data.updatingId || this.data.deletingId) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }
    const requestId = Number(this._vehicleMutationRequestId || 0) + 1
    this._vehicleMutationRequestId = requestId
    this.finishVehicleMutationEffects()
    const stateField = input.stateField === "deletingId" ? "deletingId" : "updatingId"
    this.setData({ [stateField]: id })
    wx.showLoading({
      title: input.loadingTitle || "处理中…",
      mask: true
    })
    this._vehicleMutationLoadingVisible = true
    let settled = false
    const finishRequest = () => {
      if (settled || this._vehicleMutationRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishVehicleMutationEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ [stateField]: "" })
      if (typeof input.onFailure === "function") {
        input.onFailure(message)
        return
      }
      wx.showToast({
        title: formatToastTitle(message, input.failureFallback || "操作失败"),
        icon: "none"
      })
    }
    this._vehicleMutationRequestTimer = setTimeout(() => {
      handleFailure(input.timeoutTitle || "操作超时，请重试")
    }, VEHICLE_MUTATION_TIMEOUT_MS)
    const requestOptions = {
      name: input.name,
      data: input.data,
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        this.setData({ [stateField]: "" })
        const result = res && res.result ? res.result : null
        if (typeof input.onResult === "function") {
          input.onResult(result)
        }
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
  showDeleteFailure(id, result) {
    const code = String((result && result.code) || "").trim()
    const message = String((result && result.message) || "").trim()
    if (code === "VEHICLE_HAS_BOOKINGS") {
      const action = beginPageNativeAction(this)
      wx.showModal({
        title: "无法彻底删除",
        content: message || "该车辆存在预约记录。为保留历史记录，可以将车辆改为停用，停用后用户端不再展示。",
        confirmText: "改为停用",
        cancelText: "暂不处理",
        confirmColor: "#d46868",
        success: (modalRes) => {
          if (isPageNativeActionActive(this, action) && modalRes && modalRes.confirm) {
            this.retireVehicle(id)
          }
        }
      })
      return
    }
    if (code === "NOT_FOUND") {
      const action = beginPageNativeAction(this)
      wx.showModal({
        title: "车辆已不存在",
        content: message || "该车辆可能已被其他管理员删除，列表将自动刷新。",
        showCancel: false,
        confirmText: "知道了",
        confirmColor: "#528fff",
        success: () => {
          if (isPageNativeActionActive(this, action)) {
            this.fetchList()
          }
        }
      })
      return
    }
    const content = code === "FORBIDDEN"
      ? "当前账号没有删除车辆的权限，请重新进入小程序刷新权限，或检查管理员配置。"
      : message || "云端删除请求未完成，请检查网络后重试。"
    const action = beginPageNativeAction(this)
    wx.showModal({
      title: code === "FORBIDDEN" ? "无删除权限" : "删除未完成",
      content,
      confirmText: code === "FORBIDDEN" ? "知道了" : "重试",
      cancelText: "取消",
      showCancel: code !== "FORBIDDEN",
      confirmColor: code === "FORBIDDEN" ? "#528fff" : "#d46868",
      success: (modalRes) => {
        if (
          isPageNativeActionActive(this, action) &&
          code !== "FORBIDDEN" &&
          modalRes &&
          modalRes.confirm
        ) {
          this.deleteVehicle(id)
        }
      }
    })
  },
  fetchList(input) {
    const done = typeof input === "function" ? input : input && input.done
    const append = Boolean(input && typeof input === "object" && input.append)
    const nextPage = append ? this.data.page + 1 : 0
    const pageSize = this.data.pageSize || DEFAULT_PAGE_SIZE
    const requestId = Number(this._vehicleListRequestId || 0) + 1
    this._vehicleListRequestId = requestId
    this.finishVehicleListRequestEffects()
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      if (typeof done === "function") {
        done()
      }
      return
    }
    const filters = {
      keyword: String(this.data.keyword || "").trim(),
      status: this.data.currentStatus,
      page: nextPage,
      pageSize
    }
    this._vehicleListRequestDone = typeof done === "function" ? done : null
    this.setData({
      loading: true
    })
    let settled = false
    const finishRequest = () => {
      if (settled || this._vehicleListRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishVehicleListRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      wx.showToast({
        title: formatToastTitle(message, "查询失败"),
        icon: "none"
      })
      this.setData({
        loading: false,
        page: append ? this.data.page : 0,
        hasMore: append ? this.data.hasMore : false,
        list: append ? this.data.list : []
      })
    }
    this._vehicleListRequestTimer = setTimeout(() => {
      handleFailure("查询超时，请重试")
    }, VEHICLE_LIST_TIMEOUT_MS)
    const requestOptions = {
      name: "vehicleList",
      data: filters,
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "查询失败"),
            icon: "none"
          })
          this.setData({
            loading: false
          })
          return
        }
        const list = Array.isArray(result.list)
          ? result.list.map((item) => ({
              ...item,
              plateNumber: vehicleUtils.normalizePlateNumber(item.plateNumber),
              statusText: STATUS_LABEL_MAP[item.status] || item.status || "未知",
              statusClass: STATUS_CLASS_MAP[item.status] || "status-idle",
              vehicleTypeText: VEHICLE_TYPE_LABEL_MAP[item.vehicleType] || item.vehicleType || "未知",
              updatedAtText: formatDisplayTime(item.updatedAt || item.createdAt),
              locationText: item.location ? String(item.location).trim() : "—",
              priceDayText: formatPriceDayText(item.priceDay),
              transmissionText:
                TRANSMISSION_LABEL_MAP[item.transmission] || (item.transmission ? String(item.transmission) : "—"),
              fuelTypeText: FUEL_TYPE_LABEL_MAP[item.fuelType] || (item.fuelType ? String(item.fuelType) : "—"),
              seatsText: Number.isInteger(item.seats) && item.seats > 0 ? `${item.seats} 座` : "—",
              ...buildMediaHealth(item),
              ...buildArchiveHealthView(item)
            }))
          : []
        const nextList = append ? this.data.list.concat(list) : list
        this.setData({
          loading: false,
          total: result.total || 0,
          truncated: Boolean(result.truncated),
          summaryItems: buildStatusSummary(result.dashboard || {}),
          statusRatioSegments: buildStatusRatioSegments(result.dashboard || {}),
          archiveSummaryItems: buildArchiveSummary(result.archiveDashboard || {}),
          recentAddedList: buildRecentAddedViewModel(result.recentAddedList),
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          list: nextList
        })
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
  finishVehicleListRequestEffects() {
    if (this._vehicleListRequestTimer) {
      clearTimeout(this._vehicleListRequestTimer)
      this._vehicleListRequestTimer = null
    }
    const done = this._vehicleListRequestDone
    this._vehicleListRequestDone = null
    if (typeof done === "function") {
      done()
    }
  },
  finishVehicleMutationEffects() {
    if (this._vehicleMutationRequestTimer) {
      clearTimeout(this._vehicleMutationRequestTimer)
      this._vehicleMutationRequestTimer = null
    }
    if (this._vehicleMutationLoadingVisible) {
      this._vehicleMutationLoadingVisible = false
      wx.hideLoading()
    }
  }
})
