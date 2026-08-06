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
const INVENTORY_LOAD_TIMEOUT_MS = 15 * 1000
const INVENTORY_EXPORT_TIMEOUT_MS = 20 * 1000

const REQUEST_TYPE_LABELS = {
  access: "查询信息",
  correction: "更正信息",
  deletion: "删除信息"
}

const REQUEST_STATUS_LABELS = {
  pending: "待处理",
  processing: "处理中",
  completed: "已完成",
  rejected: "未通过",
  cancelled: "已撤回"
}

const REQUEST_TYPE_META = {
  access: {
    className: "request-type-access",
    iconClass: "request-type-icon-access"
  },
  correction: {
    className: "request-type-correction",
    iconClass: "request-type-icon-correction"
  },
  deletion: {
    className: "request-type-deletion",
    iconClass: "request-type-icon-deletion"
  }
}

const REQUEST_STATUS_CLASS = {
  pending: "request-status-pending",
  processing: "request-status-processing",
  completed: "request-status-completed",
  rejected: "request-status-rejected",
  cancelled: "request-status-cancelled"
}

const BOOKING_STATUS_LABELS = {
  pending: "待联系",
  contacted: "已联系",
  completed: "已完成",
  cancelled: "已取消"
}

function formatDisplayTime(value) {
  if (!value) {
    return "—"
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "—"
  }
  const pad = (number) => String(number).padStart(2, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

function normalizeCategory(category, mapper) {
  const source = category && typeof category === "object" ? category : {}
  const list = Array.isArray(source.list) ? source.list.map(mapper) : []
  return {
    count: Number(source.count) || 0,
    truncated: Boolean(source.truncated),
    list
  }
}

function decorateCategory(key, category, unavailable, truncated, iconClass) {
  const isUnavailable = unavailable.includes(key)
  const isTruncated = truncated.includes(key) || Boolean(category.truncated)
  return {
    ...category,
    iconClass,
    isUnavailable,
    isTruncated,
    isComplete: !isUnavailable && !isTruncated,
    stateLabel: isUnavailable ? "暂不可用" : isTruncated ? "展示受限" : "核验完整",
    stateClass: isUnavailable
      ? "metric-state-unavailable"
      : isTruncated
        ? "metric-state-truncated"
        : "metric-state-complete"
  }
}

function buildViewData(result) {
  const request = result && result.request ? result.request : {}
  const categories = result && result.categories ? result.categories : {}
  const unavailable = Array.isArray(result && result.unavailable) ? result.unavailable : []
  const truncated = Array.isArray(result && result.truncated) ? result.truncated : []
  const unavailableLabels = {
    bookings: "预约数据",
    favorites: "收藏数据",
    privacyRequests: "隐私申请"
  }
  const bookings = decorateCategory(
    "bookings",
    normalizeCategory(categories.bookings, (item) => ({
      ...item,
      statusLabel: BOOKING_STATUS_LABELS[item.status] || "状态未知",
      createdAtText: formatDisplayTime(item.createdAt),
      dateText:
        item.startDate && item.endDate
          ? `${item.startDate} 至 ${item.endDate}`
          : item.startDate || item.endDate || "—"
    })),
    unavailable,
    truncated,
    "metric-native-icon-booking"
  )
  const favorites = decorateCategory(
    "favorites",
    normalizeCategory(categories.favorites, (item) => ({
      ...item,
      createdAtText: formatDisplayTime(item.createdAt)
    })),
    unavailable,
    truncated,
    "metric-native-icon-favorite"
  )
  const privacyRequests = decorateCategory(
    "privacyRequests",
    normalizeCategory(categories.privacyRequests, (item) => ({
      ...item,
      typeLabel: REQUEST_TYPE_LABELS[item.type] || "隐私申请",
      statusLabel: REQUEST_STATUS_LABELS[item.status] || "状态未知",
      createdAtText: formatDisplayTime(item.createdAt)
    })),
    unavailable,
    truncated,
    "metric-native-icon-privacy"
  )
  const categoryList = [bookings, favorites, privacyRequests]
  const verifiedCategoryCount = categoryList.filter((item) => item.isComplete).length
  const totalRecordCount = categoryList.reduce((total, item) => total + item.count, 0)
  const requestTypeMeta = REQUEST_TYPE_META[request.type] || {
    className: "request-type-default",
    iconClass: "request-type-icon-default"
  }

  return {
    partial: Boolean(result && result.partial),
    verifiedCategoryCount,
    inventoryProgress: Math.round((verifiedCategoryCount / categoryList.length) * 100),
    inventoryStatusLabel: verifiedCategoryCount === categoryList.length ? "核验完整" : "需要继续核验",
    inventoryStatusClass:
      verifiedCategoryCount === categoryList.length ? "inventory-status-complete" : "inventory-status-partial",
    totalRecordCount,
    unavailable,
    truncated,
    unavailableText: unavailable
      .map((item) => unavailableLabels[item] || item)
      .join("、"),
    issueText: [
      unavailable.length
        ? `${unavailable.map((item) => unavailableLabels[item] || item).join("、")}暂不可用`
        : "",
      truncated.length
        ? `${truncated.map((item) => unavailableLabels[item] || item).join("、")}超过单类 200 条展示上限`
        : ""
    ]
      .filter(Boolean)
      .join("；"),
    request: {
      ...request,
      typeLabel: REQUEST_TYPE_LABELS[request.type] || "隐私申请",
      statusLabel: REQUEST_STATUS_LABELS[request.status] || "状态未知",
      typeClass: requestTypeMeta.className,
      typeIconClass: requestTypeMeta.iconClass,
      statusClass: REQUEST_STATUS_CLASS[request.status] || "request-status-unknown",
      createdAtText: formatDisplayTime(request.createdAt)
    },
    bookings,
    favorites,
    privacyRequests
  }
}

Page({
  data: {
    pageAuthorized: false,
    requestId: "",
    loading: true,
    refreshing: false,
    loadError: "",
    exporting: false,
    exportFilePath: "",
    exportFileName: "",
    canShareExport: true,
    partial: false,
    unavailable: [],
    truncated: [],
    unavailableText: "",
    issueText: "",
    verifiedCategoryCount: 0,
    inventoryProgress: 0,
    inventoryStatusLabel: "等待核验",
    inventoryStatusClass: "inventory-status-pending",
    totalRecordCount: 0,
    request: {},
    bookings: { count: 0, truncated: false, list: [] },
    favorites: { count: 0, truncated: false, list: [] },
    privacyRequests: { count: 0, truncated: false, list: [] }
  },

  onLoad(options) {
    const requestId = String((options && options.id) || "").trim()
    this.setData({
      requestId,
      canShareExport: canShareCsvFile()
    })
    requirePagePermission(this, {
      required: "canManageRoles",
      noPermissionMessage: "无权核验隐私申请数据",
      onAuthorized: () => {
        if (!requestId) {
          this.setData({
            loading: false,
            loadError: "缺少隐私申请 ID"
          })
          return
        }
        this.loadInventory()
      }
    })
  },

  onUnload() {
    this._inventoryRequestId = Number(this._inventoryRequestId || 0) + 1
    this._exportRequestSerial = Number(this._exportRequestSerial || 0) + 1
    this.finishInventoryRequestEffects()
    this.clearExportRequestTimer()
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized || !this.data.requestId) {
      wx.stopPullDownRefresh()
      return
    }
    this.loadInventory({
      refreshing: true,
      done: () => wx.stopPullDownRefresh()
    })
  },

  handleRefresh() {
    if (!this.data.loading && !this.data.refreshing && this.data.requestId) {
      this.loadInventory({ refreshing: true })
    }
  },

  handleCopyOpenid() {
    const openid = String(this.data.request.openid || "")
    if (!openid) {
      wx.showToast({
        title: "申请账号不可用",
        icon: "none"
      })
      return
    }
    wx.setClipboardData({
      data: openid,
      success: () => {
        wx.showToast({
          title: "申请账号已复制",
          icon: "none"
        })
      },
      fail: () => {
        wx.showToast({
          title: "申请账号复制失败",
          icon: "none"
        })
      }
    })
  },

  handleBookingTap(event) {
    const id = String(event.currentTarget.dataset.id || "")
    if (!id) {
      return
    }
    wx.navigateTo({
      url: `/pages/booking-manage-detail/booking-manage-detail?id=${encodeURIComponent(id)}`,
      fail: () => {
        wx.showToast({
          title: "预约详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleExport() {
    if (this.data.loading || this.data.refreshing || this.data.exporting) {
      return
    }
    if (this.data.request.type !== "access") {
      wx.showToast({
        title: "仅查询信息申请可导出",
        icon: "none"
      })
      return
    }
    if (this.data.partial) {
      wx.showToast({
        title: "数据未就绪",
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

    wx.showModal({
      title: "导出个人数据",
      content: "文件包含用户 OpenID、姓名、手机号和申请内容，请仅用于本次隐私申请并妥善保管。",
      confirmText: "确认导出",
      confirmColor: "#528fff",
      success: (modalResult) => {
        if (!modalResult.confirm) {
          return
        }
        const inventoryRequestId = String(this.data.requestId || "").trim()
        const exportSerial = Number(this._exportRequestSerial || 0) + 1
        this._exportRequestSerial = exportSerial
        this.clearExportRequestTimer()
        this.setData({ exporting: true })

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
        }, INVENTORY_EXPORT_TIMEOUT_MS)

        const requestOptions = {
          name: "privacyRequestDataInventory",
          data: {
            requestId: inventoryRequestId,
            mode: "export"
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
            saveCsvFile({
              fileName: result.fileName,
              fallbackFileName: `privacy-data-${inventoryRequestId}.csv`,
              csvText: result.csvText
            })
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
                wx.showToast({
                title: "个人数据已生成",
                  icon: "none"
                })
              })
              .catch((error) => {
                handleFailure(error && (error.errMsg || error.message), "保存失败")
              })
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
      title: "删除本地个人数据",
      content: "将从当前设备删除这份 CSV，删除后无法恢复。云端用户数据和隐私申请不会受到影响。",
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

  loadInventory(options) {
    const input = options && typeof options === "object" ? options : {}
    const requestId = Number(this._inventoryRequestId || 0) + 1
    this._inventoryRequestId = requestId
    this.finishInventoryRequestEffects()
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        refreshing: false,
        loadError: "云能力未初始化"
      })
      if (typeof input.done === "function") {
        input.done()
      }
      return
    }

    this._inventoryRequestDone = typeof input.done === "function" ? input.done : null
    this.setData({
      loading: !input.refreshing,
      refreshing: Boolean(input.refreshing),
      loadError: ""
    })

    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._inventoryRequestId) {
        return false
      }
      settled = true
      this.finishInventoryRequestEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        loading: false,
        refreshing: false,
        loadError: String(message || "相关数据核验失败，请稍后重试")
      })
    }

    this._inventoryRequestTimer = setTimeout(() => {
      handleFailure("相关数据核验超时，请检查网络后重试")
    }, INVENTORY_LOAD_TIMEOUT_MS)

    const inventoryRequestId = String(this.data.requestId || "").trim()
    const requestOptions = {
      name: "privacyRequestDataInventory",
      data: {
        requestId: inventoryRequestId
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            loading: false,
            refreshing: false,
            loadError: (result && result.message) || "相关数据核验失败，请稍后重试"
          })
          return
        }
        this.setData({
          loading: false,
          refreshing: false,
          loadError: "",
          ...buildViewData(result)
        })
      },
      fail: (error) => {
        handleFailure((error && (error.errMsg || error.message)) || "相关数据核验失败，请稍后重试")
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure((error && (error.errMsg || error.message)) || "相关数据核验失败，请稍后重试")
    }
  },

  finishInventoryRequestEffects() {
    if (this._inventoryRequestTimer) {
      clearTimeout(this._inventoryRequestTimer)
      this._inventoryRequestTimer = null
    }
    const done = this._inventoryRequestDone
    this._inventoryRequestDone = null
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
