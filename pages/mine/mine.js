const { formatToastTitle } = require("../../shared/uiFeedback")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const { CURRENT_VERSION, showReleaseNotesModal } = require("../../shared/versionMigration")

const MENU_ITEMS = [
  { key: "bookings", title: "我的预约", desc: "查看已提交的预约咨询", section: "会员服务", sectionKicker: "MEMBER", icon: "calendar" },
  { key: "favorites", title: "我的收藏", desc: "收藏喜欢的车型，方便再次查看", section: "会员服务", sectionKicker: "MEMBER", icon: "heart" },
  { key: "faq", title: "常见问题", desc: "了解预约流程、档期与取还车说明", section: "会员服务", sectionKicker: "MEMBER", icon: "chat" },
  { key: "rules", title: "平台规则", desc: "价格、档期、押金和规则以客服最终确认为准", section: "会员服务", sectionKicker: "MEMBER", icon: "document" },
  { key: "privacy", title: "隐私政策", desc: "了解个人信息的收集、使用与删除方式", section: "会员服务", sectionKicker: "MEMBER", icon: "shield" },
  { key: "privacyRequest", title: "个人信息申请", desc: "提交查询、更正或删除申请并查看处理进度", section: "会员服务", sectionKicker: "MEMBER", icon: "lock" },
  { key: "operationsOverview", title: "运营概览", desc: "集中查看预约、车辆状态与待办提醒", section: "运营管理", sectionKicker: "OPERATIONS", icon: "dashboard" },
  { key: "analyticsManage", title: "数据分析", desc: "查看车辆热度、预约漏斗与行为趋势", section: "运营管理", sectionKicker: "OPERATIONS", icon: "chart" },
  { key: "bookingWorkbench", title: "待协调工作台", desc: "集中处理优先、候补与超时预约", section: "运营管理", sectionKicker: "OPERATIONS", icon: "queue" },
  { key: "bookingCalendar", title: "预约日历", desc: "按月查看每日预约与车辆档期安排", section: "运营管理", sectionKicker: "OPERATIONS", icon: "calendar" },
  { key: "vehicleManage", title: "车辆管理", desc: "查看已录入车辆并按状态筛选", section: "运营管理", sectionKicker: "OPERATIONS", icon: "car" },
  { key: "vehicleCreate", title: "新增车辆", desc: "录入新的车辆信息", section: "运营管理", sectionKicker: "OPERATIONS", icon: "plus" },
  { key: "bookingManage", title: "预约管理", desc: "查看全部预约并更新状态", section: "运营管理", sectionKicker: "OPERATIONS", icon: "calendar" },
  { key: "contentGuideMaintain", title: "内容维护", desc: "后续版本提供：维护内容攻略、草稿与发布排期", section: "运营管理", sectionKicker: "OPERATIONS", icon: "book", soon: true,
    soonReason: "暂未开放内容维护页，当前请通过云开发控制台 contentGuideManage 维护 content_guides 集合。" },
  { key: "roleManage", title: "权限管理", desc: "按 OpenID 分配车辆与预约管理权限", section: "系统管理", sectionKicker: "SYSTEM", icon: "users" },
  { key: "configManage", title: "运营配置", desc: "配置品牌、电话、首页文案与预约说明", section: "系统管理", sectionKicker: "SYSTEM", icon: "sliders" },
  { key: "auditLogManage", title: "审计日志", desc: "查看权限分配与配置变更记录", section: "系统管理", sectionKicker: "SYSTEM", icon: "document" },
  { key: "errorLogManage", title: "错误日志", desc: "查看云函数异常记录，便于线上排障", section: "系统管理", sectionKicker: "SYSTEM", icon: "alert" },
  { key: "systemHealth", title: "上线检查", desc: "只读检查云环境数据与关键配置", section: "系统管理", sectionKicker: "SYSTEM", icon: "check" },
  { key: "privacyRequestManage", title: "隐私申请处理", desc: "处理用户个人信息查询、更正与删除申请", section: "系统管理", sectionKicker: "SYSTEM", icon: "shield" },
  { key: "storageCleanup", title: "存储清理", desc: "重试清理删除失败的车辆图片", section: "系统管理", sectionKicker: "SYSTEM", icon: "trash" },
  { key: "getOpenid", title: "查询 OpenID", desc: "获取当前微信用户的 OpenID 并复制", section: "账户工具", sectionKicker: "UTILITIES", icon: "key" },
  { key: "bootstrapAdmin", title: "初始化管理员", desc: "仅限首次配置时使用，自动把当前账号设为首个管理员", section: "账户工具", sectionKicker: "UTILITIES", icon: "lock" }
]

const MEMBER_QUICK_ACTIONS = [
  {
    key: "bookings",
    title: "我的预约",
    desc: "查看进度",
    kicker: "BOOKINGS",
    icon: "calendar",
    accent: "blue"
  },
  {
    key: "favorites",
    title: "我的收藏",
    desc: "心仪车辆",
    kicker: "FAVORITES",
    icon: "heart",
    accent: "green"
  },
  {
    key: "privacyRequest",
    title: "信息申请",
    desc: "资料权益",
    kicker: "PRIVACY",
    icon: "lock",
    accent: "violet"
  }
]
const MEMBER_QUICK_ACTION_KEYS = new Set(MEMBER_QUICK_ACTIONS.map((item) => item.key))
const MENU_ROUTE_MAP = Object.freeze({
  analyticsManage: "/pages-admin/analytics-manage/analytics-manage",
  auditLogManage: "/pages-admin/audit-log-manage/audit-log-manage",
  bookingCalendar: "/pages/booking-calendar/booking-calendar",
  bookingManage: "/pages/booking-manage/booking-manage",
  bookings: "/pages/bookings/bookings",
  bookingWorkbench: "/pages/booking-workbench/booking-workbench",
  configManage: "/pages-admin/config-manage/config-manage",
  errorLogManage: "/pages-admin/error-log-manage/error-log-manage",
  faq: "/pages/content-page/content-page?type=faq",
  favorites: "/pages/favorites/favorites",
  operationsOverview: "/pages-admin/operations-overview/operations-overview",
  privacy: "/pages/content-page/content-page?type=privacy",
  privacyRequest: "/pages/privacy-request/privacy-request",
  privacyRequestManage: "/pages-admin/privacy-request-manage/privacy-request-manage",
  roleManage: "/pages-admin/role-manage/role-manage",
  rules: "/pages/content-page/content-page?type=rules",
  systemHealth: "/pages-admin/system-health/system-health",
  vehicleCreate: "/pages-admin/vehicle-create/vehicle-create",
  vehicleManage: "/pages-admin/vehicle-manage/vehicle-manage"
})

function buildVisibleMenuItems(options) {
  const input = options && typeof options === "object" ? options : {}
  const envVersion = input.envVersion || "release"
  const canManageVehicles = Boolean(input.canManageVehicles)
  const canManageBookings = Boolean(input.canManageBookings)
  const canManageRoles = Boolean(input.canManageRoles)
  const canManageConfig = Boolean(input.canManageConfig)
  const canViewAuditLogs = Boolean(input.canViewAuditLogs)
  const canViewErrorLogs = Boolean(input.canViewErrorLogs)

  const visibleItems = MENU_ITEMS.filter((item) => {
    if (MEMBER_QUICK_ACTION_KEYS.has(item.key)) {
      return false
    }

    if (item.key === "bootstrapAdmin" && (envVersion === "release" || canManageRoles)) {
      return false
    }

    if ((item.key === "vehicleManage" || item.key === "vehicleCreate") && !canManageVehicles) {
      return false
    }

    if (item.key === "operationsOverview" && !canManageVehicles && !canManageBookings && !canManageRoles) {
      return false
    }

    if (item.key === "analyticsManage" && !canManageVehicles && !canManageBookings && !canManageRoles) {
      return false
    }

    if (
      (item.key === "bookingManage" || item.key === "bookingWorkbench") &&
      !canManageBookings
    ) {
      return false
    }

    if (item.key === "bookingCalendar" && !canManageBookings) {
      return false
    }

    if (item.key === "roleManage" && !canManageRoles) {
      return false
    }

    if (item.key === "configManage" && !canManageConfig) {
      return false
    }

    if (item.key === "auditLogManage" && !canViewAuditLogs) {
      return false
    }

    if (item.key === "errorLogManage" && !canViewErrorLogs) {
      return false
    }

    if (
      (item.key === "storageCleanup" ||
        item.key === "privacyRequestManage" ||
        item.key === "systemHealth") &&
      !canManageRoles
    ) {
      return false
    }

    return true
  })

  return visibleItems.map((item, index) => ({
    ...item,
    showSectionHeader: index === 0 || visibleItems[index - 1].section !== item.section
  }))
}

function formatBadgeCount(value) {
  const count = Number(value)
  if (!Number.isFinite(count) || count <= 0) {
    return ""
  }
  return count > 99 ? "99+" : String(Math.floor(count))
}

function applyOperationSummary(menuItems, summary) {
  const list = Array.isArray(menuItems) ? menuItems : []
  const counts = summary && typeof summary === "object" ? summary : {}
  const badgeCounts = {
    bookingManage: Number(counts.bookingPending) || 0,
    bookingWorkbench:
      Number(
        Object.prototype.hasOwnProperty.call(counts, "bookingCoordinationPending")
          ? counts.bookingCoordinationPending
          : counts.bookingPending
      ) || 0,
    privacyRequestManage:
      (Number(counts.privacyPending) || 0) + (Number(counts.privacyProcessing) || 0),
    storageCleanup: Number(counts.storageCleanupPending) || 0
  }

  return list.map((item) => ({
    ...item,
    badgeText: formatBadgeCount(badgeCounts[item.key])
  }))
}

function formatSummaryTime(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) {
    return "—"
  }
  const pad = (number) => String(number).padStart(2, "0")
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function buildOperationPulse(summary) {
  const source = summary && typeof summary === "object" ? summary : {}
  const counts = source.counts && typeof source.counts === "object" ? source.counts : {}
  const unavailable = new Set(Array.isArray(source.unavailable) ? source.unavailable : [])
  const items = []
  const iconClasses = {
    booking: "operation-pulse-icon-booking",
    privacy: "operation-pulse-icon-privacy",
    storage: "operation-pulse-icon-storage"
  }
  const hasOwn = (key) => Object.prototype.hasOwnProperty.call(counts, key)
  const addItem = (key, label, value, isUnavailable) => {
    items.push({
      key,
      label,
      iconClass: iconClasses[key] || "operation-pulse-icon-default",
      value: isUnavailable ? 0 : Number(value) || 0,
      displayValue: isUnavailable ? "—" : formatBadgeCount(value) || "0",
      unavailable: Boolean(isUnavailable)
    })
  }

  if (hasOwn("bookingCoordinationPending") || hasOwn("bookingPending")) {
    const coordinationKey = hasOwn("bookingCoordinationPending")
      ? "bookingCoordinationPending"
      : "bookingPending"
    addItem(
      "booking",
      "预约协调",
      counts[coordinationKey],
      unavailable.has(coordinationKey)
    )
  }

  if (hasOwn("privacyPending") || hasOwn("privacyProcessing")) {
    const privacyUnavailable =
      unavailable.has("privacyPending") || unavailable.has("privacyProcessing")
    addItem(
      "privacy",
      "隐私申请",
      (Number(counts.privacyPending) || 0) + (Number(counts.privacyProcessing) || 0),
      privacyUnavailable
    )
  }

  if (hasOwn("storageCleanupPending")) {
    addItem(
      "storage",
      "存储清理",
      counts.storageCleanupPending,
      unavailable.has("storageCleanupPending")
    )
  }

  const availableItems = items.filter((item) => !item.unavailable)
  return {
    visible: items.length > 0,
    total: availableItems.reduce((total, item) => total + item.value, 0),
    attentionAreas: availableItems.filter((item) => item.value > 0).length,
    partial: Boolean(source.partial || items.some((item) => item.unavailable)),
    updatedText: formatSummaryTime(),
    items
  }
}

function buildMemberRole(result) {
  const source = result && typeof result === "object" ? result : {}
  if (source.isAdmin) {
    return {
      roleKicker: "GARAGE ADMIN",
      roleLabel: "车库管理员",
      roleClass: "profile-role-admin"
    }
  }

  const hasOperationsAccess = Boolean(source.canManageVehicles || source.canManageBookings)
  if (hasOperationsAccess) {
    return {
      roleKicker: "OPERATIONS MEMBER",
      roleLabel: "运营成员",
      roleClass: "profile-role-operations"
    }
  }

  return {
    roleKicker: "PRIVATE MEMBER",
    roleLabel: "私人会员",
    roleClass: "profile-role-member"
  }
}

function buildPermissionFailureRole() {
  return {
    roleKicker: "VERIFY FAILED",
    roleLabel: "身份确认失败",
    roleClass: "profile-role-loading"
  }
}

const PERMISSION_LOAD_TIMEOUT_MS = 12 * 1000
const SUMMARY_LOAD_TIMEOUT_MS = 15 * 1000
const MINE_TOOL_TIMEOUT_MS = 20 * 1000

Page({
  data: {
    brandName: "极境车库",
    servicePhone: "15715710090",
    userName: "车库来访者",
    userDesc: "查看预约、个人信息申请与车库服务",
    envVersion: "release",
    permissionsLoading: true,
    permissionsReady: false,
    permissionsError: "",
    summaryLoading: false,
    operationPulse: {
      visible: false,
      total: 0,
      attentionAreas: 0,
      partial: false,
      updatedText: "—",
      items: []
    },
    myPermissions: {},
    roleKicker: "VERIFYING",
    roleLabel: "正在确认身份",
    roleClass: "profile-role-loading",
    appVersion: CURRENT_VERSION,
    memberQuickActions: MEMBER_QUICK_ACTIONS,
    menuItems: buildVisibleMenuItems({
      envVersion: "release",
      canManageRoles: false,
      canManageConfig: false,
      canViewAuditLogs: false,
      canViewErrorLogs: false,
      canManageVehicles: false,
      canManageBookings: false
    })
  },

  onLoad() {
    activatePageNativeActions(this)
    let envVersion = "release"
    try {
      const info = wx.getAccountInfoSync ? wx.getAccountInfoSync() : null
      envVersion =
        info && info.miniProgram && info.miniProgram.envVersion
          ? info.miniProgram.envVersion
          : envVersion
    } catch (error) {}

    this.setData({
      envVersion,
      menuItems: buildVisibleMenuItems({
        envVersion,
        canManageRoles: false,
        canManageConfig: false,
        canViewAuditLogs: false,
        canViewErrorLogs: false,
        canManageVehicles: false,
        canManageBookings: false
      })
    })

    this.loadMyPermissions()
    this.loadOperationConfig()
  },

  onShow() {
    if (
      this.data.permissionsReady &&
      !this.data.summaryLoading &&
      !this._mineToolActive
    ) {
      this.loadOperationSummary()
    }
  },

  onPullDownRefresh() {
    if (this._mineToolActive || this.data.summaryLoading || this.data.permissionsLoading) {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh()
      }
      return
    }
    this.loadOperationConfig()
    this.loadMyPermissions({
      done: () => {
        if (typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh()
        }
      }
    })
  },

  onUnload() {
    cancelPageNativeActions(this)
    this.cancelOperationConfigRequest()
    this._permissionRequestId = Number(this._permissionRequestId || 0) + 1
    this._summaryRequestId = Number(this._summaryRequestId || 0) + 1
    this._mineToolRequestId = Number(this._mineToolRequestId || 0) + 1
    this.finishPermissionEffects()
    this.clearPermissionTimer()
    this.clearSummaryTimer()
    this.finishMineToolEffects()
  },

  loadOperationConfig() {
    this.cancelOperationConfigRequest()
    this._cancelOperationConfigRequest = requestOperationConfig({
      onSuccess: (config) => {
        this.setData({
          brandName: config.brandName || this.data.brandName,
          servicePhone: config.servicePhone || this.data.servicePhone,
          userDesc: config.mineUserDesc || this.data.userDesc
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

  finishPermissionEffects() {
    this.clearPermissionTimer()
    if (typeof this._permissionLoadDone === "function") {
      const done = this._permissionLoadDone
      this._permissionLoadDone = null
      try {
        done()
      } catch (error) {}
    }
  },

  loadMyPermissions(options) {
    const input = options && typeof options === "object" ? options : {}
    const requestId = Number(this._permissionRequestId || 0) + 1
    this._permissionRequestId = requestId
    this.finishPermissionEffects()
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        permissionsLoading: false,
        permissionsReady: false,
        permissionsError: "云能力未初始化，点击重试",
        ...buildPermissionFailureRole()
      })
      if (typeof input.done === "function") {
        try { input.done() } catch (e) {}
      }
      return
    }

    this._permissionLoadDone = typeof input.done === "function" ? input.done : null
    this.setData({
      permissionsLoading: true,
      permissionsError: ""
    })

    let settled = false
    const isCurrent = () => this._permissionRequestId === requestId
    const finish = () => {
      if (settled || !isCurrent()) {
        return false
      }
      settled = true
      this.finishPermissionEffects()
      return true
    }
    const handleFailure = () => {
      if (!finish()) {
        return
      }
      this.setData({
        permissionsLoading: false,
        permissionsReady: false,
        permissionsError: "权限同步失败，点击重试",
        myPermissions: {},
        ...buildPermissionFailureRole()
      })
    }

    this._permissionRequestTimer = setTimeout(
      handleFailure,
      PERMISSION_LOAD_TIMEOUT_MS
    )

    try {
      wx.cloud.callFunction({
        name: "getMyPermissions",
        success: (res) => {
          const result = res && res.result ? res.result : null
          if (!result || !result.ok) {
            handleFailure()
            return
          }

          if (!finish()) {
            return
          }
          this.setData({
            permissionsLoading: false,
            permissionsReady: true,
            permissionsError: "",
            myPermissions: {
              canManageBookings: Boolean(result.canManageBookings),
              canManageRoles: Boolean(result.canManageRoles)
            },
            ...buildMemberRole(result),
            menuItems: buildVisibleMenuItems({
              envVersion: this.data.envVersion,
              canManageRoles: Boolean(result.canManageRoles),
              canManageConfig: Boolean(result.canManageConfig),
              canViewAuditLogs: Boolean(result.canViewAuditLogs),
              canViewErrorLogs: Boolean(result.canViewErrorLogs),
              canManageVehicles: Boolean(result.canManageVehicles),
              canManageBookings: Boolean(result.canManageBookings)
            })
          }, () => {
            if (isCurrent()) {
              this.loadOperationSummary(result)
            }
          })
        },
        fail: handleFailure
      })
    } catch (error) {
      handleFailure()
    }
  },

  handlePermissionRetry() {
    if (this.data.permissionsError && !this.data.permissionsLoading) {
      this.loadMyPermissions()
    }
  },

  loadOperationSummary(permissionResult) {
    const permissions =
      permissionResult && typeof permissionResult === "object"
        ? permissionResult
        : this.data.myPermissions || {}
    const canLoad = Boolean(permissions.canManageBookings || permissions.canManageRoles)
    if (
      !canLoad ||
      this.data.summaryLoading ||
      !wx.cloud ||
      typeof wx.cloud.callFunction !== "function"
    ) {
      return
    }

    const requestId = Number(this._summaryRequestId || 0) + 1
    this._summaryRequestId = requestId
    this.clearSummaryTimer()
    this.setData({ summaryLoading: true })
    let settled = false
    const finishRequest = () => {
      if (settled || this._summaryRequestId !== requestId) {
        return false
      }
      settled = true
      this.clearSummaryTimer()
      return true
    }
    const handleFailure = () => {
      if (!finishRequest()) {
        return
      }
      this.setData({ summaryLoading: false })
    }

    this._summaryRequestTimer = setTimeout(
      handleFailure,
      SUMMARY_LOAD_TIMEOUT_MS
    )

    const requestOptions = {
      name: "operationSummaryGet",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.counts) {
          handleFailure()
          return
        }
        if (!finishRequest()) {
          return
        }
        this.setData({
          menuItems: applyOperationSummary(this.data.menuItems, result.counts),
          operationPulse: buildOperationPulse(result),
          summaryLoading: false
        })
      },
      fail: handleFailure,
      complete: () => {}
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure()
    }
  },

  clearPermissionTimer() {
    if (this._permissionRequestTimer) {
      clearTimeout(this._permissionRequestTimer)
      this._permissionRequestTimer = null
    }
  },

  clearSummaryTimer() {
    if (this._summaryRequestTimer) {
      clearTimeout(this._summaryRequestTimer)
      this._summaryRequestTimer = null
    }
  },

  runMineTool(options) {
    const input = options && typeof options === "object" ? options : {}
    if (this._mineToolActive) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const requestId = Number(this._mineToolRequestId || 0) + 1
    this._mineToolRequestId = requestId
    this._mineToolActive = true
    this.clearMineToolTimer()
    if (typeof wx.showLoading === "function") {
      wx.showLoading({
        title: input.loadingTitle || "处理中…",
        mask: true
      })
    }

    let settled = false
    const finishRequest = () => {
      if (settled || this._mineToolRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishMineToolEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      wx.showToast({
        title: formatToastTitle(message, input.failureFallback || "操作失败"),
        icon: "none"
      })
    }

    this._mineToolTimer = setTimeout(() => {
      handleFailure(input.timeoutTitle || "操作超时，请重试")
    }, MINE_TOOL_TIMEOUT_MS)

    const requestOptions = {
      name: input.name,
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (typeof input.onResult === "function") {
          input.onResult(result)
        }
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      }
    }
    if (Object.prototype.hasOwnProperty.call(input, "data")) {
      requestOptions.data = input.data
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  clearMineToolTimer() {
    if (this._mineToolTimer) {
      clearTimeout(this._mineToolTimer)
      this._mineToolTimer = null
    }
  },

  finishMineToolEffects() {
    this.clearMineToolTimer()
    if (this._mineToolActive && typeof wx.hideLoading === "function") {
      wx.hideLoading()
    }
    this._mineToolActive = false
  },

  navigateToPage(url) {
    const target = String(url || "").trim()
    if (!target) {
      return
    }
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: target,
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

  handleOperationPulseTap() {
    this.navigateToPage(MENU_ROUTE_MAP.operationsOverview)
  },

  handleMenuTap(event) {
    const { key, title } = event.currentTarget.dataset
    if (
      this._mineToolActive &&
      ["storageCleanup", "bootstrapAdmin", "getOpenid"].includes(key)
    ) {
      return
    }

    const route = MENU_ROUTE_MAP[key]
    if (route) {
      this.navigateToPage(route)
      return
    }

    if (key === "contentGuideMaintain") {
      const menuItem = Array.isArray(MENU_ITEMS) ? MENU_ITEMS.find((entry) => entry.key === "contentGuideMaintain") : null
      wx.showModal({
        title: (menuItem && menuItem.title) || "内容维护",
        content: (menuItem && menuItem.soonReason) || "功能开发中，请稍后再试。",
        confirmText: "知道了",
        confirmColor: "#528fff",
        showCancel: false
      })
      return
    }

    if (key === "storageCleanup") {
      if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
        wx.showToast({
          title: "云能力未初始化",
          icon: "none"
        })
        return
      }

      const action = beginPageNativeAction(this, {
        exclusiveKey: "mine-tool-confirmation"
      })
      wx.showModal({
        title: "清理存储队列",
        content: "将重试删除此前清理失败的车辆图片，每次最多处理 5 条。确认继续？",
        confirmText: "确认清理",
        confirmColor: "#d46868",
        success: (modalRes) => {
          if (!isPageNativeActionActive(this, action) || !modalRes || !modalRes.confirm) {
            return
          }

          this.runMineTool({
            name: "pendingFileDeletionProcess",
            data: { limit: 5 },
            loadingTitle: "清理中…",
            timeoutTitle: "清理超时，请重试",
            failureFallback: "清理失败",
            onResult: (result) => {
              if (!result || !result.ok) {
                wx.showToast({
                  title: formatToastTitle(result && result.message, "清理失败"),
                  icon: "none"
                })
                return
              }

              const details = [
                `本次检查 ${result.processed || 0} 条`,
                `已清理 ${result.deleted || 0} 条`,
                `失败 ${result.failed || 0} 条`
              ]
              if (result.deferred) {
                details.push(`等待安全核验 ${result.deferred} 条`)
              }
              if (result.preserved) {
                details.push(`保留在用图片 ${result.preserved} 张`)
              }
              if (result.invalid) {
                details.push(`移除无效任务 ${result.invalid} 条`)
              }
              wx.showModal({
                title: "清理结果",
                content: `${details.join("，")}。${result.hasMore ? "队列仍有记录，可稍后再次执行。" : "当前队列已检查完毕。"}`,
                confirmText: "知道了",
                confirmColor: "#528fff",
                showCancel: false
              })
            }
          })
        }
      })
      return
    }

    if (key === "bootstrapAdmin") {
      if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
        wx.showToast({
          title: "云能力未初始化",
          icon: "none"
        })
        return
      }

      const action = beginPageNativeAction(this, {
        exclusiveKey: "mine-tool-confirmation"
      })
      wx.showModal({
        title: "输入初始化口令",
        content: "仅当 roles 集合没有任何记录时可用，口令只随本次请求发送。",
        confirmText: "确认初始化",
        confirmColor: "#528fff",
        editable: true,
        placeholderText: "BOOTSTRAP_TOKEN",
        success: (modalRes) => {
          if (!isPageNativeActionActive(this, action) || !modalRes || !modalRes.confirm) {
            return
          }

          const token = String(modalRes.content || "").trim()
          if (!token) {
            wx.showToast({
              title: "请输入初始化口令",
              icon: "none"
            })
            return
          }

          this.runMineTool({
            name: "bootstrapAdmin",
            data: {
              token
            },
            loadingTitle: "初始化中…",
            timeoutTitle: "初始化超时，请重试",
            failureFallback: "初始化失败",
            onResult: (result) => {
              const title = result && result.message ? result.message : "初始化完成"

              if (result && result.ok) {
                wx.showModal({
                  title: "管理员初始化结果",
                  content: `${title}\n\nOpenID：${(result && result.openid) || ""}`,
                  confirmText: "知道了",
                  confirmColor: "#528fff",
                  showCancel: false
                })
                return
              }

              if (result && result.code === "BOOTSTRAP_TOKEN_REQUIRED") {
                wx.showModal({
                  title: "初始化失败",
                  content: "初始化口令不正确，请检查后重试。",
                  confirmText: "知道了",
                  confirmColor: "#528fff",
                  showCancel: false
                })
                return
              }

              if (result && result.code === "BOOTSTRAP_DISABLED") {
                wx.showModal({
                  title: "初始化未启用",
                  content:
                    result.message ||
                    "请先在云函数控制台配置 32 至 256 位随机 BOOTSTRAP_TOKEN，再使用体验版或开发版初始化。",
                  confirmText: "知道了",
                  confirmColor: "#528fff",
                  showCancel: false
                })
                return
              }

              wx.showModal({
                title: "初始化失败",
                content: title,
                confirmText: "知道了",
                confirmColor: "#528fff",
                showCancel: false
              })
            }
          })
        }
      })
      return
    }

    if (key === "getOpenid") {
      if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
        wx.showToast({
          title: "云能力未初始化",
          icon: "none"
        })
        return
      }

      this.runMineTool({
        name: "getOpenid",
        loadingTitle: "查询中…",
        timeoutTitle: "查询超时，请重试",
        failureFallback: "查询失败",
        onResult: (result) => {
          const openid = result && result.ok ? result.openid : ""

          if (!openid) {
            wx.showToast({
              title: "账号获取失败",
              icon: "none"
            })
            return
          }

          const action = beginPageNativeAction(this, { requireCurrent: true })
          wx.setClipboardData({
            data: openid,
            success: () => {
              if (!isPageNativeActionActive(this, action)) {
                return
              }
              wx.showToast({
                title: "账号已复制",
                icon: "none"
              })
            },
            fail: () => {
              if (!isPageNativeActionActive(this, action)) {
                return
              }
              wx.showModal({
                title: "当前账号",
                content: `OpenID：${openid}`,
                confirmText: "知道了",
                confirmColor: "#528fff",
                showCancel: false
              })
            }
          })
        }
      })
      return
    }

    wx.showToast({
      title: formatToastTitle(`${title} 即将开放`, "功能即将开放"),
      icon: "none"
    })
  },

  handlePhoneCall() {
    const phone = String(this.data.servicePhone || "").trim()
    if (!phone) {
      wx.showToast({
        title: "客服电话暂不可用",
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
        wx.showModal({
          title: "拨号失败",
          content: `请联系客服：${phone}`,
          confirmText: "知道了",
          confirmColor: "#528fff",
          showCancel: false
        })
      }
    })
  },

  handleShowReleaseNotes() {
    showReleaseNotesModal()
  }
})
