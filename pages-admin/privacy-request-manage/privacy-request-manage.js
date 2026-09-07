const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

const PRIVACY_MANAGE_LIST_TIMEOUT_MS = 15 * 1000
const PRIVACY_MANAGE_WRITE_TIMEOUT_MS = 20 * 1000

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

const TYPE_META = {
  access: {
    label: "查询信息",
    className: "request-type-access",
    iconClass: "request-type-icon-access"
  },
  correction: {
    label: "更正信息",
    className: "request-type-correction",
    iconClass: "request-type-icon-correction"
  },
  deletion: {
    label: "删除信息",
    className: "request-type-deletion",
    iconClass: "request-type-icon-deletion"
  }
}

const STATUS_META = {
  pending: { label: "待处理", className: "status-pending" },
  processing: { label: "处理中", className: "status-processing" },
  completed: { label: "已完成", className: "status-completed" },
  rejected: { label: "未通过", className: "status-rejected" },
  cancelled: { label: "已撤回", className: "status-cancelled" }
}

function getOptionLabel(options, value, fallback) {
  const option = options.find((item) => item.value === value)
  return option ? option.label : fallback
}

function buildRequestJourney(item) {
  const status = String(item.status || "pending")
  if (status === "processing") {
    return {
      journeyStage: 2,
      journeyProgress: 67,
      journeyClass: "request-journey-processing",
      journeyHint: item.type === "access" && !item.dataExportedAt
        ? "下一步：核验并导出个人数据"
        : "下一步：填写处理反馈并结束申请"
    }
  }
  if (status === "completed") {
    return {
      journeyStage: 3,
      journeyProgress: 100,
      journeyClass: "request-journey-completed",
      journeyHint: "本次隐私申请已完成"
    }
  }
  if (status === "rejected") {
    return {
      journeyStage: 3,
      journeyProgress: 100,
      journeyClass: "request-journey-rejected",
      journeyHint: "本次申请未通过，处理反馈已留存"
    }
  }
  if (status === "cancelled") {
    return {
      journeyStage: 1,
      journeyProgress: 33,
      journeyClass: "request-journey-cancelled",
      journeyHint: "用户已撤回，无需继续处理"
    }
  }
  return {
    journeyStage: 1,
    journeyProgress: 33,
    journeyClass: "request-journey-pending",
    journeyHint: "下一步：确认申请并开始处理"
  }
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
    currentTypeLabel: "全部类型",
    currentStatusLabel: "待处理",
    keyword: "",
    initialLoading: true,
    loading: false,
    updatingId: "",
    hasLoaded: false,
    list: [],
    page: 0,
    pageSize: 20,
    hasMore: false,
    total: 0,
    truncated: false
  },

  onLoad() {
    activatePageNativeActions(this)
    requirePagePermission(this, {
      required: "canManageRoles",
      noPermissionMessage: "无权处理隐私申请",
      onAuthorized: () => this.fetchList()
    })
  },

  onShow() {
    if (
      this.data.pageAuthorized &&
      this.data.hasLoaded &&
      !this.data.loading &&
      !this.data.updatingId
    ) {
      this.fetchList()
    }
  },

  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    this._privacyManageListRequestId =
      Number(this._privacyManageListRequestId || 0) + 1
    this._privacyManageWriteRequestId =
      Number(this._privacyManageWriteRequestId || 0) + 1
    this.finishPrivacyManageListEffects()
    this.clearPrivacyManageWriteTimer()
    this._privacyManageWriteActive = false
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized || this.data.updatingId) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchList({
      done: () => wx.stopPullDownRefresh()
    })
  },

  handleTypeTap(event) {
    const value = String(event.currentTarget.dataset.value || "")
    if (
      this.data.updatingId ||
      !TYPE_OPTIONS.some((item) => item.value === value) ||
      value === this.data.currentType
    ) {
      return
    }
    this.setData({
      currentType: value,
      currentTypeLabel: getOptionLabel(TYPE_OPTIONS, value, "全部类型")
    })
    this.fetchList()
  },

  handleStatusTap(event) {
    const value = String(event.currentTarget.dataset.value || "")
    if (
      this.data.updatingId ||
      !STATUS_OPTIONS.some((item) => item.value === value) ||
      value === this.data.currentStatus
    ) {
      return
    }
    this.setData({
      currentStatus: value,
      currentStatusLabel: getOptionLabel(STATUS_OPTIONS, value, "全部状态")
    })
    this.fetchList()
  },

  handleKeywordInput(event) {
    this.setData({
      keyword: String((event.detail && event.detail.value) || "")
    })
  },

  handleClearKeyword() {
    if (!this.data.keyword || this.data.updatingId) {
      return
    }
    const listRequestId = Number(this._privacyManageListRequestId || 0)
    this.setData({ keyword: "" }, () => {
      if (listRequestId !== Number(this._privacyManageListRequestId || 0)) {
        return
      }
      this.fetchList()
    })
  },

  handleSearch() {
    if (this.data.updatingId) {
      return
    }
    this.fetchList()
  },

  handleResetFilters() {
    if (
      this.data.updatingId ||
      (!this.data.keyword &&
        this.data.currentType === "all" &&
        this.data.currentStatus === "pending")
    ) {
      return
    }
    const listRequestId = Number(this._privacyManageListRequestId || 0)
    this.setData({
      keyword: "",
      currentType: "all",
      currentStatus: "pending",
      currentTypeLabel: "全部类型",
      currentStatusLabel: "待处理"
    }, () => {
      if (listRequestId !== Number(this._privacyManageListRequestId || 0)) {
        return
      }
      this.fetchList()
    })
  },

  handleLoadMore() {
    if (!this.data.loading && !this.data.updatingId && this.data.hasMore) {
      this.fetchList({ append: true })
    }
  },

  handleCopyOpenid(event) {
    if (this.data.loading || this.data.updatingId) {
      return
    }
    const openid = String(event.currentTarget.dataset.openid || "")
    if (!openid) {
      wx.showToast({
        title: "申请账号不可用",
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
          title: "申请账号已复制",
          icon: "none"
        })
      },
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "申请账号复制失败",
          icon: "none"
        })
      }
    })
  },

  handleInventoryTap(event) {
    const id = String(event.currentTarget.dataset.id || "")
    if (this.data.loading || this.data.updatingId || !id) {
      return
    }
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages-admin/privacy-data-inventory/privacy-data-inventory?id=${encodeURIComponent(id)}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
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
    if (!item || !item.canHandle || this.data.loading || this.data.updatingId) {
      return
    }

    const canComplete = item.type !== "access" || Boolean(item.dataExportedAt)
    const actions = []
    if (item.status === "pending") {
      actions.push({ label: "标记为处理中", status: "processing" })
    }
    if (canComplete) {
      actions.push({ label: "完成申请", status: "completed" })
    }
    actions.push({ label: "驳回申请", status: "rejected" })

    const nativeAction = beginPageNativeAction(this, {
      exclusiveKey: "privacy-status-confirmation"
    })
    wx.showActionSheet({
      alertText: "选择申请处理结果",
      itemList: actions.map((action) => action.label),
      itemColor: "#528fff",
      success: (res) => {
        if (!isPageNativeActionActive(this, nativeAction) || !res) {
          return
        }
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
    const nativeAction = beginPageNativeAction(this, {
      exclusiveKey: "privacy-status-confirmation"
    })
    wx.showModal({
      title: action.status === "completed" ? "填写处理结果" : "填写未通过原因",
      content: "该说明会展示给申请用户，请清晰说明处理结果或后续方式。",
      confirmText: action.status === "completed" ? "提交结果" : "确认驳回",
      confirmColor: action.status === "completed" ? "#528fff" : "#d46868",
      editable: true,
      placeholderText: action.status === "completed" ? "例如：已完成核验并通过客服反馈" : "例如：依法需保留相关交易记录",
      success: (res) => {
        if (!isPageNativeActionActive(this, nativeAction) || !res || !res.confirm) {
          return
        }
        const note = String(res.content || "").trim()
        if (note.length < 2) {
          wx.showToast({
        title: "说明至少 2 字",
            icon: "none"
          })
          return
        }
        this.updateStatus(item, action.status, note)
      }
    })
  },

  updateStatus(item, status, resolutionNote) {
    if (
      !item ||
      !item.id ||
      this.data.loading ||
      this.data.updatingId ||
      this._privacyManageWriteActive
    ) {
      return
    }

    const payload = {
      id: String(item.id),
      status: String(status || ""),
      resolutionNote: String(resolutionNote || "")
    }
    this.runPrivacyManageWrite({
      name: "privacyRequestUpdateStatus",
      data: payload,
      updatingId: payload.id,
      timeoutTitle: "更新超时，请重试",
      failureFallback: "更新失败",
      onResult: (result, isCurrent) => {
        if (!result || !result.ok) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "更新失败"),
            icon: "none"
          })
          this.setData({ updatingId: "" })
          return
        }
        this.setData({ updatingId: "" })
        wx.showToast({
          title: "状态已更新",
          icon: "success"
        })
        if (isCurrent()) {
          this.fetchList()
        }
      }
    })
  },

  runPrivacyManageWrite(options) {
    const input = options && typeof options === "object" ? options : {}
    if (this._privacyManageWriteActive) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({ updatingId: "" })
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const requestId = Number(this._privacyManageWriteRequestId || 0) + 1
    this._privacyManageWriteRequestId = requestId
    this._privacyManageWriteActive = true
    this.clearPrivacyManageWriteTimer()
    this.setData({ updatingId: String(input.updatingId || "") })

    let settled = false
    const isCurrent = () => this._privacyManageWriteRequestId === requestId
    const finishRequest = () => {
      if (settled || !isCurrent()) {
        return false
      }
      settled = true
      this._privacyManageWriteActive = false
      this.clearPrivacyManageWriteTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ updatingId: "" })
      wx.showToast({
        title: formatToastTitle(message, input.failureFallback || "操作失败"),
        icon: "none"
      })
    }

    this._privacyManageWriteTimer = setTimeout(() => {
      handleFailure(input.timeoutTitle || "操作超时，请重试")
    }, PRIVACY_MANAGE_WRITE_TIMEOUT_MS)

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
      },
      complete: () => {}
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  fetchList(options) {
    const input = options && typeof options === "object" ? options : {}
    const append = Boolean(input.append)
    const nextPage = append ? this.data.page + 1 : 0
    this.finishPrivacyManageListEffects()
    const requestId = Number(this._privacyManageListRequestId || 0) + 1
    this._privacyManageListRequestId = requestId
    this._privacyManageListDone =
      typeof input.done === "function" ? input.done : null

    if (this.data.updatingId) {
      this.finishPrivacyManageListEffects()
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        initialLoading: false,
        loading: false,
        hasLoaded: true,
        list: []
      })
      this.finishPrivacyManageListEffects()
      return
    }

    const filters = {
      page: nextPage,
      pageSize: this.data.pageSize,
      type: this.data.currentType === "all" ? "" : this.data.currentType,
      status: this.data.currentStatus === "all" ? "" : this.data.currentStatus,
      keyword: String(this.data.keyword || "")
    }
    this.setData({ loading: true })
    let settled = false
    const finishRequest = () => {
      if (settled || this._privacyManageListRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishPrivacyManageListEffects()
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
        initialLoading: false,
        loading: false,
        hasLoaded: true,
        page: append ? this.data.page : 0,
        list: append ? this.data.list : [],
        total: append ? this.data.total : 0,
        hasMore: append ? this.data.hasMore : false,
        truncated: append ? this.data.truncated : false
      })
    }

    this._privacyManageListTimer = setTimeout(() => {
      handleFailure("加载超时，请重试")
    }, PRIVACY_MANAGE_LIST_TIMEOUT_MS)

    const requestOptions = {
      name: "privacyRequestList",
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
            initialLoading: false,
            loading: false,
            hasLoaded: true,
            page: append ? this.data.page : 0,
            list: append ? this.data.list : [],
            total: append ? this.data.total : 0,
            hasMore: append ? this.data.hasMore : false,
            truncated: append ? this.data.truncated : false
          })
          return
        }

        const list = Array.isArray(result.list)
            ? result.list.map((item) => {
              const statusMeta = STATUS_META[item.status] || STATUS_META.pending
              const typeMeta = TYPE_META[item.type] || {
                label: "隐私申请",
                className: "request-type-default",
                iconClass: "request-type-icon-default"
              }
              return {
                ...item,
                typeLabel: typeMeta.label,
                typeClass: typeMeta.className,
                typeIconClass: typeMeta.iconClass,
                statusLabel: statusMeta.label,
                statusClass: statusMeta.className,
                cardStatusClass: `request-status-${item.status || "pending"}`,
                createdAtText: formatDisplayTime(item.createdAt),
                dataExportedAtText: formatDisplayTime(item.dataExportedAt),
                canHandle: ["pending", "processing"].includes(item.status),
                ...buildRequestJourney(item)
              }
            })
          : []
        this.setData({
          initialLoading: false,
          loading: false,
          hasLoaded: true,
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          total: Number(result.total) || 0,
          truncated: Boolean(result.truncated),
          list: append ? this.data.list.concat(list) : list
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

  finishPrivacyManageListEffects() {
    if (this._privacyManageListTimer) {
      clearTimeout(this._privacyManageListTimer)
      this._privacyManageListTimer = null
    }
    if (typeof this._privacyManageListDone === "function") {
      const done = this._privacyManageListDone
      this._privacyManageListDone = null
      done()
    }
  },

  clearPrivacyManageWriteTimer() {
    if (this._privacyManageWriteTimer) {
      clearTimeout(this._privacyManageWriteTimer)
      this._privacyManageWriteTimer = null
    }
  }
})
