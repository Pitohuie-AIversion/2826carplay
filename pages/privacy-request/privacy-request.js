const { formatToastTitle } = require("../../shared/uiFeedback")
const PRIVACY_REQUEST_LIST_TIMEOUT_MS = 15 * 1000
const PRIVACY_REQUEST_MUTATION_TIMEOUT_MS = 12 * 1000

const TYPE_OPTIONS = [
  { value: "access", label: "查询信息", desc: "申请了解平台当前保存的个人信息" },
  { value: "correction", label: "更正信息", desc: "申请修正不准确或已变化的个人信息" },
  { value: "deletion", label: "删除信息", desc: "申请删除符合法律与业务条件的个人信息" }
]

const TYPE_LABELS = {
  access: "查询信息",
  correction: "更正信息",
  deletion: "删除信息"
}

const STATUS_META = {
  pending: {
    label: "待处理",
    className: "status-pending",
    stageHint: "申请已进入队列，开始处理前可随时撤回"
  },
  processing: {
    label: "处理中",
    className: "status-processing",
    stageHint: "工作人员正在核验相关信息，请留意处理反馈"
  },
  completed: {
    label: "已完成",
    className: "status-completed",
    stageHint: "本次申请已处理完成，请查看下方反馈"
  },
  rejected: {
    label: "未通过",
    className: "status-rejected",
    stageHint: "本次申请未通过，请根据反馈调整后再提交"
  },
  cancelled: {
    label: "已撤回",
    className: "status-cancelled",
    stageHint: "本次申请已撤回，如仍有需要可重新提交"
  }
}

const ACTIVE_STATUSES = new Set(["pending", "processing"])

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

function buildDescriptionState(value) {
  const text = String(value || "")
  const length = text.length
  const trimmedLength = text.trim().length
  const formReady = trimmedLength >= 2 && length <= 500

  return {
    description: text,
    descriptionLength: length,
    formReady,
    descriptionHint: formReady
      ? "说明已填写，可以提交申请"
      : trimmedLength
        ? `还需补充 ${Math.max(2 - trimmedLength, 0)} 个字`
        : "请简要说明希望处理的具体信息"
  }
}

function normalizeRequestItem(item) {
  const source = item && typeof item === "object" ? item : {}
  const status = Object.prototype.hasOwnProperty.call(STATUS_META, source.status)
    ? source.status
    : "pending"
  const statusMeta = STATUS_META[status]
  return {
    ...source,
    status,
    typeLabel: TYPE_LABELS[source.type] || "隐私申请",
    statusLabel: statusMeta.label,
    statusClass: statusMeta.className,
    stageHint: statusMeta.stageHint,
    createdAtText: formatDisplayTime(source.createdAt),
    canCancel: status === "pending",
    active: ACTIVE_STATUSES.has(status)
  }
}

function buildRequestView(list, filter) {
  const normalizedList = (Array.isArray(list) ? list : []).map(normalizeRequestItem)
  const activeCount = normalizedList.filter((item) => item.active).length
  const completedCount = normalizedList.length - activeCount
  const visibleList =
    filter === "active"
      ? normalizedList.filter((item) => item.active)
      : filter === "completed"
        ? normalizedList.filter((item) => !item.active)
        : normalizedList

  return {
    list: normalizedList,
    visibleList,
    requestSummary: {
      total: normalizedList.length,
      active: activeCount,
      completed: completedCount
    }
  }
}

Page({
  data: {
    typeOptions: TYPE_OPTIONS.map((item) => ({ ...item, active: item.value === "access" })),
    currentType: "access",
    description: "",
    descriptionLength: 0,
    descriptionHint: "请简要说明希望处理的具体信息",
    formReady: false,
    submitting: false,
    cancellingId: "",
    initialLoading: true,
    loading: false,
    loadError: "",
    list: [],
    visibleList: [],
    currentFilter: "all",
    requestSummary: {
      total: 0,
      active: 0,
      completed: 0
    },
    page: 0,
    pageSize: 20,
    hasMore: false
  },

  onLoad() {
    this.fetchList()
  },

  onPullDownRefresh() {
    if (this.data.submitting || this.data.cancellingId) {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh()
      }
      return
    }
    this.fetchList({
      done: () => wx.stopPullDownRefresh()
    })
  },

  onUnload() {
    this._listRequestId = Number(this._listRequestId || 0) + 1
    this._submitRequestSerial = Number(this._submitRequestSerial || 0) + 1
    this._cancelRequestSerial = Number(this._cancelRequestSerial || 0) + 1
    this.finishListRequestEffects()
    this.clearSubmitRequestTimer()
    this.clearCancelRequestTimer()
  },

  handleTypeTap(event) {
    const value = String(event.currentTarget.dataset.value || "")
    if (!TYPE_LABELS[value]) {
      return
    }
    this.setData({
      currentType: value,
      typeOptions: this.data.typeOptions.map((item) => ({
        ...item,
        active: item.value === value
      }))
    })
  },

  handleDescriptionInput(event) {
    this.setData(buildDescriptionState((event.detail && event.detail.value) || ""))
  },

  handleRecordFilterTap(event) {
    const filter = String(event.currentTarget.dataset.filter || "")
    if (!["all", "active", "completed"].includes(filter) || filter === this.data.currentFilter) {
      return
    }
    this.applyRequestList(this.data.list, {
      filter
    })
  },

  handleShowAllRecords() {
    if (this.data.currentFilter !== "all") {
      this.applyRequestList(this.data.list, {
        filter: "all"
      })
    }
  },

  handleSubmit() {
    if (this.data.submitting) {
      return
    }
    const description = String(this.data.description || "").trim()
    if (description.length < 2) {
      wx.showToast({
        title: "请填写申请说明",
        icon: "none"
      })
      return
    }
    if (description.length > 500) {
      wx.showToast({
        title: "说明最多 500 字",
        icon: "none"
      })
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const requestType = String(this.data.currentType || "access")
    const submitSerial = Number(this._submitRequestSerial || 0) + 1
    this._submitRequestSerial = submitSerial
    this.clearSubmitRequestTimer()
    this.setData({ submitting: true })

    let settled = false
    const finishRequest = () => {
      if (settled || submitSerial !== this._submitRequestSerial) {
        return false
      }
      settled = true
      this.clearSubmitRequestTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ submitting: false })
      wx.showToast({
        title: formatToastTitle(message, "提交失败"),
        icon: "none"
      })
    }

    this._submitRequestTimer = setTimeout(() => {
      handleFailure("提交超时，请重试")
    }, PRIVACY_REQUEST_MUTATION_TIMEOUT_MS)

    const requestOptions = {
      name: "privacyRequestCreate",
      data: {
        type: requestType,
        description
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ submitting: false })
          wx.showToast({
            title: formatToastTitle(result && result.message, "提交失败"),
            icon: "none"
          })
          return
        }
        this.setData({
          ...buildDescriptionState(""),
          submitting: false
        })
        wx.showToast({
          title: "申请已提交",
          icon: "success"
        })
        this.fetchList()
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  clearSubmitRequestTimer() {
    if (!this._submitRequestTimer) {
      return
    }
    clearTimeout(this._submitRequestTimer)
    this._submitRequestTimer = null
  },

  handleRetry() {
    this.fetchList()
  },

  handleLoadMore() {
    if (this.data.loading || this.data.submitting || this.data.cancellingId || !this.data.hasMore) {
      return
    }
    this.fetchList({ append: true })
  },

  handleCancelRequest(event) {
    const id = String(event.currentTarget.dataset.id || "")
    if (!id || this.data.cancellingId) {
      return
    }

    wx.showModal({
      title: "撤回隐私申请",
      content: "仅待处理申请可以撤回。撤回后如仍有需要，可稍后重新提交。",
      confirmText: "确认撤回",
      confirmColor: "#d46868",
      success: (res) => {
        if (res.confirm) {
          this.cancelRequest(id)
        }
      }
    })
  },

  cancelRequest(id) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const requestId = String(id || "").trim()
    const cancelSerial = Number(this._cancelRequestSerial || 0) + 1
    this._cancelRequestSerial = cancelSerial
    this._listRequestId = Number(this._listRequestId || 0) + 1
    this.finishListRequestEffects()
    this.clearCancelRequestTimer()
    this.setData({ cancellingId: requestId, loading: false })

    let settled = false
    const finishRequest = () => {
      if (settled || cancelSerial !== this._cancelRequestSerial) {
        return false
      }
      settled = true
      this.clearCancelRequestTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ cancellingId: "" })
      wx.showToast({
        title: formatToastTitle(message, "撤回失败"),
        icon: "none"
      })
    }

    this._cancelRequestTimer = setTimeout(() => {
      handleFailure("撤回超时，请重试")
    }, PRIVACY_REQUEST_MUTATION_TIMEOUT_MS)

    const requestOptions = {
      name: "privacyRequestCancel",
      data: { id: requestId },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ cancellingId: "" })
          wx.showToast({
            title: formatToastTitle(result && result.message, "撤回失败"),
            icon: "none"
          })
          if (result && ["STATUS_CONFLICT", "STATUS_NOT_ALLOWED"].includes(result.code)) {
            this.fetchList()
          }
          return
        }
        wx.showToast({
          title: "申请已撤回",
          icon: "none"
        })
        this.setData({ cancellingId: "" })
        this.fetchList()
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  clearCancelRequestTimer() {
    if (!this._cancelRequestTimer) {
      return
    }
    clearTimeout(this._cancelRequestTimer)
    this._cancelRequestTimer = null
  },

  applyRequestList(list, options) {
    const input = options && typeof options === "object" ? options : {}
    const filter =
      ["all", "active", "completed"].includes(input.filter)
        ? input.filter
        : this.data.currentFilter
    const view = buildRequestView(list, filter)
    const patch = {
      ...view,
      currentFilter: filter
    }

    if (Number.isInteger(input.page)) {
      patch.page = input.page
    }
    if (typeof input.hasMore === "boolean") {
      patch.hasMore = input.hasMore
    }
    this.setData(patch)
  },

  fetchList(options) {
    const input = options && typeof options === "object" ? options : {}
    const append = Boolean(input.append)
    const nextPage = append ? this.data.page + 1 : 0
    const requestId = Number(this._listRequestId || 0) + 1
    this._listRequestId = requestId
    this.finishListRequestEffects()

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        initialLoading: false,
        loading: false,
        loadError: "云能力未初始化"
      })
      if (typeof input.done === "function") {
        input.done()
      }
      return
    }

    this._listRequestDone = typeof input.done === "function" ? input.done : null
    this.setData({
      loading: true,
      loadError: append ? this.data.loadError : ""
    })

    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._listRequestId) {
        return false
      }
      settled = true
      this.finishListRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        initialLoading: false,
        loading: false,
        loadError: String(message || "申请记录加载失败")
      })
      if (!append) {
        this.applyRequestList([], {
          filter: this.data.currentFilter,
          page: 0,
          hasMore: false
        })
      }
    }

    this._listRequestTimer = setTimeout(() => {
      handleFailure("申请记录加载超时，请检查网络后重试")
    }, PRIVACY_REQUEST_LIST_TIMEOUT_MS)

    const requestOptions = {
      name: "privacyRequestMyList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            initialLoading: false,
            loading: false,
            loadError: (result && result.message) || "申请记录加载失败"
          })
          if (!append) {
            this.applyRequestList([], {
              filter: this.data.currentFilter,
              page: 0,
              hasMore: false
            })
          }
          return
        }

        const list = Array.isArray(result.list)
          ? result.list
          : []
        const nextList = append ? this.data.list.concat(list) : list
        this.applyRequestList(nextList, {
          filter: this.data.currentFilter,
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore)
        })
        this.setData({
          initialLoading: false,
          loading: false,
          loadError: ""
        })
      },
      fail: (error) => {
        handleFailure((error && (error.errMsg || error.message)) || "申请记录加载失败")
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure((error && (error.errMsg || error.message)) || "申请记录加载失败")
    }
  },

  finishListRequestEffects() {
    if (this._listRequestTimer) {
      clearTimeout(this._listRequestTimer)
      this._listRequestTimer = null
    }
    const done = this._listRequestDone
    this._listRequestDone = null
    if (typeof done === "function") {
      done()
    }
  }
})
