const { requirePagePermission } = require("../../shared/pageAuth")

const STATUS_META = {
  pass: { label: "正常", className: "check-pass" },
  warning: { label: "待确认", className: "check-warning" },
  fail: { label: "需修复", className: "check-fail" }
}

function formatCheckedAt(value) {
  const date = new Date(value)
  if (!value || Number.isNaN(date.getTime())) {
    return "--"
  }
  const pad = (number) => String(number).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function normalizeChecks(checks) {
  return (Array.isArray(checks) ? checks : []).map((item) => {
    const meta = STATUS_META[item.status] || STATUS_META.fail
    return {
      key: item.key || "",
      label: item.label || "未命名检查项",
      message: item.message || "暂无检查说明",
      status: STATUS_META[item.status] ? item.status : "fail",
      statusLabel: meta.label,
      statusClass: meta.className
    }
  })
}

Page({
  data: {
    pageAuthorized: false,
    loading: true,
    refreshing: false,
    loadError: "",
    checkedAtText: "--",
    summary: {
      total: 0,
      passed: 0,
      warnings: 0,
      failed: 0,
      ready: false
    },
    checks: [],
    manualChecks: [
      "在云控制台按上线清单确认数据库索引已建立",
      "在云开发控制台确认数据库与云存储实际用量、套餐配额和告警",
      "确认数据库、云存储均禁止小程序端直接写入",
      "使用非管理员账号验证后台页面无法访问",
      "分别用 Android 与 iPhone 完成一次预约主流程",
      "核对备案、隐私保护指引、客服与审核素材"
    ]
  },

  onLoad() {
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

  handleRefresh() {
    if (!this.data.loading && !this.data.refreshing) {
      this.loadHealth({ refreshing: true })
    }
  },

  loadHealth(options) {
    const input = options && typeof options === "object" ? options : {}
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

    this.setData({
      loading: !input.refreshing,
      refreshing: Boolean(input.refreshing),
      loadError: ""
    })

    wx.cloud.callFunction({
      name: "systemHealthCheck",
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            loading: false,
            refreshing: false,
            loadError: (result && result.message) || "上线检查失败，请稍后重试"
          })
          return
        }

        this.setData({
          loading: false,
          refreshing: false,
          loadError: "",
          checkedAtText: formatCheckedAt(result.checkedAt),
          summary: {
            total: Number(result.summary && result.summary.total) || 0,
            passed: Number(result.summary && result.summary.passed) || 0,
            warnings: Number(result.summary && result.summary.warnings) || 0,
            failed: Number(result.summary && result.summary.failed) || 0,
            ready: Boolean(result.summary && result.summary.ready)
          },
          checks: normalizeChecks(result.checks)
        })
      },
      fail: (error) => {
        this.setData({
          loading: false,
          refreshing: false,
          loadError:
            (error && (error.errMsg || error.message)) || "上线检查失败，请稍后重试"
        })
      },
      complete: () => {
        if (typeof input.done === "function") {
          input.done()
        }
      }
    })
  }
})
