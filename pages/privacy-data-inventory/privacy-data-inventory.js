const { requirePagePermission } = require("../../shared/pageAuth")

const REQUEST_TYPE_LABELS = {
  access: "查询信息",
  correction: "更正信息",
  deletion: "删除信息"
}

const REQUEST_STATUS_LABELS = {
  pending: "待处理",
  processing: "处理中",
  completed: "已完成",
  rejected: "未通过",
  cancelled: "已撤回"
}

const BOOKING_STATUS_LABELS = {
  pending: "待联系",
  contacted: "已联系",
  completed: "已完成",
  cancelled: "已取消"
}

function formatDisplayTime(value) {
  if (!value) {
    return "--"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "--"
  }
  const pad = (number) => String(number).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function normalizeCategory(category, mapper) {
  const source = category && typeof category === "object" ? category : {}
  const list = Array.isArray(source.list) ? source.list.map(mapper) : []
  return {
    count: Number(source.count) || 0,
    truncated: Boolean(source.truncated),
    list
  }
}

function buildViewData(result) {
  const request = result && result.request ? result.request : {}
  const categories = result && result.categories ? result.categories : {}
  const unavailable = Array.isArray(result && result.unavailable) ? result.unavailable : []
  const truncated = Array.isArray(result && result.truncated) ? result.truncated : []
  const unavailableLabels = {
    bookings: "预约数据",
    favorites: "收藏数据",
    privacyRequests: "隐私申请"
  }
  return {
    partial: Boolean(result && result.partial),
    unavailable,
    truncated,
    unavailableText: unavailable
      .map((item) => unavailableLabels[item] || item)
      .join("、"),
    issueText: [
      unavailable.length
        ? `${unavailable.map((item) => unavailableLabels[item] || item).join("、")}暂不可用`
        : "",
      truncated.length
        ? `${truncated.map((item) => unavailableLabels[item] || item).join("、")}超过单类 200 条展示上限`
        : ""
    ]
      .filter(Boolean)
      .join("；"),
    request: {
      ...request,
      typeLabel: REQUEST_TYPE_LABELS[request.type] || "隐私申请",
      statusLabel: REQUEST_STATUS_LABELS[request.status] || "状态未知",
      createdAtText: formatDisplayTime(request.createdAt)
    },
    bookings: normalizeCategory(categories.bookings, (item) => ({
      ...item,
      statusLabel: BOOKING_STATUS_LABELS[item.status] || "状态未知",
      createdAtText: formatDisplayTime(item.createdAt),
      dateText:
        item.startDate && item.endDate
          ? `${item.startDate} 至 ${item.endDate}`
          : item.startDate || item.endDate || "--"
    })),
    favorites: normalizeCategory(categories.favorites, (item) => ({
      ...item,
      createdAtText: formatDisplayTime(item.createdAt)
    })),
    privacyRequests: normalizeCategory(categories.privacyRequests, (item) => ({
      ...item,
      typeLabel: REQUEST_TYPE_LABELS[item.type] || "隐私申请",
      statusLabel: REQUEST_STATUS_LABELS[item.status] || "状态未知",
      createdAtText: formatDisplayTime(item.createdAt)
    }))
  }
}

Page({
  data: {
    pageAuthorized: false,
    requestId: "",
    loading: true,
    refreshing: false,
    loadError: "",
    partial: false,
    unavailable: [],
    truncated: [],
    unavailableText: "",
    issueText: "",
    request: {},
    bookings: { count: 0, truncated: false, list: [] },
    favorites: { count: 0, truncated: false, list: [] },
    privacyRequests: { count: 0, truncated: false, list: [] }
  },

  onLoad(options) {
    const requestId = String((options && options.id) || "").trim()
    this.setData({ requestId })
    requirePagePermission(this, {
      required: "canManageRoles",
      noPermissionMessage: "无权核验隐私申请数据",
      onAuthorized: () => {
        if (!requestId) {
          this.setData({
            loading: false,
            loadError: "缺少隐私申请 ID"
          })
          return
        }
        this.loadInventory()
      }
    })
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized || !this.data.requestId) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadInventory({
      refreshing: true,
      done: () => wx.stopPullDownRefresh()
    })
  },

  handleRefresh() {
    if (!this.data.loading && !this.data.refreshing && this.data.requestId) {
      this.loadInventory({ refreshing: true })
    }
  },

  handleCopyOpenid() {
    const openid = String(this.data.request.openid || "")
    if (openid) {
      wx.setClipboardData({ data: openid })
    }
  },

  handleBookingTap(event) {
    const id = String(event.currentTarget.dataset.id || "")
    if (!id) {
      return
    }
    wx.navigateTo({
      url: `/pages/booking-manage-detail/booking-manage-detail?id=${encodeURIComponent(id)}`,
      fail: () => {
        wx.showToast({
          title: "预约详情打开失败",
          icon: "none"
        })
      }
    })
  },

  loadInventory(options) {
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
      name: "privacyRequestDataInventory",
      data: {
        requestId: this.data.requestId
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            loading: false,
            refreshing: false,
            loadError: (result && result.message) || "相关数据核验失败，请稍后重试"
          })
          return
        }
        this.setData({
          loading: false,
          refreshing: false,
          loadError: "",
          ...buildViewData(result)
        })
      },
      fail: (error) => {
        this.setData({
          loading: false,
          refreshing: false,
          loadError:
            (error && (error.errMsg || error.message)) || "相关数据核验失败，请稍后重试"
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
