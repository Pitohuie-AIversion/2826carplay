const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageCsvFileActions,
  beginPageCsvFileAction,
  cancelPageCsvFileActions,
  isPageCsvFileActionActive
} = require("../../shared/pageCsvFileActions")
const { formatDisplayTime } = require("../../shared/formatTime")
const {
  canShareCsvFile,
  isUserCancelError,
  openCsvFile,
  removeCsvFile,
  saveCsvFile,
  shareCsvFile
} = require("../../shared/csvFile")
const ERROR_LIST_TIMEOUT_MS = 15 * 1000
const ERROR_EXPORT_TIMEOUT_MS = 20 * 1000
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
    activatePageCsvFileActions(this)
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
    if (!this.data.pageAuthorized) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchList(() => {
      wx.stopPullDownRefresh()
    })
  },
  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageCsvFileActions(this)
    this._errorListRequestId = Number(this._errorListRequestId || 0) + 1
    this._exportRequestSerial = Number(this._exportRequestSerial || 0) + 1
    this.finishErrorListRequestEffects()
    this.clearExportRequestTimer()
  },
  handleKeywordInput(event) {
    const value = String((event.detail && event.detail.value) || "")
    this.setData({ keyword: value })
  },
  handleClearKeyword() {
    if (!this.data.keyword) {
      return
    }
    const listRequestId = Number(this._errorListRequestId || 0)
    this.setData({ keyword: "" }, () => {
      if (listRequestId !== Number(this._errorListRequestId || 0)) {
        return
      }
      this.fetchList()
    })
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
    const listRequestId = Number(this._errorListRequestId || 0)
    this.setData({
      keyword: "",
      currentFunc: "all",
      currentFuncLabel: "全部函数"
    }, () => {
      if (listRequestId !== Number(this._errorListRequestId || 0)) {
        return
      }
      this.fetchList()
    })
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
    const keyword = String(this.data.keyword || "")
    const exportSerial = Number(this._exportRequestSerial || 0) + 1
    this._exportRequestSerial = exportSerial
    this.clearExportRequestTimer()
    this.setData({
      exporting: true
    })
    let settled = false
    const isActive = () => !settled && exportSerial === this._exportRequestSerial
    const finishRequest = () => {
      if (!isActive()) {
        return false
      }
      settled = true
      this.clearExportRequestTimer()
      return true
    }
    const handleFailure = (message, fallback = "导出失败") => {
      if (!finishRequest()) {
        return
      }
      this.setData({ exporting: false })
      wx.showToast({
        title: formatToastTitle(message, fallback),
        icon: "none"
      })
    }
    this._exportRequestTimer = setTimeout(() => {
      handleFailure("导出超时，请重试")
    }, ERROR_EXPORT_TIMEOUT_MS)
    const requestOptions = {
      name: "logExportCsv",
      data: {
        logType: "error",
        filter,
        keyword,
        limit: 500
      },
      success: (res) => {
        if (!isActive()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.csvText) {
          handleFailure(result && result.message)
          return
        }
        let savePromise
        try {
          savePromise = saveCsvFile({
            fileName: result.fileName,
            fallbackFileName: "error-logs.csv",
            csvText: result.csvText
          })
        } catch (error) {
          handleFailure(error && (error.errMsg || error.message), "保存失败")
          return
        }
        Promise.resolve(savePromise)
          .then(({ filePath, fileName }) => {
            if (!finishRequest()) {
              if (filePath) {
                removeCsvFile(filePath).catch(() => {})
              }
              return
            }
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
            handleFailure(error && (error.errMsg || error.message), "保存失败")
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
  handleShareExportedFile() {
    if (this.data.exporting || !this.data.exportFilePath || !this.data.exportFileName) {
      return
    }
    const filePath = this.data.exportFilePath
    const action = beginPageCsvFileAction(this, filePath)
    shareCsvFile(filePath, this.data.exportFileName).catch((error) => {
      if (!isPageCsvFileActionActive(this, action)) {
        return
      }
      if (isUserCancelError(error)) {
        return
      }
      this.handleOpenExportedFile()
    })
  },
  handleOpenExportedFile() {
    if (this.data.exporting || !this.data.exportFilePath) {
      return
    }
    const filePath = this.data.exportFilePath
    const action = beginPageCsvFileAction(this, filePath)
    openCsvFile(filePath).catch(() => {
      if (!isPageCsvFileActionActive(this, action)) {
        return
      }
      wx.showToast({
        title: "文件已生成",
        icon: "none"
      })
    })
  },
  handleDeleteExportedFile() {
    const filePath = String(this.data.exportFilePath || "")
    if (this.data.exporting || !filePath) {
      return
    }
    const action = beginPageCsvFileAction(this, filePath)
    wx.showModal({
      title: "删除本地 CSV",
      content: "将从当前设备删除这份导出文件，删除后无法恢复。云端错误日志不会受到影响。",
      confirmText: "确认删除",
      confirmColor: "#d46868",
      success: (res) => {
        if (
          this.data.exporting ||
          !isPageCsvFileActionActive(this, action) ||
          !res.confirm
        ) {
          return
        }
        removeCsvFile(filePath)
          .then(() => {
            if (!isPageCsvFileActionActive(this, action)) {
              return
            }
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
            if (!isPageCsvFileActionActive(this, action)) {
              return
            }
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
    const keyword = String(this.data.keyword || "")
    const requestId = Number(this._errorListRequestId || 0) + 1
    this._errorListRequestId = requestId
    this.finishErrorListRequestEffects()
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
    this._errorListRequestDone = typeof done === "function" ? done : null
    this.setData({
      loading: true
    })
    let settled = false
    const finishRequest = () => {
      if (settled || this._errorListRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishErrorListRequestEffects()
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
        list: append ? this.data.list : [],
        hasMore: append ? this.data.hasMore : false,
        total: append ? this.data.total : 0,
        truncated: append ? this.data.truncated : false,
        page: append ? this.data.page : 0
      })
    }
    this._errorListRequestTimer = setTimeout(() => {
      handleFailure("加载超时，请重试")
    }, ERROR_LIST_TIMEOUT_MS)
    const requestOptions = {
      name: "errorLogList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize,
        func,
        keyword
      },
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
            list: append ? this.data.list : [],
            hasMore: false,
            total: 0,
            truncated: false,
            page: 0
          })
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
  finishErrorListRequestEffects() {
    if (this._errorListRequestTimer) {
      clearTimeout(this._errorListRequestTimer)
      this._errorListRequestTimer = null
    }
    const done = this._errorListRequestDone
    this._errorListRequestDone = null
    if (typeof done === "function") {
      done()
    }
  },
  clearExportRequestTimer() {
    if (!this._exportRequestTimer) {
      return
    }
    clearTimeout(this._exportRequestTimer)
    this._exportRequestTimer = null
  }
})
