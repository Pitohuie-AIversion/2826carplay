const ACTION_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "roleUpsert", label: "权限分配" },
  { value: "operationConfigUpdate", label: "运营配置" },
  { value: "vehicleUpdateStatus", label: "车辆状态" },
  { value: "vehicleDelete", label: "删除车辆" },
  { value: "vehicleImageUpdate", label: "车辆图片" },
  { value: "bookingUpdateStatus", label: "预约状态" },
  { value: "bookingUpdateAdminRemark", label: "预约备注" }
]

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

function buildSummary(item) {
  const action = item.action || ""
  if (action === "roleUpsert") {
    return `目标：${item.targetOpenid || "--"}\n权限：${Array.isArray(item.toPermissions) ? item.toPermissions.join(", ") : "--"}`
  }

  if (action === "operationConfigUpdate") {
    return `变更字段：${Array.isArray(item.changedKeys) ? item.changedKeys.join(", ") : "--"}`
  }

  if (action === "vehicleUpdateStatus") {
    return `车辆：${item.vehicleId || "--"}\n状态：${item.fromStatus || "--"} → ${item.toStatus || "--"}`
  }

  if (action === "bookingUpdateStatus") {
    return `预约：${item.bookingId || "--"}\n状态：${item.fromStatus || "--"} → ${item.toStatus || "--"}`
  }

  if (action === "bookingUpdateAdminRemark") {
    return `预约：${item.bookingId || "--"}\n备注长度：${item.remarkLength || 0}`
  }

  if (action === "vehicleDelete") {
    return `车辆：${item.vehicleId || "--"}`
  }

  if (action === "vehicleImageUpdate") {
    return `车辆：${item.vehicleId || "--"}\n操作：${item.imageAction || "--"}`
  }

  return ""
}

Page({
  data: {
    loading: false,
    keyword: "",
    currentAction: "all",
    actionOptions: ACTION_OPTIONS,
    page: 0,
    pageSize: 20,
    hasMore: false,
    total: 0,
    list: [],
    emptyTitle: "暂无审计日志",
    emptyDesc: "可在此查看权限分配与运营配置变更等关键操作记录"
  },

  onLoad() {
    this.fetchList()
  },

  onPullDownRefresh() {
    this.fetchList(() => {
      wx.stopPullDownRefresh()
    })
  },

  handleKeywordInput(event) {
    const value = String((event.detail && event.detail.value) || "")
    this.setData({ keyword: value })
  },

  handleSearch() {
    this.fetchList()
  },

  handleActionTap(event) {
    const action = event.currentTarget.dataset.action
    if (!action || action === this.data.currentAction) {
      return
    }

    this.setData({
      currentAction: action
    })
    this.fetchList()
  },

  handleLoadMore() {
    if (this.data.loading || !this.data.hasMore) {
      return
    }

    this.fetchList({ append: true })
  },

  fetchList(input) {
    const done = typeof input === "function" ? input : input && input.done
    const append = Boolean(input && typeof input === "object" && input.append)
    const nextPage = append ? this.data.page + 1 : 0
    const action = this.data.currentAction === "all" ? "" : this.data.currentAction

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        list: []
      })
      if (typeof done === "function") {
        done()
      }
      return
    }

    this.setData({
      loading: true
    })

    wx.cloud.callFunction({
      name: "auditLogList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize,
        action,
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
            loading: false,
            list: append ? this.data.list : [],
            hasMore: false,
            total: 0,
            page: 0
          })
          if (typeof done === "function") {
            done()
          }
          return
        }

        const list = Array.isArray(result.list)
          ? result.list.map((item) => ({
              ...item,
              createdAtText: formatDisplayTime(item.createdAt),
              summary: buildSummary(item)
            }))
          : []

        this.setData({
          loading: false,
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          total: result.total || 0,
          list: append ? this.data.list.concat(list) : list
        })
        if (typeof done === "function") {
          done()
        }
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "加载失败",
          icon: "none"
        })
        this.setData({
          loading: false
        })
        if (typeof done === "function") {
          done()
        }
      }
    })
  }
})

