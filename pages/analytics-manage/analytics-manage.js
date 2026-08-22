const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

const ANALYTICS_OVERVIEW_TIMEOUT_MS = 15 * 1000
const ANALYTICS_CLEANUP_TIMEOUT_MS = 20 * 1000

function buildMetrics(metrics, conversionRate) {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  return [
    { key: "detail", label: "详情浏览", value: Number(source.vehicle_detail) || 0, tone: "primary", icon: "eye" },
    { key: "pricing", label: "查看费用", value: (Number(source.pricing_view) || 0) + (Number(source.price_change_view) || 0), tone: "warning", icon: "calendar" },
    { key: "submit", label: "提交成功", value: Number(source.booking_submit) || 0, tone: "success", icon: "check" },
    { key: "conversion", label: "详情转化率", value: `${Number(conversionRate) || 0}%`, tone: "accent", icon: "chart" }
  ]
}

function buildFunnel(metrics) {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  const list = [
    { key: "garage", label: "进入车库", value: Number(source.garage_view) || 0 },
    { key: "detail", label: "查看详情", value: Number(source.vehicle_detail) || 0 },
    { key: "pricing", label: "查看费用", value: Number(source.pricing_view) || 0 },
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

function buildDecisionItems(metrics) {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  return [
    { key: "rules", label: "查看租赁规则", value: Number(source.rental_rules_view) || 0 },
    { key: "phone", label: "电话咨询", value: Number(source.phone_call) || 0 },
    { key: "share", label: "主动分享", value: Number(source.share) || 0 },
    {
      key: "availability",
      label: "档期检查",
      value:
        (Number(source.availability_available) || 0) +
        (Number(source.availability_conflict) || 0) +
        (Number(source.availability_shortage) || 0) +
        (Number(source.availability_unknown) || 0),
      meta: `可预约 ${Number(source.availability_available) || 0} · 档期不足 ${(Number(source.availability_shortage) || 0) + (Number(source.availability_conflict) || 0)} · 特殊价查看 ${Number(source.price_change_view) || 0}`
    }
  ]
}

function buildQuoteMetrics(metrics) {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  return [
    { key: "sent", label: "报价发送率", value: `${Number(source.quoteSentRate) || 0}%`, meta: `${Number(source.quotedBookings) || 0} / ${Number(source.submittedBookings) || 0} 个预约` },
    { key: "confirmed", label: "报价确认率", value: `${Number(source.quoteConfirmationRate) || 0}%`, meta: `${Number(source.confirmedQuoteVersions) || 0} / ${Number(source.sentQuoteVersions) || 0} 个版本` },
    { key: "duration", label: "平均确认耗时", value: `${Number(source.averageConfirmationHours) || 0} 小时`, meta: "从报价发送到用户确认" },
    { key: "adjustment", label: "调整申请", value: Number(source.adjustmentRequests) || 0, meta: "用户主动申请调整次数" }
  ]
}

function buildTrustProfileMetrics(metrics) {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  return [
    { key: "views", label: "档案展开查看", value: Number(source.profileViews) || 0, meta: "用户主动展开可信档案" },
    { key: "phone", label: "电话咨询比", value: `${Number(source.phoneConsultationRate) || 0}%`, meta: `${Number(source.phoneConsultations) || 0} 次电话 / ${Number(source.profileViews) || 0} 次档案查看` },
    { key: "booking", label: "预约发起比", value: `${Number(source.bookingStartRate) || 0}%`, meta: `${Number(source.bookingStarts) || 0} 次预约 / ${Number(source.profileViews) || 0} 次档案查看` }
  ]
}

function buildContentMetrics(metrics) {
  const source = metrics && typeof metrics === "object" ? metrics : {}
  return [
    { key: "views", label: "内容浏览量", value: Number(source.views) || 0, meta: "已发布场景内容详情浏览" },
    { key: "shares", label: "分享落地量", value: Number(source.shareOpens) || 0, meta: "携带合法来源参数的打开" },
    { key: "submit", label: "内容到预约转化率", value: `${Number(source.bookingConversionRate) || 0}%`, meta: `${Number(source.bookingSubmits) || 0} 次预约提交` },
    { key: "confirmed", label: "内容到确认预约转化率", value: `${Number(source.confirmedConversionRate) || 0}%`, meta: `${Number(source.confirmedBookings) || 0} 次报价确认` }
  ]
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
    decisionItems: [],
    quoteMetricItems: [],
    trustProfileMetricItems: [],
    contentMetricItems: [],
    topContents: [],
    topContentVehicles: [],
    topContentSources: [],
    trendItems: [],
    topVehicles: [],
    truncated: false,
    canCleanup: false,
    cleanupLoading: false
  },

  onLoad() {
    activatePageNativeActions(this)
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
    if (!this.data.pageAuthorized || this.data.cleanupLoading) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchOverview(() => wx.stopPullDownRefresh())
  },

  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    this._overviewRequestId = Number(this._overviewRequestId || 0) + 1
    this._cleanupRequestId = Number(this._cleanupRequestId || 0) + 1
    this.finishOverviewRequestEffects()
    this.finishCleanupRequestEffects()
  },

  handlePeriodTap(event) {
    const days = Number(event.currentTarget.dataset.days)
    if (
      ![7, 30].includes(days) ||
      days === this.data.days ||
      this.data.loading ||
      this.data.cleanupLoading
    ) {
      return
    }
    this.setData({ days })
    this.fetchOverview()
  },

  handleRetry() {
    if (this.data.loading || this.data.cleanupLoading) {
      return
    }
    this.fetchOverview()
  },

  handleCleanup() {
    if (this.data.loading || this.data.cleanupLoading || !this.data.canCleanup) {
      return
    }

    const action = beginPageNativeAction(this, {
      exclusiveKey: "analytics-cleanup-confirmation"
    })
    wx.showModal({
      title: "清理过期匿名数据",
      content: "将永久删除 90 天前的匿名行为事件，每次最多 100 条。该操作不会删除预约、车辆或用户资料。确认继续？",
      confirmText: "确认清理",
      confirmColor: "#d46868",
      success: (res) => {
        if (isPageNativeActionActive(this, action) && res && res.confirm) {
          this.runCleanup()
        }
      }
    })
  },

  runCleanup() {
    if (
      this.data.loading ||
      this.data.cleanupLoading ||
      !this.data.canCleanup ||
      !wx.cloud ||
      typeof wx.cloud.callFunction !== "function"
    ) {
      return
    }

    const requestId = Number(this._cleanupRequestId || 0) + 1
    this._cleanupRequestId = requestId
    this.finishCleanupRequestEffects()
    this.setData({ cleanupLoading: true })
    wx.showLoading({ title: "清理中…", mask: true })
    this._cleanupLoadingVisible = true

    let settled = false
    const isCurrent = () => this._cleanupRequestId === requestId
    const finishRequest = () => {
      if (settled || !isCurrent()) {
        return false
      }
      settled = true
      this.finishCleanupRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      wx.showToast({
        title: formatToastTitle(message, "清理失败"),
        icon: "none"
      })
      this.setData({ cleanupLoading: false })
    }

    this._cleanupRequestTimer = setTimeout(() => {
      handleFailure("清理超时，请重试")
    }, ANALYTICS_CLEANUP_TIMEOUT_MS)

    const requestOptions = {
      name: "analyticsCleanup",
      data: {
        limit: 100
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ cleanupLoading: false })
          wx.showToast({
          title: formatToastTitle(result && result.message, "清理失败"),
            icon: "none"
          })
          return
        }

        let cleanupResultSettled = false
        const finishCleanupResult = () => {
          if (cleanupResultSettled || !isCurrent()) {
            return
          }
          cleanupResultSettled = true
          this.setData({ cleanupLoading: false })
          this.fetchOverview()
        }
        if (typeof wx.showModal !== "function") {
          finishCleanupResult()
          return
        }
        try {
          wx.showModal({
            title: "清理完成",
            content: `处理 ${result.processed || 0} 条，成功删除 ${result.deleted || 0} 条，失败 ${result.failed || 0} 条。${result.hasMore ? "可能仍有过期数据，可再次执行清理。" : "已处理完当前过期数据。"}`,
            confirmText: "知道了",
            confirmColor: "#528fff",
            showCancel: false,
            complete: finishCleanupResult
          })
        } catch (error) {
          finishCleanupResult()
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

  fetchOverview(done) {
    const requestId = Number(this._overviewRequestId || 0) + 1
    this._overviewRequestId = requestId
    this.finishOverviewRequestEffects()
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

    this._overviewRequestDone = typeof done === "function" ? done : null
    const days = this.data.days
    this.setData({
      loading: true,
      loadError: ""
    })

    let settled = false
    const finishRequest = () => {
      if (settled || this._overviewRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishOverviewRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        loading: false,
        loadError: String(message || "数据分析加载失败")
      })
    }

    this._overviewRequestTimer = setTimeout(() => {
      handleFailure("数据分析加载超时，请检查网络后重试")
    }, ANALYTICS_OVERVIEW_TIMEOUT_MS)

    const requestOptions = {
      name: "analyticsOverview",
      data: {
        days
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
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
          decisionItems: buildDecisionItems(result.metrics),
          quoteMetricItems: buildQuoteMetrics(result.quoteMetrics),
          trustProfileMetricItems: buildTrustProfileMetrics(result.trustProfileMetrics),
          contentMetricItems: buildContentMetrics(result.contentAnalytics),
          topContents: result.contentAnalytics && Array.isArray(result.contentAnalytics.topContents) ? result.contentAnalytics.topContents : [],
          topContentVehicles: result.contentAnalytics && Array.isArray(result.contentAnalytics.topVehicles) ? result.contentAnalytics.topVehicles : [],
          topContentSources: result.contentAnalytics && Array.isArray(result.contentAnalytics.topSources) ? result.contentAnalytics.topSources : [],
          trendItems: buildTrend(result.trend),
          topVehicles: Array.isArray(result.topVehicles) ? result.topVehicles : [],
          truncated: Boolean(result.truncated || result.quoteDataTruncated)
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

  finishOverviewRequestEffects() {
    if (this._overviewRequestTimer) {
      clearTimeout(this._overviewRequestTimer)
      this._overviewRequestTimer = null
    }
    const done = this._overviewRequestDone
    this._overviewRequestDone = null
    if (typeof done === "function") {
      done()
    }
  },

  finishCleanupRequestEffects() {
    if (this._cleanupRequestTimer) {
      clearTimeout(this._cleanupRequestTimer)
      this._cleanupRequestTimer = null
    }
    if (this._cleanupLoadingVisible) {
      this._cleanupLoadingVisible = false
      wx.hideLoading()
    }
  }
})
