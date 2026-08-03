const { requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")

function buildMetrics(metrics, conversionRate) {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  return [
    { key: "detail", label: "详情浏览", value: Number(source.vehicle_detail) || 0, tone: "primary", icon: "eye" },
    { key: "start", label: "发起预约", value: Number(source.booking_start) || 0, tone: "warning", icon: "calendar" },
    { key: "submit", label: "提交成功", value: Number(source.booking_submit) || 0, tone: "success", icon: "check" },
    { key: "conversion", label: "详情转化率", value: `${Number(conversionRate) || 0}%`, tone: "accent", icon: "chart" }
  ]
}

function buildFunnel(metrics) {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  const list = [
    { key: "garage", label: "进入车库", value: Number(source.garage_view) || 0 },
    { key: "detail", label: "查看详情", value: Number(source.vehicle_detail) || 0 },
    { key: "start", label: "发起预约", value: Number(source.booking_start) || 0 },
    { key: "submit", label: "提交成功", value: Number(source.booking_submit) || 0 }
  ]
  const max = Math.max(...list.map((item) => item.value), 1)
  const firstStageValue = list[0].value
  return list.map((item) => ({
    ...item,
    width: Math.max(Math.round((item.value / max) * 100), item.value ? 8 : 0),
    rate: firstStageValue ? Math.min(100, Math.round((item.value / firstStageValue) * 100)) : 0
  }))
}

function buildTrend(trend) {
  const list = Array.isArray(trend) ? trend : []
  const max = Math.max(...list.map((item) => Number(item.value) || 0), 1)
  return list.map((item) => {
    const value = Number(item.value) || 0
    return {
      ...item,
      width: Math.max(Math.round((value / max) * 100), value ? 6 : 0),
      isPeak: value > 0 && value === max
    }
  })
}

Page({
  data: {
    pageAuthorized: false,
    loading: true,
    loadError: "",
    days: 7,
    periodOptions: [
      { value: 7, label: "近 7 天" },
      { value: 30, label: "近 30 天" }
    ],
    metricItems: [],
    funnelItems: [],
    trendItems: [],
    topVehicles: [],
    truncated: false,
    canCleanup: false,
    cleanupLoading: false
  },

  onLoad() {
    requirePagePermission(this, {
      required: (result) =>
        Boolean(result.canManageVehicles || result.canManageBookings || result.canManageRoles),
      noPermissionMessage: "无权查看数据分析",
      onAuthorized: (result) => {
        this.setData({
          canCleanup: Boolean(result && result.canManageRoles)
        })
        this.fetchOverview()
      }
    })
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchOverview(() => wx.stopPullDownRefresh())
  },

  handlePeriodTap(event) {
    const days = Number(event.currentTarget.dataset.days)
    if (![7, 30].includes(days) || days === this.data.days || this.data.loading) {
      return
    }
    this.setData({ days })
    this.fetchOverview()
  },

  handleRetry() {
    this.fetchOverview()
  },

  handleCleanup() {
    if (this.data.cleanupLoading || !this.data.canCleanup) {
      return
    }

    wx.showModal({
      title: "清理过期匿名数据",
      content: "将永久删除 90 天前的匿名行为事件，每次最多 100 条。该操作不会删除预约、车辆或用户资料。确认继续？",
      confirmText: "确认清理",
      confirmColor: "#d46868",
      success: (res) => {
        if (res.confirm) {
          this.runCleanup()
        }
      }
    })
  },

  runCleanup() {
    if (
      this.data.cleanupLoading ||
      !this.data.canCleanup ||
      !wx.cloud ||
      typeof wx.cloud.callFunction !== "function"
    ) {
      return
    }

    this.setData({ cleanupLoading: true })
    wx.showLoading({ title: "清理中…", mask: true })
    wx.cloud.callFunction({
      name: "analyticsCleanup",
      data: {
        limit: 100
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "清理失败"),
            icon: "none"
          })
          return
        }

        wx.showModal({
          title: "清理完成",
          content: `处理 ${result.processed || 0} 条，成功删除 ${result.deleted || 0} 条，失败 ${result.failed || 0} 条。${result.hasMore ? "可能仍有过期数据，可再次执行清理。" : "已处理完当前过期数据。"}`,
          confirmText: "知道了",
          confirmColor: "#528fff",
          showCancel: false
        })
      },
      fail: (error) => {
        wx.showToast({
          title: "清理失败",
          icon: "none"
        })
      },
      complete: () => {
        wx.hideLoading()
        this.setData({ cleanupLoading: false })
      }
    })
  },

  fetchOverview(done) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        loadError: "云能力未初始化"
      })
      if (typeof done === "function") {
        done()
      }
      return
    }

    this.setData({
      loading: true,
      loadError: ""
    })
    wx.cloud.callFunction({
      name: "analyticsOverview",
      data: {
        days: this.data.days
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            loading: false,
            loadError: (result && result.message) || "数据分析加载失败"
          })
          return
        }
        this.setData({
          loading: false,
          loadError: "",
          metricItems: buildMetrics(result.metrics, result.conversionRate),
          funnelItems: buildFunnel(result.metrics),
          trendItems: buildTrend(result.trend),
          topVehicles: Array.isArray(result.topVehicles) ? result.topVehicles : [],
          truncated: Boolean(result.truncated)
        })
      },
      fail: (error) => {
        this.setData({
          loading: false,
          loadError: (error && (error.errMsg || error.message)) || "数据分析加载失败"
        })
      },
      complete: () => {
        if (typeof done === "function") {
          done()
        }
      }
    })
  }
})
