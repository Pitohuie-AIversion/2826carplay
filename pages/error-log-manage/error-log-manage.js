const { requirePagePermission } = require("../../shared/pageAuth")

const FUNC_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "bootstrapAdmin", label: "管理员初始化" },
  { value: "bookingCancel", label: "预约取消" },
  { value: "bookingCreate", label: "预约创建" },
  { value: "bookingUpdateAdminRemark", label: "预约备注" },
  { value: "bookingUpdateStatus", label: "预约状态" },
  { value: "bookingExportCsv", label: "预约导出" },
  { value: "vehicleCreate", label: "车辆创建" },
  { value: "vehicleUpdate", label: "车辆编辑" },
  { value: "vehicleRetire", label: "车辆停用" },
  { value: "vehicleRestore", label: "车辆恢复" },
  { value: "vehicleUpdateStatus", label: "车辆状态" },
  { value: "vehicleDelete", label: "车辆删除" },
  { value: "vehicleImageUpdate", label: "车辆图片" },
  { value: "roleUpsert", label: "权限分配" },
  { value: "operationConfigUpdate", label: "运营配置" }
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
  const parts = []
  if (item.openid) {
    parts.push(`操作者：${item.openid}`)
  }
  if (item.targetOpenid) {
    parts.push(`目标：${item.targetOpenid}`)
  }
  if (item.vehicleId) {
    parts.push(`车辆：${item.vehicleId}`)
  }
  if (item.bookingId) {
    parts.push(`预约：${item.bookingId}`)
  }
  if (item.stage) {
    parts.push(`阶段：${item.stage}`)
  }
  return parts.join("\n")
}

function buildMessagePreview(message) {
  const text = String(message || "").trim()
  if (!text) {
    return ""
  }
  if (text.length <= 140) {
    return text
  }
  return `${text.slice(0, 140)}...`
}

Page({
  data: {
    loading: false,
    pageAuthorized: false,
    keyword: "",
    currentFunc: "all",
    funcOptions: FUNC_OPTIONS,
    page: 0,
    pageSize: 20,
    hasMore: false,
    total: 0,
    list: [],
    emptyTitle: "暂无错误日志",
    emptyDesc: "当云函数出现异常时，会在此记录，便于线上排障"
  },

  onLoad() {
    requirePagePermission(this, {
      required: "canViewErrorLogs",
      noPermissionMessage: "无权访问错误日志",
      onAuthorized: () => {
        this.fetchList()
      }
    })
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

  handleFuncTap(event) {
    const value = event.currentTarget.dataset.value
    if (!value || value === this.data.currentFunc) {
      return
    }

    this.setData({
      currentFunc: value
    })
    this.fetchList()
  },

  handleLoadMore() {
    if (this.data.loading || !this.data.hasMore) {
      return
    }

    this.fetchList({ append: true })
  },

  handleCopyStack(event) {
    const stack = event.currentTarget.dataset.stack
    const text = String(stack || "")
    if (!text) {
      return
    }

    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({
          title: "已复制",
          icon: "none"
        })
      },
      fail: () => {
        wx.showToast({
          title: "复制失败",
          icon: "none"
        })
      }
    })
  },

  fetchList(input) {
    const done = typeof input === "function" ? input : input && input.done
    const append = Boolean(input && typeof input === "object" && input.append)
    const nextPage = append ? this.data.page + 1 : 0
    const func = this.data.currentFunc === "all" ? "" : this.data.currentFunc

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
      name: "errorLogList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize,
        func,
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
              createdAtText: formatDisplayTime(item.createdAt || item.occurredAt),
              summary: buildSummary(item),
              messagePreview: buildMessagePreview(item.errorMessage)
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
