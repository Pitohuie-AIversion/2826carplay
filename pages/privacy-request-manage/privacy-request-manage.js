const { requirePagePermission } = require("../../shared/pageAuth")

const TYPE_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "access", label: "查询" },
  { value: "correction", label: "更正" },
  { value: "deletion", label: "删除" }
]

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "pending", label: "待处理" },
  { value: "processing", label: "处理中" },
  { value: "completed", label: "已完成" },
  { value: "rejected", label: "未通过" },
  { value: "cancelled", label: "已撤回" }
]

const TYPE_LABELS = {
  access: "查询信息",
  correction: "更正信息",
  deletion: "删除信息"
}

const STATUS_META = {
  pending: { label: "待处理", className: "status-pending" },
  processing: { label: "处理中", className: "status-processing" },
  completed: { label: "已完成", className: "status-completed" },
  rejected: { label: "未通过", className: "status-rejected" },
  cancelled: { label: "已撤回", className: "status-cancelled" }
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

Page({
  data: {
    pageAuthorized: false,
    typeOptions: TYPE_OPTIONS,
    statusOptions: STATUS_OPTIONS,
    currentType: "all",
    currentStatus: "pending",
    keyword: "",
    initialLoading: true,
    loading: false,
    updatingId: "",
    list: [],
    page: 0,
    pageSize: 20,
    hasMore: false,
    total: 0,
    truncated: false
  },

  onLoad() {
    requirePagePermission(this, {
      required: "canManageRoles",
      noPermissionMessage: "无权处理隐私申请",
      onAuthorized: () => this.fetchList()
    })
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchList({
      done: () => wx.stopPullDownRefresh()
    })
  },

  handleTypeTap(event) {
    const value = String(event.currentTarget.dataset.value || "")
    if (!TYPE_OPTIONS.some((item) => item.value === value) || value === this.data.currentType) {
      return
    }
    this.setData({ currentType: value })
    this.fetchList()
  },

  handleStatusTap(event) {
    const value = String(event.currentTarget.dataset.value || "")
    if (!STATUS_OPTIONS.some((item) => item.value === value) || value === this.data.currentStatus) {
      return
    }
    this.setData({ currentStatus: value })
    this.fetchList()
  },

  handleKeywordInput(event) {
    this.setData({
      keyword: String((event.detail && event.detail.value) || "")
    })
  },

  handleSearch() {
    this.fetchList()
  },

  handleLoadMore() {
    if (!this.data.loading && this.data.hasMore) {
      this.fetchList({ append: true })
    }
  },

  handleCopyOpenid(event) {
    const openid = String(event.currentTarget.dataset.openid || "")
    if (!openid) {
      return
    }
    wx.setClipboardData({
      data: openid
    })
  },

  handleInventoryTap(event) {
    const id = String(event.currentTarget.dataset.id || "")
    if (!id) {
      return
    }
    wx.navigateTo({
      url: `/pages/privacy-data-inventory/privacy-data-inventory?id=${encodeURIComponent(id)}`,
      fail: () => {
        wx.showToast({
          title: "数据清单打开失败",
          icon: "none"
        })
      }
    })
  },

  handleRequestAction(event) {
    const id = String(event.currentTarget.dataset.id || "")
    const item = this.data.list.find((record) => record.id === id)
    if (!item || !item.canHandle || this.data.updatingId) {
      return
    }

    const actions =
      item.status === "pending"
        ? [
            { label: "标记为处理中", status: "processing" },
            { label: "完成申请", status: "completed" },
            { label: "驳回申请", status: "rejected" }
          ]
        : [
            { label: "完成申请", status: "completed" },
            { label: "驳回申请", status: "rejected" }
          ]

    wx.showActionSheet({
      itemList: actions.map((action) => action.label),
      success: (res) => {
        const action = actions[res.tapIndex]
        if (!action) {
          return
        }
        if (action.status === "processing") {
          this.updateStatus(item, action.status, "")
          return
        }
        this.promptResolution(item, action)
      }
    })
  },

  promptResolution(item, action) {
    wx.showModal({
      title: action.status === "completed" ? "填写处理结果" : "填写未通过原因",
      content: "该说明会展示给申请用户，请清晰说明处理结果或后续方式。",
      editable: true,
      placeholderText: action.status === "completed" ? "例如：已完成核验并通过客服反馈" : "例如：依法需保留相关交易记录",
      success: (res) => {
        if (!res.confirm) {
          return
        }
        const note = String(res.content || "").trim()
        if (note.length < 2) {
          wx.showToast({
            title: "请填写至少 2 字说明",
            icon: "none"
          })
          return
        }
        this.updateStatus(item, action.status, note)
      }
    })
  },

  updateStatus(item, status, resolutionNote) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({ updatingId: item.id })
    wx.cloud.callFunction({
      name: "privacyRequestUpdateStatus",
      data: {
        id: item.id,
        status,
        resolutionNote
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "更新失败",
            icon: "none"
          })
          return
        }
        wx.showToast({
          title: "状态已更新",
          icon: "success"
        })
        this.fetchList()
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "更新失败",
          icon: "none"
        })
      },
      complete: () => {
        this.setData({ updatingId: "" })
      }
    })
  },

  fetchList(options) {
    const input = options && typeof options === "object" ? options : {}
    const append = Boolean(input.append)
    const nextPage = append ? this.data.page + 1 : 0
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        initialLoading: false,
        loading: false,
        list: []
      })
      if (typeof input.done === "function") {
        input.done()
      }
      return
    }

    this.setData({ loading: true })
    wx.cloud.callFunction({
      name: "privacyRequestList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize,
        type: this.data.currentType === "all" ? "" : this.data.currentType,
        status: this.data.currentStatus === "all" ? "" : this.data.currentStatus,
        keyword: this.data.keyword
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "加载失败",
            icon: "none"
          })
          this.setData({
            initialLoading: false,
            loading: false,
            list: append ? this.data.list : [],
            total: 0,
            hasMore: false
          })
          return
        }

        const list = Array.isArray(result.list)
          ? result.list.map((item) => {
              const statusMeta = STATUS_META[item.status] || STATUS_META.pending
              return {
                ...item,
                typeLabel: TYPE_LABELS[item.type] || "隐私申请",
                statusLabel: statusMeta.label,
                statusClass: statusMeta.className,
                createdAtText: formatDisplayTime(item.createdAt),
                canHandle: ["pending", "processing"].includes(item.status)
              }
            })
          : []
        this.setData({
          initialLoading: false,
          loading: false,
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          total: Number(result.total) || 0,
          truncated: Boolean(result.truncated),
          list: append ? this.data.list.concat(list) : list
        })
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "加载失败",
          icon: "none"
        })
        this.setData({
          initialLoading: false,
          loading: false
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
