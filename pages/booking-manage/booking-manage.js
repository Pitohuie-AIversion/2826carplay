const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待联系" },
  { value: "contacted", label: "已联系" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" }
]

const STATUS_TEXT_MAP = {
  pending: "待联系",
  contacted: "已联系",
  completed: "已完成",
  cancelled: "已取消"
}

const STATUS_CLASS_MAP = {
  pending: "status-pending",
  contacted: "status-contacted",
  completed: "status-completed",
  cancelled: "status-cancelled"
}

const DEFAULT_PAGE_SIZE = 20

function buildStatusSummary(stats) {
  return [
    { key: "pending", label: "待联系", value: stats.pending || 0 },
    { key: "contacted", label: "已联系", value: stats.contacted || 0 },
    { key: "completed", label: "已完成", value: stats.completed || 0 },
    { key: "recentCreated7d", label: "近 7 天新增", value: stats.recentCreated7d || 0 }
  ]
}

function buildStatusRatioSegments(stats) {
  const pending = Number(stats && stats.pending) || 0
  const contacted = Number(stats && stats.contacted) || 0
  const completed = Number(stats && stats.completed) || 0
  const total = pending + contacted + completed

  const base = [
    { key: "pending", label: "待联系", value: pending, className: "ratio-pending" },
    { key: "contacted", label: "已联系", value: contacted, className: "ratio-contacted" },
    { key: "completed", label: "已完成", value: completed, className: "ratio-completed" }
  ]

  if (!total) {
    return base.map((item) => ({
      ...item,
      percent: 0,
      percentText: "0%"
    }))
  }

  const rawPercents = base.map((item) => (item.value / total) * 100)
  const floors = rawPercents.map((value) => Math.floor(value))
  let used = floors.reduce((sum, n) => sum + n, 0)
  let remain = 100 - used

  const order = rawPercents
    .map((value, index) => ({
      index,
      frac: value - floors[index]
    }))
    .sort((a, b) => b.frac - a.frac)

  const percents = floors.slice()
  let i = 0
  while (remain > 0 && i < order.length) {
    percents[order[i].index] += 1
    remain -= 1
    i += 1
    if (i >= order.length) {
      i = 0
    }
  }

  return base.map((item, index) => ({
    ...item,
    percent: percents[index],
    percentText: `${percents[index]}%`
  }))
}

function buildRecentCreatedViewModel(list) {
  if (!Array.isArray(list)) {
    return []
  }

  return list.map((item) => {
    const status = item.status || "pending"
    return {
      id: item.id || "",
      vehicleName: item.vehicleName || "--",
      userName: item.userName || "--",
      city: item.city || "--",
      startDate: item.startDate || "--",
      endDate: item.endDate || "--",
      status,
      statusText: STATUS_TEXT_MAP[status] || "待联系",
      statusClass: STATUS_CLASS_MAP[status] || "status-pending",
      createdAtText: formatDisplayTime(item.createdAt)
    }
  })
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

function normalizeRemark(value) {
  return String(value || "").slice(0, 200)
}

function ensureCsvFileName(name) {
  const raw = String(name || "").trim()
  if (!raw) {
    return "bookings.csv"
  }
  if (/\.csv$/i.test(raw)) {
    return raw
  }
  return `${raw}.csv`
}

function getErrorMessage(error) {
  if (!error) {
    return ""
  }

  return String(error.errMsg || error.message || error)
}

function isTapGestureShareError(error) {
  const message = getErrorMessage(error).toLowerCase()
  return message.includes("tap gesture")
}

function isDevtoolsEnv() {
  try {
    if (!wx || typeof wx.getSystemInfoSync !== "function") {
      return false
    }
    const info = wx.getSystemInfoSync()
    return info && info.platform === "devtools"
  } catch (error) {
    return false
  }
}

function isDevtoolsNotSupportedShareError(error) {
  const message = getErrorMessage(error)
  if (!message) {
    return false
  }

  return message.includes("开发者工具") || message.includes("不支持")
}

Page({
  data: {
    loading: false,
    keyword: "",
    currentStatus: "all",
    statusOptions: STATUS_OPTIONS,
    total: 0,
    summaryItems: buildStatusSummary({}),
    statusRatioSegments: buildStatusRatioSegments({}),
    recentCreatedList: [],
    list: [],
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    hasMore: false,
    exportFilePath: "",
    exportFileName: "",
    canShareExport: true,
    emptyTitle: "暂无预约数据",
    emptyDesc: "当前筛选条件下没有匹配的预约记录"
  },

  onLoad() {
    const app = getApp()
    const env =
      app &&
      app.globalData &&
      app.globalData.cloudEnvId
        ? app.globalData.cloudEnvId
        : undefined

    if (wx.cloud && typeof wx.cloud.init === "function") {
      try {
        wx.cloud.init({
          env,
          traceUser: true
        })
      } catch (error) {}
    }

    this.setData({
      canShareExport: !isDevtoolsEnv() && typeof wx.shareFileMessage === "function"
    })

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

  handleKeywordConfirm() {
    this.fetchList()
  },

  handleSearch() {
    this.fetchList()
  },

  handleStatusTap(event) {
    const status = event.currentTarget.dataset.status
    if (!status || status === this.data.currentStatus) {
      return
    }

    this.setData({
      currentStatus: status
    })

    this.fetchList()
  },

  handleReset() {
    this.setData({
      keyword: "",
      currentStatus: "all"
    })

    this.fetchList()
  },

  handleLoadMore() {
    if (this.data.loading || !this.data.hasMore) {
      return
    }

    this.fetchList({ append: true })
  },

  handleExport() {
    if (this.data.loading) {
      return
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({
      loading: true,
      exportFilePath: "",
      exportFileName: ""
    })

    wx.cloud.callFunction({
      name: "bookingExportCsv",
      data: {
        status: this.data.currentStatus,
        keyword: this.data.keyword,
        limit: 500
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.csvText) {
          wx.showToast({
            title: (result && result.message) || "导出失败",
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        this.saveExportedCsv({
          fileName: ensureCsvFileName(result.fileName),
          csvText: result.csvText
        })
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "导出失败",
          icon: "none"
        })
        this.setData({ loading: false })
      }
    })
  },

  saveExportedCsv({ fileName, csvText }) {
    const fs = wx.getFileSystemManager && wx.getFileSystemManager()
    if (!fs) {
      wx.showToast({
        title: "文件系统不可用",
        icon: "none"
      })
      this.setData({ loading: false })
      return
    }

    const basePath = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : ""
    const filePath = basePath ? `${basePath}/${fileName}` : fileName

    fs.writeFile({
      filePath,
      data: csvText,
      encoding: "utf8",
      success: () => {
        this.setData({
          loading: false,
          exportFilePath: filePath,
          exportFileName: fileName
        })
        wx.showToast({
          title: "CSV已生成，请点击下方按钮分享",
          icon: "none"
        })
      },
      fail: (error) => {
        wx.showToast({
          title: getErrorMessage(error) || "保存失败",
          icon: "none"
        })
        this.setData({ loading: false })
      }
    })
  },

  handleShareExportedFile() {
    if (!this.data.exportFilePath || !this.data.exportFileName) {
      wx.showToast({
        title: "请先导出CSV",
        icon: "none"
      })
      return
    }

    this.shareCsvFile(this.data.exportFilePath, this.data.exportFileName)
  },

  handleOpenExportedFile() {
    if (!this.data.exportFilePath) {
      wx.showToast({
        title: "请先导出CSV",
        icon: "none"
      })
      return
    }

    this.openCsvFile(this.data.exportFilePath)
  },

  shareCsvFile(filePath, fileName) {
    const share = wx.shareFileMessage
    if (isDevtoolsEnv()) {
      wx.showToast({
        title: "开发者工具不支持直接分享，将为你打开文件",
        icon: "none"
      })
      this.openCsvFile(filePath)
      return
    }

    if (typeof share === "function") {
      share({
        filePath,
        fileName,
        success: () => {
          wx.showToast({
            title: "已生成文件，可直接分享",
            icon: "none"
          })
        },
        fail: (error) => {
          if (isTapGestureShareError(error)) {
            wx.showToast({
              title: "当前环境限制直接分享，已为你打开文件",
              icon: "none"
            })
            this.openCsvFile(filePath)
            return
          }

          if (isDevtoolsNotSupportedShareError(error)) {
            wx.showToast({
              title: "当前环境不支持直接分享，将为你打开文件",
              icon: "none"
            })
            this.openCsvFile(filePath)
            return
          }

          wx.showToast({
            title: getErrorMessage(error) || "分享失败",
            icon: "none"
          })
        }
      })
      return
    }

    this.openCsvFile(filePath)
  },

  openCsvFile(filePath) {
    const open = wx.openDocument
    if (typeof open === "function") {
      open({
        filePath,
        fileType: "csv",
        showMenu: true,
        success: () => {},
        fail: () => {
          wx.showToast({
            title: "文件已生成",
            icon: "none"
          })
        }
      })
      return
    }

    wx.showToast({
      title: "文件已生成",
      icon: "none"
    })
  },

  handleRemarkInput(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) {
      return
    }

    const value = normalizeRemark(event.detail && event.detail.value)
    this.setData({
      [`list[${index}].adminRemarkDraft`]: value
    })
  },

  handleViewDetail(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (!id) {
      return
    }

    const current = this.data.list.find((item) => item.id === id)

    wx.navigateTo({
      url: `/pages/booking-manage-detail/booking-manage-detail?id=${id}`,
      success: (res) => {
        if (current && res && res.eventChannel) {
          res.eventChannel.emit("acceptManageBookingDetail", {
            booking: current
          })
        }
      },
      fail: () => {
        wx.showToast({
          title: "页面跳转失败",
          icon: "none"
        })
      }
    })
  },

  handleUpdateStatus(event) {
    if (this.data.loading) {
      return
    }

    const id = String(event.currentTarget.dataset.id || "").trim()
    const status = String(event.currentTarget.dataset.status || "").trim()
    if (!id || !status) {
      return
    }

    const statusText = STATUS_TEXT_MAP[status] || status

    wx.showModal({
      title: "更新状态",
      content: `确认将该预约更新为「${statusText}」？`,
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return
        }

        this.updateStatus(id, status)
      }
    })
  },

  handleSaveRemark(event) {
    if (this.data.loading) {
      return
    }

    const id = String(event.currentTarget.dataset.id || "").trim()
    const index = Number(event.currentTarget.dataset.index)
    if (!id || !Number.isInteger(index) || index < 0) {
      return
    }

    const current = this.data.list[index] || {}
    const adminRemark = normalizeRemark(current.adminRemarkDraft)

    this.saveRemark(id, adminRemark)
  },

  updateStatus(id, status) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({
      loading: true
    })

    wx.cloud.callFunction({
      name: "bookingUpdateStatus",
      data: { id, status },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "更新失败",
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        wx.showToast({
          title: "状态已更新",
          icon: "none"
        })

        this.fetchList()
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "更新失败",
          icon: "none"
        })
        this.setData({ loading: false })
      }
    })
  },

  saveRemark(id, adminRemark) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({
      loading: true
    })

    wx.cloud.callFunction({
      name: "bookingUpdateAdminRemark",
      data: { id, adminRemark },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "保存失败",
            icon: "none"
          })
          this.setData({ loading: false })
          return
        }

        wx.showToast({
          title: "备注已保存",
          icon: "none"
        })

        this.fetchList()
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "保存失败",
          icon: "none"
        })
        this.setData({ loading: false })
      }
    })
  },

  fetchList(input) {
    const done = typeof input === "function" ? input : input && input.done
    const append = Boolean(input && typeof input === "object" && input.append)
    const nextPage = append ? this.data.page + 1 : 0
    const pageSize = this.data.pageSize || DEFAULT_PAGE_SIZE

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
      name: "bookingList",
      data: {
        status: this.data.currentStatus,
        keyword: this.data.keyword,
        limit: 500,
        page: nextPage,
        pageSize
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        const list = result && result.ok && Array.isArray(result.list) ? result.list : []
        const formatted = list.map((item) => {
          const status = item.status || "pending"
          return {
            ...item,
            statusText: STATUS_TEXT_MAP[status] || "待联系",
            statusClass: STATUS_CLASS_MAP[status] || "status-pending",
            createdAtText: formatDisplayTime(item.createdAt),
            adminRemark: item.adminRemark || "",
            adminRemarkDraft: item.adminRemark || "",
            adminRemarkUpdatedAtText: formatDisplayTime(item.adminRemarkUpdatedAt)
          }
        })

        const nextList = append ? this.data.list.concat(formatted) : formatted

        this.setData({
          loading: false,
          page: result && result.ok && Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result && result.ok && result.hasMore),
          total: result && result.ok ? result.total || 0 : 0,
          summaryItems: buildStatusSummary((result && result.dashboard) || {}),
          statusRatioSegments: buildStatusRatioSegments((result && result.dashboard) || {}),
          recentCreatedList: buildRecentCreatedViewModel((result && result.recentCreatedList) || []),
          list: nextList
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
          loading: false,
          page: 0,
          hasMore: false,
          total: 0,
          summaryItems: buildStatusSummary({}),
          statusRatioSegments: buildStatusRatioSegments({}),
          recentCreatedList: [],
          list: []
        })
        if (typeof done === "function") {
          done()
        }
      }
    })
  }
})
