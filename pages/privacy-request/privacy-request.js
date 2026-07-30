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
    typeOptions: TYPE_OPTIONS.map((item) => ({ ...item, active: item.value === "access" })),
    currentType: "access",
    description: "",
    submitting: false,
    cancellingId: "",
    initialLoading: true,
    loading: false,
    loadError: "",
    list: [],
    page: 0,
    pageSize: 20,
    hasMore: false
  },

  onLoad() {
    this.fetchList()
  },

  onPullDownRefresh() {
    this.fetchList({
      done: () => wx.stopPullDownRefresh()
    })
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
    this.setData({
      description: String((event.detail && event.detail.value) || "")
    })
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
        title: "申请说明不能超过 500 字",
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

    this.setData({ submitting: true })
    wx.cloud.callFunction({
      name: "privacyRequestCreate",
      data: {
        type: this.data.currentType,
        description
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "提交失败",
            icon: "none"
          })
          return
        }
        this.setData({ description: "" })
        wx.showToast({
          title: "申请已提交",
          icon: "success"
        })
        this.fetchList()
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "提交失败",
          icon: "none"
        })
      },
      complete: () => {
        this.setData({ submitting: false })
      }
    })
  },

  handleRetry() {
    this.fetchList()
  },

  handleLoadMore() {
    if (this.data.loading || !this.data.hasMore) {
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

    this.setData({ cancellingId: id })
    wx.cloud.callFunction({
      name: "privacyRequestCancel",
      data: { id },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "撤回失败",
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
        this.fetchList()
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "撤回失败",
          icon: "none"
        })
      },
      complete: () => {
        this.setData({ cancellingId: "" })
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
        loadError: "云能力未初始化"
      })
      if (typeof input.done === "function") {
        input.done()
      }
      return
    }

    this.setData({
      loading: true,
      loadError: append ? this.data.loadError : ""
    })
    wx.cloud.callFunction({
      name: "privacyRequestMyList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            initialLoading: false,
            loading: false,
            loadError: (result && result.message) || "申请记录加载失败",
            list: append ? this.data.list : []
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
                canCancel: item.status === "pending"
              }
            })
          : []
        this.setData({
          initialLoading: false,
          loading: false,
          loadError: "",
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          list: append ? this.data.list.concat(list) : list
        })
      },
      fail: (error) => {
        this.setData({
          initialLoading: false,
          loading: false,
          loadError: (error && (error.errMsg || error.message)) || "申请记录加载失败",
          list: append ? this.data.list : []
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
