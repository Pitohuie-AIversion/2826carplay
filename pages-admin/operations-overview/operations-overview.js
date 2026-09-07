const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

const BOOKING_STATUS_LABELS = {
  pending: "待联系",
  contacted: "已联系",
  quoted: "已报价",
  adjustment_requested: "待调整",
  confirmed: "已确认",
  completed: "已完成",
  cancelled: "已取消"
}

const VEHICLE_STATUS_LABELS = {
  idle: "可预约",
  active: "使用中",
  maintenance: "维护中",
  retired: "已停用"
}

const OVERVIEW_SOURCE_TIMEOUT_MS = 15 * 1000

function callCloud(name, data) {
  return new Promise((resolve) => {
    let settled = false
    let timeoutId = null
    const finish = (result) => {
      if (settled) {
        return
      }
      settled = true
      if (timeoutId) {
        clearTimeout(timeoutId)
        timeoutId = null
      }
      resolve(result)
    }
    const handleFailure = (error) => {
      finish({
        ok: false,
        message: (error && (error.errMsg || error.message)) || "数据加载失败"
      })
    }

    timeoutId = setTimeout(() => {
      handleFailure({ message: "数据请求超时，请稍后刷新" })
    }, OVERVIEW_SOURCE_TIMEOUT_MS)

    try {
      wx.cloud.callFunction({
        name,
        data: data || {},
        success: (res) => {
          const result = res && res.result ? res.result : null
          if (!result || !result.ok) {
            finish({
              ok: false,
              message: (result && result.message) || "数据加载失败"
            })
            return
          }
          finish(result)
        },
        fail: handleFailure
      })
    } catch (error) {
      handleFailure(error)
    }
  })
}

function formatShortTime(value) {
  if (!value) {
    return "—"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "—"
  }
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")
  return `${month}-${day} ${hour}:${minute}`
}

function buildVehicleMetrics(result) {
  const stats = result && result.stats ? result.stats : {}
  const dashboard = result && result.dashboard ? result.dashboard : {}
  return [
    { key: "total", label: "车辆总数", value: Number(stats.total) || 0, tone: "neutral", iconClass: "metric-icon-fleet" },
    { key: "idle", label: "可预约", value: Number(dashboard.idle) || 0, tone: "success", iconClass: "metric-icon-idle" },
    { key: "active", label: "使用中", value: Number(dashboard.active) || 0, tone: "primary", iconClass: "metric-icon-active" },
    { key: "maintenance", label: "维护中", value: Number(dashboard.maintenance) || 0, tone: "warning", iconClass: "metric-icon-maintenance" }
  ]
}

function buildBookingMetrics(result) {
  const dashboard = result && result.dashboard ? result.dashboard : {}
  return [
    { key: "total", label: "预约总数", value: Number(dashboard.total) || 0, tone: "neutral", iconClass: "metric-icon-calendar" },
    { key: "pending", label: "待联系", value: Number(dashboard.pending) || 0, tone: "warning", iconClass: "metric-icon-contact" },
    { key: "contacted", label: "跟进中", value: Number(dashboard.contacted) || 0, tone: "primary", iconClass: "metric-icon-progress" },
    { key: "recent", label: "近 7 天", value: Number(dashboard.recentCreated7d) || 0, tone: "success", iconClass: "metric-icon-recent" }
  ]
}

function buildRecentBookings(result) {
  const list = result && Array.isArray(result.recentCreatedList) ? result.recentCreatedList : []
  return list.slice(0, 3).map((item) => ({
    id: item.id || item._id || "",
    title: item.vehicleName || "车辆预约",
    meta: `${item.userName || "未填写姓名"} · ${item.city || "未填写城市"}`,
    statusLabel: BOOKING_STATUS_LABELS[item.status] || "待处理",
    statusClass: `status-${item.status || "pending"}`,
    itemClass: "recent-booking",
    iconClass: "recent-native-icon-booking",
    timeText: formatShortTime(item.createdAt)
  }))
}

function buildRecentVehicles(result) {
  const list = result && Array.isArray(result.recentAddedList) ? result.recentAddedList : []
  return list.slice(0, 3).map((item) => ({
    id: item.id || item._id || "",
    title: item.brandModel || "未命名车辆",
    meta: item.plateNumber || "未填写车牌",
    statusLabel: VEHICLE_STATUS_LABELS[item.status] || "状态未知",
    statusClass: `vehicle-${item.status || "idle"}`,
    itemClass: "recent-vehicle",
    iconClass: "recent-native-icon-vehicle",
    timeText: formatShortTime(item.createdAt)
  }))
}

Page({
  data: {
    pageAuthorized: false,
    loading: true,
    refreshing: false,
    loadError: "",
    canManageVehicles: false,
    canManageBookings: false,
    canManageRoles: false,
    vehicleLoaded: false,
    bookingLoaded: false,
    summaryLoaded: false,
    vehicleMetrics: [],
    bookingMetrics: [],
    pendingPrivacyCount: 0,
    processingPrivacyCount: 0,
    storageCleanupPendingCount: 0,
    recentBookings: [],
    recentVehicles: [],
    alerts: [],
    pendingActionCount: 0,
    attentionAreaCount: 0,
    loadedSourceCount: 0,
    requestedSourceCount: 0,
    syncProgress: 0,
    syncStateLabel: "等待同步",
    syncStateClass: "sync-state-pending",
    operationStateLabel: "等待汇总",
    operationStateClass: "operation-state-pending",
    lastSyncedText: ""
  },

  onLoad() {
    activatePageNativeActions(this)
    requirePagePermission(this, {
      required: (result) =>
        Boolean(result.canManageVehicles || result.canManageBookings || result.canManageRoles),
      noPermissionMessage: "无权查看运营概览",
      onAuthorized: (result) => {
        this.setData({
          canManageVehicles: Boolean(result.canManageVehicles),
          canManageBookings: Boolean(result.canManageBookings),
          canManageRoles: Boolean(result.canManageRoles)
        })
        this.loadOverview()
      }
    })
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadOverview({
      refreshing: true,
      done: () => wx.stopPullDownRefresh()
    })
  },

  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    this._overviewRequestId = Number(this._overviewRequestId || 0) + 1
    this.finishOverviewRequestEffects()
  },

  handleRefresh() {
    if (!this.data.loading && !this.data.refreshing) {
      this.loadOverview({ refreshing: true })
    }
  },

  handleRouteTap(event) {
    const url = String(event.currentTarget.dataset.url || "")
    if (!url) {
      return
    }
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url,
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

  loadOverview(options) {
    const input = options && typeof options === "object" ? options : {}
    this.finishOverviewRequestEffects()
    const requestId = Number(this._overviewRequestId || 0) + 1
    this._overviewRequestId = requestId
    this._overviewRequestDone =
      typeof input.done === "function" ? input.done : null

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        refreshing: false,
        loadError: "云能力未初始化"
      })
      this.finishOverviewRequestEffects()
      return
    }

    const permissions = {
      canManageVehicles: Boolean(this.data.canManageVehicles),
      canManageBookings: Boolean(this.data.canManageBookings),
      canManageRoles: Boolean(this.data.canManageRoles)
    }
    const requestedSourceCount =
      Number(permissions.canManageVehicles) +
      Number(permissions.canManageBookings) +
      Number(permissions.canManageBookings || permissions.canManageRoles)
    this.setData({
      loading: !input.refreshing,
      refreshing: Boolean(input.refreshing),
      loadError: "",
      requestedSourceCount
    })

    const vehicleTask = permissions.canManageVehicles
      ? callCloud("vehicleList", { page: 0, pageSize: 1 })
      : Promise.resolve(null)
    const bookingTask = permissions.canManageBookings
      ? callCloud("bookingList", { page: 0, pageSize: 1 })
      : Promise.resolve(null)
    const summaryTask = permissions.canManageBookings || permissions.canManageRoles
      ? callCloud("operationSummaryGet")
      : Promise.resolve(null)

    let settled = false
    const isCurrent = () => this._overviewRequestId === requestId
    const finishRequest = () => {
      if (settled || !isCurrent()) {
        return false
      }
      settled = true
      this.finishOverviewRequestEffects()
      return true
    }

    Promise.all([vehicleTask, bookingTask, summaryTask])
      .then(([vehicleResult, bookingResult, summaryResult]) => {
        const vehicleLoaded = Boolean(vehicleResult && vehicleResult.ok)
        const bookingLoaded = Boolean(bookingResult && bookingResult.ok)
        const summaryLoaded = Boolean(summaryResult && summaryResult.ok)
        const errors = [vehicleResult, bookingResult, summaryResult]
          .filter((result) => result && !result.ok && result.message)
          .map((result) => result.message)

        const summaryCounts = summaryLoaded && summaryResult.counts ? summaryResult.counts : {}
        const unavailableMetrics =
          summaryLoaded && Array.isArray(summaryResult.unavailable) ? summaryResult.unavailable : []
        const bookingCountAvailable =
          summaryLoaded && !unavailableMetrics.includes("bookingPending")
        const pendingBookings =
          bookingCountAvailable
            ? Number(summaryCounts.bookingPending) || 0
            : bookingLoaded && bookingResult.dashboard
              ? Number(bookingResult.dashboard.pending) || 0
              : 0
        const hasCoordinationCount = Object.prototype.hasOwnProperty.call(
          summaryCounts,
          "bookingCoordinationPending"
        )
        const coordinationCountAvailable =
          hasCoordinationCount
            ? !unavailableMetrics.includes("bookingCoordinationPending")
            : bookingCountAvailable
        const pendingCoordination =
          hasCoordinationCount
            ? Number(summaryCounts.bookingCoordinationPending) || 0
            : pendingBookings
        const maintenanceVehicles =
          vehicleLoaded && vehicleResult.dashboard ? Number(vehicleResult.dashboard.maintenance) || 0 : 0
        const privacyCountAvailable =
          summaryLoaded &&
          !unavailableMetrics.includes("privacyPending") &&
          !unavailableMetrics.includes("privacyProcessing")
        const pendingPrivacyCount = privacyCountAvailable ? Number(summaryCounts.privacyPending) || 0 : 0
        const processingPrivacyCount = privacyCountAvailable
          ? Number(summaryCounts.privacyProcessing) || 0
          : 0
        const storageCountAvailable =
          summaryLoaded && !unavailableMetrics.includes("storageCleanupPending")
        const storageCleanupPendingCount = storageCountAvailable
          ? Number(summaryCounts.storageCleanupPending) || 0
          : 0
        const alerts = []

        if (
          permissions.canManageBookings &&
          (coordinationCountAvailable || (!hasCoordinationCount && bookingLoaded))
        ) {
          alerts.push({
            key: "booking",
            title: `${pendingCoordination} 条预约待协调`,
            desc: pendingCoordination
              ? "建议进入工作台按优先级和用车日期处理"
              : "当前没有待协调预约",
            value: pendingCoordination,
            tone: pendingCoordination ? "warning" : "success",
            url: "/pages/booking-workbench/booking-workbench"
          })
        } else if (permissions.canManageBookings) {
          alerts.push({
            key: "booking",
            title: "预约待办暂不可用",
            desc: "其他运营数据仍可正常查看",
            value: 0,
            tone: "neutral",
            url: "/pages/booking-workbench/booking-workbench"
          })
        }
        if (permissions.canManageVehicles && vehicleLoaded) {
          alerts.push({
            key: "vehicle",
            title: `${maintenanceVehicles} 辆车正在维护`,
            desc: maintenanceVehicles ? "请确认恢复时间和公开展示状态" : "当前没有维护中车辆",
            value: maintenanceVehicles,
            tone: maintenanceVehicles ? "primary" : "success",
            url: "/pages-admin/vehicle-manage/vehicle-manage"
          })
        } else if (permissions.canManageVehicles) {
          alerts.push({
            key: "vehicle",
            title: "车辆待办暂不可用",
            desc: "其他运营数据仍可正常查看",
            value: 0,
            tone: "neutral",
            url: "/pages-admin/vehicle-manage/vehicle-manage"
          })
        }
        if (permissions.canManageRoles && privacyCountAvailable) {
          alerts.push({
            key: "privacy",
            title: `${pendingPrivacyCount} 条待处理，${processingPrivacyCount} 条处理中`,
            desc:
              pendingPrivacyCount || processingPrivacyCount
                ? "请及时核验并反馈隐私申请处理结果"
                : "当前没有进行中的隐私申请",
            value: pendingPrivacyCount + processingPrivacyCount,
            tone: pendingPrivacyCount || processingPrivacyCount ? "warning" : "success",
            url: "/pages-admin/privacy-request-manage/privacy-request-manage"
          })
        } else if (permissions.canManageRoles) {
          alerts.push({
            key: "privacy",
            title: "隐私待办暂不可用",
            desc: "其他运营数据仍可正常查看",
            value: 0,
            tone: "neutral",
            url: "/pages-admin/privacy-request-manage/privacy-request-manage"
          })
        }
        if (permissions.canManageRoles && storageCountAvailable) {
          alerts.push({
            key: "storage",
            title: `${storageCleanupPendingCount} 条存储清理待重试`,
            desc: storageCleanupPendingCount ? "存在未成功删除的车辆图片" : "存储清理队列正常",
            value: storageCleanupPendingCount,
            tone: storageCleanupPendingCount ? "primary" : "success",
            url: "/pages/mine/mine"
          })
        }

        const loadedSourceCount =
          Number(vehicleLoaded) + Number(bookingLoaded) + Number(summaryLoaded)
        const actionableAlerts = alerts.filter(
          (item) => item.tone !== "neutral" && Number(item.value) > 0
        )
        const pendingActionCount = actionableAlerts.reduce(
          (total, item) => total + Number(item.value || 0),
          0
        )
        const syncProgress = requestedSourceCount
          ? Math.round((loadedSourceCount / requestedSourceCount) * 100)
          : 0
        const alertViews = alerts.map((item) => ({
          ...item,
          iconClass: `alert-native-icon-${item.key}`,
          actionLabel: Number(item.value) > 0 ? "立即处理" : "查看详情"
        }))

        if (!finishRequest()) {
          return
        }
        this.setData({
          loading: false,
          refreshing: false,
          loadError: errors.length ? errors[0] : "",
          vehicleLoaded,
          bookingLoaded,
          summaryLoaded,
          vehicleMetrics: vehicleLoaded ? buildVehicleMetrics(vehicleResult) : [],
          bookingMetrics: bookingLoaded ? buildBookingMetrics(bookingResult) : [],
          pendingPrivacyCount,
          processingPrivacyCount,
          storageCleanupPendingCount,
          recentBookings: bookingLoaded ? buildRecentBookings(bookingResult) : [],
          recentVehicles: vehicleLoaded ? buildRecentVehicles(vehicleResult) : [],
          alerts: alertViews,
          pendingActionCount,
          attentionAreaCount: actionableAlerts.length,
          loadedSourceCount,
          requestedSourceCount,
          syncProgress,
          syncStateLabel:
            loadedSourceCount === requestedSourceCount ? "数据源已同步" : "部分数据可用",
          syncStateClass:
            loadedSourceCount === requestedSourceCount ? "sync-state-complete" : "sync-state-partial",
          operationStateLabel: pendingActionCount ? "有待办需要处理" : "当前运营平稳",
          operationStateClass: pendingActionCount ? "operation-state-attention" : "operation-state-clear",
          lastSyncedText:
            loadedSourceCount > 0 ? formatShortTime(Date.now()) : this.data.lastSyncedText
        })
      })
      .catch(() => {
        if (!finishRequest()) {
          return
        }
        this.setData({
          loading: false,
          refreshing: false,
          loadError: "运营数据加载失败，请稍后重试"
        })
      })
  },

  finishOverviewRequestEffects() {
    if (typeof this._overviewRequestDone === "function") {
      const done = this._overviewRequestDone
      this._overviewRequestDone = null
      done()
    }
  }
})
