const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageCsvFileActions,
  beginPageCsvFileAction,
  cancelPageCsvFileActions,
  isPageCsvFileActionActive
} = require("../../shared/pageCsvFileActions")
const {
  canShareCsvFile,
  isUserCancelError,
  openCsvFile,
  removeCsvFile,
  saveCsvFile,
  shareCsvFile
} = require("../../shared/csvFile")
const AUDIT_LIST_TIMEOUT_MS = 15 * 1000
const AUDIT_EXPORT_TIMEOUT_MS = 20 * 1000
const ACTION_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "bootstrapAdmin", label: "管理员初始化" },
  { value: "roleUpsert", label: "权限分配" },
  { value: "operationConfigUpdate", label: "运营配置" },
  { value: "vehicleCreate", label: "新增车辆" },
  { value: "vehicleUpdate", label: "车辆编辑" },
  { value: "vehicleUpdateStatus", label: "车辆状态" },
  { value: "vehicleRetire", label: "车辆停用" },
  { value: "vehicleRestore", label: "车辆恢复" },
  { value: "vehicleDelete", label: "删除车辆" },
  { value: "vehicleImageUpdate", label: "车辆图片" },
  { value: "bookingCreate", label: "预约创建" },
  { value: "bookingCancel", label: "预约取消" },
  { value: "bookingExportCsv", label: "预约导出" },
  { value: "bookingUpdateStatus", label: "预约状态" },
  { value: "bookingUpdateAdminRemark", label: "预约备注" },
  { value: "bookingUpdateCoordination", label: "档期协调" },
  { value: "bookingUpdateMyContact", label: "用户修改联系信息" },
  { value: "privacyRequestCreate", label: "隐私申请" },
  { value: "privacyRequestCancel", label: "隐私撤回" },
  { value: "privacyRequestUpdateStatus", label: "隐私处理" },
  { value: "privacyRequestDataInventory", label: "隐私数据核验" },
  { value: "privacyRequestDataExportCsv", label: "隐私数据导出" },
  { value: "logExportCsv", label: "日志导出" },
  { value: "analyticsCleanup", label: "匿名数据清理" }
]
const ACTION_LABEL_MAP = ACTION_OPTIONS.reduce((map, item) => {
  map[item.value] = item.label
  return map
}, {})
const PRIORITY_LABEL_MAP = {
  priority: "优先",
  normal: "常规",
  standby: "候补"
}
const COORDINATION_LABEL_MAP = {
  pending: "待协调",
  coordinating: "协调中",
  resolved: "已协调"
}
function buildAuditView(action) {
  const value = String(action || "")
  const eventLabel = ACTION_LABEL_MAP[value] || "其他操作"
  if (value === "bootstrapAdmin" || value === "roleUpsert") {
    return {
      eventLabel,
      eventGroup: "权限安全",
      eventClass: "audit-event-access",
      eventIconClass: "audit-event-icon-access"
    }
  }
  if (value.startsWith("vehicle")) {
    return {
      eventLabel,
      eventGroup: "车辆管理",
      eventClass: "audit-event-vehicle",
      eventIconClass: "audit-event-icon-vehicle"
    }
  }
  if (value.startsWith("booking")) {
    return {
      eventLabel,
      eventGroup: "预约服务",
      eventClass: "audit-event-booking",
      eventIconClass: "audit-event-icon-booking"
    }
  }
  if (value.startsWith("privacyRequest")) {
    return {
      eventLabel,
      eventGroup: "隐私服务",
      eventClass: "audit-event-privacy",
      eventIconClass: "audit-event-icon-privacy"
    }
  }
  return {
    eventLabel,
    eventGroup: "系统运营",
    eventClass: "audit-event-operation",
    eventIconClass: "audit-event-icon-operation"
  }
}
function buildSummaryRows(summary) {
  return String(summary || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const separatorIndex = line.indexOf("：")
      if (separatorIndex < 0) {
        return {
          label: "详情",
          value: line
        }
      }
      return {
        label: line.slice(0, separatorIndex),
        value: line.slice(separatorIndex + 1) || "—"
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
function buildSummary(item) {
  const action = item.action || ""
  if (action === "roleUpsert") {
    return `目标：${item.targetOpenid || "—"}\n权限：${Array.isArray(item.toPermissions) ? item.toPermissions.join(", ") : "—"}`
  }
  if (action === "bootstrapAdmin") {
    return `目标：${item.targetOpenid || "—"}\n口令保护：${item.tokenProtected ? "已开启" : "未开启"}`
  }
  if (action === "operationConfigUpdate") {
    return `变更字段：${Array.isArray(item.changedKeys) ? item.changedKeys.join(", ") : "—"}`
  }
  if (action === "vehicleCreate") {
    return `车辆：${item.vehicleId || "—"}\n车型：${item.brandModel || "—"}`
  }
  if (action === "vehicleUpdate") {
    return `车辆：${item.vehicleId || "—"}\n变更字段：${Array.isArray(item.changedKeys) ? item.changedKeys.join(", ") : "—"}`
  }
  if (action === "vehicleUpdateStatus") {
    return `车辆：${item.vehicleId || "—"}\n状态：${item.fromStatus || "—"} → ${item.toStatus || "—"}`
  }
  if (action === "vehicleRetire" || action === "vehicleRestore") {
    return `车辆：${item.vehicleId || "—"}\n状态：${item.fromStatus || "—"} → ${item.toStatus || "—"}`
  }
  if (action === "bookingCreate") {
    return `预约：${item.bookingId || "—"}\n车辆：${item.vehicleId || "—"}`
  }
  if (action === "bookingCancel") {
    return `预约：${item.bookingId || "—"}\n状态：${item.fromStatus || "—"} → ${item.toStatus || "—"}`
  }
  if (action === "bookingUpdateStatus") {
    return `预约：${item.bookingId || "—"}\n状态：${item.fromStatus || "—"} → ${item.toStatus || "—"}`
  }
  if (action === "bookingUpdateAdminRemark") {
    return `预约：${item.bookingId || "—"}\n备注长度：${item.remarkLength || 0}`
  }
  if (action === "bookingUpdateCoordination") {
    return `预约：${item.bookingId || "—"}\n优先级：${PRIORITY_LABEL_MAP[item.fromPriority] || "—"} → ${PRIORITY_LABEL_MAP[item.toPriority] || "—"}\n协调状态：${COORDINATION_LABEL_MAP[item.fromCoordinationStatus] || "—"} → ${COORDINATION_LABEL_MAP[item.toCoordinationStatus] || "—"}`
  }
  if (action === "bookingUpdateMyContact") {
    return `预约：${item.bookingId || "—"}\n变更字段：${Array.isArray(item.changedKeys) ? item.changedKeys.join(", ") : "—"}`
  }
  if (action === "bookingExportCsv") {
    return `预约状态：${item.status || "全部"}\n优先级：${PRIORITY_LABEL_MAP[item.schedulePriority] || "全部"}\n协调进度：${COORDINATION_LABEL_MAP[item.coordinationStatus] || "全部"}\n导出条数：${item.total || 0}`
  }
  if (action === "vehicleDelete") {
    return `车辆：${item.vehicleId || "—"}`
  }
  if (action === "vehicleImageUpdate") {
    return `车辆：${item.vehicleId || "—"}\n操作：${item.imageAction || "—"}`
  }
  if (action === "privacyRequestCreate") {
    return `申请：${item.requestId || "—"}\n类型：${item.requestType || "—"}`
  }
  if (action === "privacyRequestCancel") {
    return `申请：${item.requestId || "—"}\n类型：${item.requestType || "—"}\n状态：${item.fromStatus || "—"} → ${item.toStatus || "—"}`
  }
  if (action === "privacyRequestUpdateStatus") {
    return `申请：${item.requestId || "—"}\n类型：${item.requestType || "—"}\n状态：${item.fromStatus || "—"} → ${item.toStatus || "—"}`
  }
  if (
    action === "privacyRequestDataInventory" ||
    action === "privacyRequestDataExportCsv"
  ) {
    const resultLabel =
      action === "privacyRequestDataExportCsv"
        ? "CSV 已生成"
        : item.partial
          ? "部分可用"
          : "完整"
    return `申请：${item.requestId || "—"}\n类型：${item.requestType || "—"}\n预约：${item.bookingCount || 0}\n收藏：${item.favoriteCount || 0}\n隐私申请：${item.privacyRequestCount || 0}\n结果：${resultLabel}`
  }
  if (action === "analyticsCleanup") {
    return `保留周期：${item.retentionDays || 90} 天\n处理：${item.processed || 0}\n删除：${item.deleted || 0}\n失败：${item.failed || 0}`
  }
  if (action === "logExportCsv") {
    return `日志类型：${item.logType === "error" ? "错误日志" : "审计日志"}\n筛选：${item.filter || "全部"}\n导出：${item.total || 0} / ${item.matchedTotal || 0}\n结果：${item.truncated ? "已截断" : "完整"}`
  }
  return ""
}
Page({
  data: {
    initialLoading: true,
    loading: false,
    exporting: false,
    pageAuthorized: false,
    keyword: "",
    currentAction: "all",
    currentActionLabel: "全部操作",
    actionOptions: ACTION_OPTIONS,
    page: 0,
    pageSize: 20,
    hasMore: false,
    total: 0,
    truncated: false,
    list: [],
    exportFilePath: "",
    exportFileName: "",
    canShareExport: true,
    emptyTitle: "暂无审计日志",
    emptyDesc: "可在此查看权限分配与运营配置变更等关键操作记录"
  },
  onLoad() {
    activatePageCsvFileActions(this)
    this.setData({
      canShareExport: canShareCsvFile()
    })
    requirePagePermission(this, {
      required: "canViewAuditLogs",
      noPermissionMessage: "无权访问审计日志",
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
    this._auditListRequestId = Number(this._auditListRequestId || 0) + 1
    this._exportRequestSerial = Number(this._exportRequestSerial || 0) + 1
    this.finishAuditListRequestEffects()
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
    const listRequestId = Number(this._auditListRequestId || 0)
    this.setData({ keyword: "" }, () => {
      if (listRequestId !== Number(this._auditListRequestId || 0)) {
        return
      }
      this.fetchList()
    })
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
      currentAction: action,
      currentActionLabel: action === "all" ? "全部操作" : ACTION_LABEL_MAP[action] || "其他操作"
    })
    this.fetchList()
  },
  handleResetFilters() {
    if (!this.data.keyword && this.data.currentAction === "all") {
      return
    }
    const listRequestId = Number(this._auditListRequestId || 0)
    this.setData({
      keyword: "",
      currentAction: "all",
      currentActionLabel: "全部操作"
    }, () => {
      if (listRequestId !== Number(this._auditListRequestId || 0)) {
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
    const filter = this.data.currentAction === "all" ? "" : this.data.currentAction
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
    }, AUDIT_EXPORT_TIMEOUT_MS)
    const requestOptions = {
      name: "logExportCsv",
      data: {
        logType: "audit",
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
            fallbackFileName: "audit-logs.csv",
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
      content: "将从当前设备删除这份导出文件，删除后无法恢复。云端审计日志不会受到影响。",
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
    const action = this.data.currentAction === "all" ? "" : this.data.currentAction
    const keyword = String(this.data.keyword || "")
    const requestId = Number(this._auditListRequestId || 0) + 1
    this._auditListRequestId = requestId
    this.finishAuditListRequestEffects()
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
    this._auditListRequestDone = typeof done === "function" ? done : null
    this.setData({
      loading: true
    })
    let settled = false
    const finishRequest = () => {
      if (settled || this._auditListRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishAuditListRequestEffects()
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
    this._auditListRequestTimer = setTimeout(() => {
      handleFailure("加载超时，请重试")
    }, AUDIT_LIST_TIMEOUT_MS)
    const requestOptions = {
      name: "auditLogList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize,
        action,
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
                ...buildAuditView(item.action),
                createdAtText: formatDisplayTime(item.createdAt),
                summary,
                summaryRows: buildSummaryRows(summary)
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
  finishAuditListRequestEffects() {
    if (this._auditListRequestTimer) {
      clearTimeout(this._auditListRequestTimer)
      this._auditListRequestTimer = null
    }
    const done = this._auditListRequestDone
    this._auditListRequestDone = null
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
