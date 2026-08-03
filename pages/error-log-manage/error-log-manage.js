const { requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  canShareCsvFile,
  isUserCancelError,
  openCsvFile,
  removeCsvFile,
  saveCsvFile,
  shareCsvFile
} = require("../../shared/csvFile")

const FUNC_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "analyticsCleanup", label: "匿名数据清理" },
  { value: "bootstrapAdmin", label: "管理员初始化" },
  { value: "bookingCancel", label: "预约取消" },
  { value: "bookingCalendarList", label: "预约日历" },
  { value: "bookingCreate", label: "预约创建" },
  { value: "bookingUpdateAdminRemark", label: "预约备注" },
  { value: "bookingUpdateStatus", label: "预约状态" },
  { value: "bookingExportCsv", label: "预约导出" },
  { value: "privacyRequestDataInventory", label: "隐私数据核验" },
  { value: "logExportCsv", label: "日志导出" },
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

const FUNC_LABEL_MAP = FUNC_OPTIONS.reduce((map, item) => {
  map[item.value] = item.label
  return map
}, {})

function buildErrorView(item) {
  const func = String(item.function || "")
  const sourceLabel = FUNC_LABEL_MAP[func] || "未知服务"
  let sourceGroup = "系统运营"
  let eventClass = "error-event-operation"
  let eventIconClass = "error-event-icon-operation"

  if (func === "bootstrapAdmin" || func === "roleUpsert") {
    sourceGroup = "权限安全"
    eventClass = "error-event-access"
    eventIconClass = "error-event-icon-access"
  } else if (func.startsWith("vehicle")) {
    sourceGroup = "车辆管理"
    eventClass = "error-event-vehicle"
    eventIconClass = "error-event-icon-vehicle"
  } else if (func.startsWith("booking")) {
    sourceGroup = "预约服务"
    eventClass = "error-event-booking"
    eventIconClass = "error-event-icon-booking"
  } else if (func.startsWith("privacyRequest")) {
    sourceGroup = "隐私服务"
    eventClass = "error-event-privacy"
    eventIconClass = "error-event-icon-privacy"
  }

  let diagnosticHint = "结合发生时间前往云函数日志查看完整调用链"
  if (item.errorCode) {
    diagnosticHint = `优先按错误码 ${item.errorCode} 检索云函数日志`
  } else if (item.stage) {
    diagnosticHint = `建议先检查“${item.stage}”阶段的调用与配置`
  }

  return {
    sourceLabel,
    sourceGroup,
    eventClass,
    eventIconClass,
    errorSignal: item.errorCode ? "错误码已记录" : "运行异常",
    diagnosticHint
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

function buildSummary(item) {
  const parts = []
  if (item.vehicleId) {
    parts.push(`车辆：${item.vehicleId}`)
  }
  if (item.bookingId) {
    parts.push(`预约：${item.bookingId}`)
  }
  if (item.stage) {
    parts.push(`阶段：${item.stage}`)
  }
  if (item.targetStatus) {
    parts.push(`目标状态：${item.targetStatus}`)
  }
  if (item.errorCode) {
    parts.push(`错误码：${item.errorCode}`)
  }
  return parts.join("\n")
}

function buildSummaryRows(summary) {
  return String(summary || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf("：")
      if (separatorIndex < 0) {
        return { label: "详情", value: line }
      }
      return {
        label: line.slice(0, separatorIndex),
        value: line.slice(separatorIndex + 1) || "—"
      }
    })
}

function buildMessagePreview(message) {
  const text = String(message || "").trim()
  if (!text) {
    return ""
  }
  if (text.length <= 140) {
    return text
  }
  return `${text.slice(0, 140)}…`
}

Page({
  data: {
    initialLoading: true,
    loading: false,
    exporting: false,
    pageAuthorized: false,
    keyword: "",
    currentFunc: "all",
    currentFuncLabel: "全部函数",
    funcOptions: FUNC_OPTIONS,
    page: 0,
    pageSize: 20,
    hasMore: false,
    total: 0,
    truncated: false,
    list: [],
    exportFilePath: "",
    exportFileName: "",
    canShareExport: true,
    emptyTitle: "暂无错误日志",
    emptyDesc: "当云函数出现异常时，会在此记录，便于线上排障"
  },

  onLoad() {
    this.setData({
      canShareExport: canShareCsvFile()
    })
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

  handleClearKeyword() {
    if (!this.data.keyword) {
      return
    }
    this.setData({ keyword: "" }, () => this.fetchList())
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
      currentFunc: value,
      currentFuncLabel: value === "all" ? "全部函数" : FUNC_LABEL_MAP[value] || "未知服务"
    })
    this.fetchList()
  },

  handleResetFilters() {
    if (!this.data.keyword && this.data.currentFunc === "all") {
      return
    }
    this.setData({
      keyword: "",
      currentFunc: "all",
      currentFuncLabel: "全部函数"
    }, () => this.fetchList())
  },

  handleLoadMore() {
    if (this.data.loading || !this.data.hasMore) {
      return
    }

    this.fetchList({ append: true })
  },

  handleExport() {
    if (this.data.loading || this.data.exporting) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const filter = this.data.currentFunc === "all" ? "" : this.data.currentFunc
    this.setData({
      exporting: true
    })
    wx.cloud.callFunction({
      name: "logExportCsv",
      data: {
        logType: "error",
        filter,
        keyword: this.data.keyword,
        limit: 500
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.csvText) {
          wx.showToast({
              title: formatToastTitle(result && result.message, "导出失败"),
            icon: "none"
          })
          this.setData({ exporting: false })
          return
        }

        saveCsvFile({
          fileName: result.fileName,
          fallbackFileName: "error-logs.csv",
          csvText: result.csvText
        })
          .then(({ filePath, fileName }) => {
            const previousFilePath = this.data.exportFilePath
            this.setData({
              exporting: false,
              exportFilePath: filePath,
              exportFileName: fileName
            })
            if (previousFilePath && previousFilePath !== filePath) {
              removeCsvFile(previousFilePath).catch(() => {})
            }
            if (result.truncated) {
              wx.showModal({
                title: "CSV 已生成",
                content: result.sourceTruncated
                  ? `已导出最近扫描结果中的 ${result.total || 0} 条，日志超过 2000 条扫描上限，请缩小筛选范围后分批归档。`
                  : `符合条件 ${result.matchedTotal || 0} 条，本次已导出 ${result.total || 0} 条，请分批归档。`,
                confirmText: "知道了",
                confirmColor: "#528fff",
                showCancel: false
              })
            } else {
              wx.showToast({
                title: "CSV 已生成",
                icon: "none"
              })
            }
          })
          .catch((error) => {
            wx.showToast({
              title: "保存失败",
              icon: "none"
            })
            this.setData({ exporting: false })
          })
      },
      fail: (error) => {
        wx.showToast({
          title: "导出失败",
          icon: "none"
        })
        this.setData({ exporting: false })
      }
    })
  },

  handleShareExportedFile() {
    if (!this.data.exportFilePath || !this.data.exportFileName) {
      return
    }
    shareCsvFile(this.data.exportFilePath, this.data.exportFileName).catch((error) => {
      if (isUserCancelError(error)) {
        return
      }
      this.handleOpenExportedFile()
    })
  },

  handleOpenExportedFile() {
    if (!this.data.exportFilePath) {
      return
    }
    openCsvFile(this.data.exportFilePath).catch(() => {
      wx.showToast({
        title: "文件已生成",
        icon: "none"
      })
    })
  },

  handleDeleteExportedFile() {
    const filePath = String(this.data.exportFilePath || "")
    if (!filePath) {
      return
    }
    wx.showModal({
      title: "删除本地 CSV",
      content: "将从当前设备删除这份导出文件，删除后无法恢复。云端错误日志不会受到影响。",
      confirmText: "确认删除",
      confirmColor: "#d46868",
      success: (res) => {
        if (!res.confirm) {
          return
        }
        removeCsvFile(filePath)
          .then(() => {
            this.setData({
              exportFilePath: "",
              exportFileName: ""
            })
            wx.showToast({
              title: "本地文件已删除",
              icon: "none"
            })
          })
          .catch((error) => {
            wx.showToast({
              title: "删除失败",
              icon: "none"
            })
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
        initialLoading: false,
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
          title: formatToastTitle(result && result.message, "加载失败"),
            icon: "none"
          })
          this.setData({
            initialLoading: false,
            loading: false,
            list: append ? this.data.list : [],
            hasMore: false,
            total: 0,
            truncated: false,
            page: 0
          })
          if (typeof done === "function") {
            done()
          }
          return
        }

        const list = Array.isArray(result.list)
          ? result.list.map((item) => {
              const summary = buildSummary(item)
              return {
                ...item,
                ...buildErrorView(item),
                createdAtText: formatDisplayTime(item.createdAt || item.occurredAt),
                summary,
                summaryRows: buildSummaryRows(summary),
                messagePreview: buildMessagePreview(item.errorMessage)
              }
            })
          : []

        this.setData({
          initialLoading: false,
          loading: false,
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          total: result.total || 0,
          truncated: Boolean(result.truncated),
          list: append ? this.data.list.concat(list) : list
        })
        if (typeof done === "function") {
          done()
        }
      },
      fail: (error) => {
        wx.showToast({
          title: "加载失败",
          icon: "none"
        })
        this.setData({
          initialLoading: false,
          loading: false
        })
        if (typeof done === "function") {
          done()
        }
      }
    })
  }
})
