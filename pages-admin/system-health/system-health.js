const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")

const STATUS_META = {
  pass: { label: "正常", className: "check-pass" },
  warning: { label: "待确认", className: "check-warning" },
  fail: { label: "需修复", className: "check-fail" }
}

const MANUAL_REVIEW_STORAGE_KEY = "system_health_manual_review_v1"
const SYSTEM_HEALTH_TIMEOUT_MS = 20 * 1000
const MANUAL_CHECK_DEFINITIONS = [
  { key: "indexes", label: "在云控制台按上线清单确认数据库索引已建立", iconClass: "manual-kind-icon-index" },
  {
    key: "quota",
    label: "在云开发控制台确认数据库与云存储实际用量、套餐配额和告警",
    iconClass: "manual-kind-icon-quota"
  },
  { key: "security", label: "确认数据库、云存储均禁止小程序端直接写入", iconClass: "manual-kind-icon-security" },
  { key: "permission", label: "使用非管理员账号验证后台页面无法访问", iconClass: "manual-kind-icon-permission" },
  { key: "devices", label: "分别用 Android 与 iPhone 完成一次预约主流程", iconClass: "manual-kind-icon-devices" },
  { key: "compliance", label: "核对备案、隐私保护指引、客服与审核素材", iconClass: "manual-kind-icon-compliance" }
]

function formatCheckedAt(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) {
    return "—"
  }
  const pad = (number) => String(number).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function formatDayKey(value) {
  const date = value instanceof Date ? value : new Date(value || Date.now())
  if (Number.isNaN(date.getTime())) {
    return ""
  }
  const pad = (number) => String(number).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function buildManualChecks(completedKeys) {
  const completed = new Set(Array.isArray(completedKeys) ? completedKeys : [])
  return MANUAL_CHECK_DEFINITIONS.map((item) => ({
    ...item,
    checked: completed.has(item.key)
  }))
}

function buildViewSummary(input, manualCompletedCount, manualTotal) {
  const total = Number(input && input.total) || 0
  const passed = Number(input && input.passed) || 0
  const warnings = Number(input && input.warnings) || 0
  const failed = Number(input && input.failed) || 0
  const completedManual = Number(manualCompletedCount) || 0
  const totalManual = Number(manualTotal) || 0
  const completionTotal = total + totalManual
  const completionPercent = completionTotal
    ? Math.round(((passed + completedManual) / completionTotal) * 100)
    : 0
  let level = "ready"
  let title = "上线检查已完成"
  let desc = "自动检查与人工确认均已完成"

  if (failed > 0) {
    level = "blocked"
    title = "存在技术阻塞"
    desc = `${failed} 项自动检查未通过，请修复后重新检查`
  } else if (warnings > 0) {
    level = "attention"
    title = "自动检查通过，仍有待确认项"
    desc = `${warnings} 项自动提醒待确认 · 人工确认 ${completedManual}/${totalManual}`
  } else if (completedManual < totalManual) {
    level = "attention"
    title = "自动检查通过，等待人工确认"
    desc = `人工确认 ${completedManual}/${totalManual}，完成后再安排正式发布`
  }

  return {
    total,
    passed,
    warnings,
    failed,
    technicalReady: failed === 0,
    ready: level === "ready",
    level,
    title,
    desc,
    completionPercent
  }
}

function normalizeChecks(checks) {
  return (Array.isArray(checks) ? checks : []).map((item) => {
    const meta = STATUS_META[item.status] || STATUS_META.fail
    const key = String(item.key || "")
    let groupLabel = "系统检查"
    let iconClass = "check-kind-icon-system"
    if (key.startsWith("collection_") || key.startsWith("volume_")) {
      groupLabel = key.startsWith("volume_") ? "容量检查" : "数据集合"
      iconClass = "check-kind-icon-database"
    } else if (key.includes("uniqueness")) {
      groupLabel = "数据质量"
      iconClass = "check-kind-icon-quality"
    } else if (key === "operation_settings" || key.includes("template")) {
      groupLabel = "运营配置"
      iconClass = "check-kind-icon-config"
    }
    return {
      key,
      label: item.label || "未命名检查项",
      message: item.message || "暂无检查说明",
      status: STATUS_META[item.status] ? item.status : "fail",
      statusLabel: meta.label,
      statusClass: meta.className,
      groupLabel,
      iconClass
    }
  })
}

Page({
  data: {
    pageAuthorized: false,
    loading: true,
    refreshing: false,
    loadError: "",
    checkedAtText: "—",
    summary: {
      total: 0,
      passed: 0,
      warnings: 0,
      failed: 0,
      technicalReady: false,
      ready: false,
      level: "attention",
      title: "等待检查",
      desc: "正在准备当前环境的上线检查",
      completionPercent: 0
    },
    checks: [],
    manualChecks: buildManualChecks(),
    manualCompletedCount: 0
  },

  onLoad() {
    this.restoreManualChecks()
    requirePagePermission(this, {
      required: "canManageRoles",
      noPermissionMessage: "无权执行上线检查",
      onAuthorized: () => {
        this.loadHealth()
      }
    })
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadHealth({
      refreshing: true,
      done: () => wx.stopPullDownRefresh()
    })
  },

  onUnload() {
    cancelPagePermissionCheck(this)
    this._healthRequestId = Number(this._healthRequestId || 0) + 1
    this.finishHealthRequestEffects()
  },

  handleRefresh() {
    if (!this.data.loading && !this.data.refreshing) {
      this.loadHealth({ refreshing: true })
    }
  },

  restoreManualChecks() {
    let completedKeys = []
    try {
      const stored =
        typeof wx.getStorageSync === "function"
          ? wx.getStorageSync(MANUAL_REVIEW_STORAGE_KEY)
          : null
      if (stored && stored.day === formatDayKey() && Array.isArray(stored.completedKeys)) {
        completedKeys = stored.completedKeys
      }
    } catch (error) {}

    const manualChecks = buildManualChecks(completedKeys)
    const manualCompletedCount = manualChecks.filter((item) => item.checked).length
    this.setData({
      manualChecks,
      manualCompletedCount,
      summary: buildViewSummary(
        this.data.summary,
        manualCompletedCount,
        manualChecks.length
      )
    })
  },

  handleManualToggle(event) {
    const key = String(event.currentTarget.dataset.key || "")
    if (!key) {
      return
    }
    const manualChecks = this.data.manualChecks.map((item) =>
      item.key === key ? { ...item, checked: !item.checked } : item
    )
    const completedKeys = manualChecks.filter((item) => item.checked).map((item) => item.key)
    const manualCompletedCount = completedKeys.length
    try {
      if (typeof wx.setStorageSync === "function") {
        wx.setStorageSync(MANUAL_REVIEW_STORAGE_KEY, {
          day: formatDayKey(),
          completedKeys
        })
      }
    } catch (error) {}
    this.setData({
      manualChecks,
      manualCompletedCount,
      summary: buildViewSummary(
        this.data.summary,
        manualCompletedCount,
        manualChecks.length
      )
    })
  },

  loadHealth(options) {
    const input = options && typeof options === "object" ? options : {}
    const requestId = Number(this._healthRequestId || 0) + 1
    this._healthRequestId = requestId
    this.finishHealthRequestEffects()
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        refreshing: false,
        loadError: "云能力未初始化"
      })
      if (typeof input.done === "function") {
        input.done()
      }
      return
    }

    this._healthRequestDone = typeof input.done === "function" ? input.done : null

    this.setData({
      loading: !input.refreshing,
      refreshing: Boolean(input.refreshing),
      loadError: ""
    })

    let settled = false
    const finishRequest = () => {
      if (settled || this._healthRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishHealthRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        loading: false,
        refreshing: false,
        loadError: message
      })
    }

    this._healthRequestTimer = setTimeout(() => {
      handleFailure("上线检查超时，请检查网络后重试")
    }, SYSTEM_HEALTH_TIMEOUT_MS)

    const requestOptions = {
      name: "systemHealthCheck",
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            loading: false,
            refreshing: false,
            loadError: (result && result.message) || "上线检查失败，请稍后重试"
          })
          return
        }

        const rawSummary = {
          total: Number(result.summary && result.summary.total) || 0,
          passed: Number(result.summary && result.summary.passed) || 0,
          warnings: Number(result.summary && result.summary.warnings) || 0,
          failed: Number(result.summary && result.summary.failed) || 0
        }
        this.setData({
          loading: false,
          refreshing: false,
          loadError: "",
          checkedAtText: formatCheckedAt(result.checkedAt),
          summary: buildViewSummary(
            rawSummary,
            this.data.manualCompletedCount,
            this.data.manualChecks.length
          ),
          checks: normalizeChecks(result.checks)
        })
      },
      fail: (error) => {
        handleFailure(
          (error && (error.errMsg || error.message)) || "上线检查失败，请稍后重试"
        )
      },
      complete: () => {}
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(
        (error && (error.errMsg || error.message)) || "上线检查失败，请稍后重试"
      )
    }
  },

  finishHealthRequestEffects() {
    if (this._healthRequestTimer) {
      clearTimeout(this._healthRequestTimer)
      this._healthRequestTimer = null
    }
    const done = this._healthRequestDone
    this._healthRequestDone = null
    if (typeof done === "function") {
      done()
    }
  }
})
