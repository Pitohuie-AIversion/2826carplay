const { cancelPagePermissionCheck, requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
const MAX_IMAGE_COUNT = 9
const ALLOWED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"])
const MAX_UPLOAD_RETRY_COUNT = 1
const CLOUD_UPLOAD_TIMEOUT_MS = 20 * 1000
const IMAGE_CHANGE_TIMEOUT_MS = 15 * 1000
const DETAIL_LOAD_TIMEOUT_MS = 15 * 1000
const STATUS_ACTION_TIMEOUT_MS = 20 * 1000

const STATUS_LABEL_MAP = {
  active: "在用",
  idle: "闲置",
  maintenance: "维修",
  retired: "停用"
}

const STATUS_CLASS_MAP = {
  active: "status-active",
  idle: "status-idle",
  maintenance: "status-maintenance",
  retired: "status-retired"
}

const STATUS_OP_OPTIONS = [
  { value: "idle", label: "设为闲置" },
  { value: "active", label: "设为在用" },
  { value: "maintenance", label: "设为维修" }
]

const VEHICLE_TYPE_LABEL_MAP = {
  sedan: "轿车",
  suv: "SUV",
  mpv: "MPV",
  sports: "跑车",
  truck: "卡车",
  other: "其他"
}

const TRANSMISSION_LABEL_MAP = {
  manual: "手动挡",
  automatic: "自动挡"
}

const FUEL_TYPE_LABEL_MAP = {
  gasoline: "燃油",
  electric: "纯电",
  hybrid: "混动"
}

function formatDisplayTime(value) {
  if (!value) {
    return "—"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "—"
  }

  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  const hour = `${date.getHours()}`.padStart(2, "0")
  const minute = `${date.getMinutes()}`.padStart(2, "0")
  return `${year}-${month}-${day} ${hour}:${minute}`
}

function buildImageItems(detail) {
  const imageList = Array.isArray(detail.imageList) ? detail.imageList : []
  const coverImage = detail.coverImage || ""

  return imageList.map((fileId) => ({
    fileId,
    isCover: fileId === coverImage,
    imageFailed: false
  }))
}

function formatDetail(detail) {
  const imageList = Array.isArray(detail.imageList) ? detail.imageList.filter(Boolean) : []
  const coverImage =
    detail.coverImage && imageList.includes(detail.coverImage) ? detail.coverImage : imageList[0] || ""
  const archiveHealth = detail.archiveHealth && typeof detail.archiveHealth === "object"
    ? detail.archiveHealth
    : { status: "missing", statusText: "资料缺失", missingCount: 6, freshnessDays: null }

  return {
    ...detail,
    imageList,
    coverImage,
    imageCount: imageList.length,
    imageItems: buildImageItems({ imageList, coverImage }),
    statusText: STATUS_LABEL_MAP[detail.status] || detail.status || "未知",
    statusClass: STATUS_CLASS_MAP[detail.status] || "status-idle",
    vehicleTypeText: VEHICLE_TYPE_LABEL_MAP[detail.vehicleType] || detail.vehicleType || "未知",
    transmissionText: TRANSMISSION_LABEL_MAP[detail.transmission] || detail.transmission || "—",
    fuelTypeText: FUEL_TYPE_LABEL_MAP[detail.fuelType] || detail.fuelType || "—",
    seatsText: detail.seats ? `${detail.seats} 座` : "—",
    locationText: detail.location || "—",
    priceDayText: detail.priceDay || detail.priceDay === 0 ? `￥${detail.priceDay} / 24小时` : "—",
    createdAtText: formatDisplayTime(detail.createdAt),
    updatedAtText: formatDisplayTime(detail.updatedAt),
    vinText: detail.vin || "—",
    engineNumberText: detail.engineNumber || "—",
    publicDescriptionText: detail.publicDescription || "—",
    noteText: detail.note || "—",
    archiveHealth: {
      ...archiveHealth,
      statusClass: `archive-health-${archiveHealth.status || "missing"}`,
      freshnessText: Number.isInteger(archiveHealth.freshnessDays)
        ? `${archiveHealth.freshnessDays} 天前更新`
        : "暂无有效更新日期"
    },
    publicMaterialsUpdatedDateText: detail.publicMaterialsUpdatedDate || "待补充",
    publicInspectionDateText: detail.publicInspectionDate || "待补充",
    publicInspectionSummaryText: detail.publicInspectionSummary || "待补充",
    publicExteriorSummaryText: detail.publicExteriorSummary || "待补充",
    publicInsuranceSummaryText: detail.publicInsuranceSummary || "待补充",
    publicAssistanceSummaryText: detail.publicAssistanceSummary || "待补充",
    publicArchiveReviewStatusText: detail.publicArchiveReviewStatus === "reviewed" ? "已复核" : "待复核",
    internalMaintenanceRecordText: detail.internalMaintenanceRecord || "—",
    internalInspectionRecordText: detail.internalInspectionRecord || "—",
    internalInsuranceRecordText: detail.internalInsuranceRecord || "—",
    internalArchiveNoteText: detail.internalArchiveNote || "—",
    createdByOpenidText: detail.createdByOpenid || "—"
  }
}

function getFileExtension(filePath) {
  const match = String(filePath || "").match(/\.([a-zA-Z0-9]+)(\?|$)/)
  const extension = match && match[1] ? match[1].toLowerCase() : "jpg"
  return ALLOWED_IMAGE_EXTENSIONS.has(extension) ? extension : ""
}

function isUserCancelError(error) {
  const message = error && (error.errMsg || error.message || error)
  return String(message || "").toLowerCase().includes("cancel")
}

function getCloudUploadErrorTitle(error) {
  const message = String(
    error && (error.errMsg || error.message || error.errCode || error)
      ? error.errMsg || error.message || error.errCode || error
      : ""
  ).toLowerCase()

  if (/permission|unauthori[sz]ed|forbidden|auth/.test(message)) {
    return "无图片上传权限"
  }
  if (/quota|capacity|storage.*(full|limit)|space.*(full|limit)/.test(message)) {
    return "云存储空间不足"
  }
  if (/timeout|network|request:fail|socket|connection/.test(message)) {
    return "网络异常，请重试"
  }
  if (/no such file|not found|file.*missing/.test(message)) {
    return "所选图片已失效"
  }
  if (/mime|buffer.*null|file type/.test(message)) {
    return "图片格式无法识别"
  }
  return "图片上传失败"
}

function shouldRetryCloudUpload(error, retryCount) {
  if (Number(retryCount) >= MAX_UPLOAD_RETRY_COUNT) {
    return false
  }
  const message = String(
    error && (error.errMsg || error.message || error.errCode || error)
      ? error.errMsg || error.message || error.errCode || error
      : ""
  ).toLowerCase()
  return /timeout|network|request:fail|socket|connection/.test(message)
}

function normalizeChosenImages(chooseRes) {
  const input = chooseRes && typeof chooseRes === "object" ? chooseRes : {}
  const tempFiles = Array.isArray(input.tempFiles) ? input.tempFiles : []
  const fallbackPaths = Array.isArray(input.tempFilePaths) ? input.tempFilePaths : []
  const candidates = tempFiles.length
    ? tempFiles.map((item) => ({
        path: String((item && item.path) || "").trim(),
        size: Number(item && item.size)
      }))
    : fallbackPaths.map((path) => ({ path: String(path || "").trim(), size: 0 }))
  const filePaths = []
  let rejectedCount = 0

  candidates.forEach((item) => {
    const validSize =
      !Number.isFinite(item.size) ||
      (item.size >= 0 && item.size <= MAX_IMAGE_UPLOAD_BYTES)
    if (!item.path || !getFileExtension(item.path) || !validSize) {
      rejectedCount += 1
      return
    }
    if (!filePaths.includes(item.path)) {
      filePaths.push(item.path)
    }
  })

  return { filePaths, rejectedCount }
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) {
    return []
  }

  const result = []
  input.forEach((item) => {
    const value = String(item || "").trim()
    if (value && !result.includes(value)) {
      result.push(value)
    }
  })
  return result
}

function deleteCloudFilesDirectBestEffort(fileList) {
  const list = normalizeStringArray(fileList)
  if (!list.length) {
    return
  }

  if (!wx.cloud || typeof wx.cloud.deleteFile !== "function") {
    return
  }

  try {
    wx.cloud.deleteFile({
      fileList: list,
      fail: () => {}
    })
  } catch (error) {}
}

function requestUploadedFileCleanup(vehicleId, fileList) {
  const id = String(vehicleId || "").trim()
  const list = normalizeStringArray(fileList)
  if (!id || !list.length) {
    return
  }

  if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
    return
  }

  try {
    wx.cloud.callFunction({
      name: "vehicleImageUpdate",
      data: {
        id,
        action: "cleanupUpload",
        fileIds: list
      },
      fail: () => {}
    })
  } catch (error) {}
}

Page({
  data: {
    id: "",
    loading: true,
    uploading: false,
    uploadItems: [],
    uploadProgressText: "",
    failedUploadPaths: [],
    updatingStatus: false,
    pageAuthorized: false,
    statusOpOptions: STATUS_OP_OPTIONS,
    detail: null
  },

  onLoad(options) {
    activatePageNativeActions(this)
    this._vehicleDetailUnloaded = false
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

    const id = String((options && options.id) || "").trim()
    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      this.setData({
        loading: false
      })
      return
    }

    this.setData({ id })
    requirePagePermission(this, {
      required: "canManageVehicles",
      noPermissionMessage: "无权访问车辆详情管理",
      onAuthorized: () => {
        this.fetchDetail(id)
      }
    })
  },

  onUnload() {
    cancelPagePermissionCheck(this)
    cancelPageNativeActions(this)
    this._vehicleDetailUnloaded = true
    this._vehicleDetailLoadRequestId =
      Number(this._vehicleDetailLoadRequestId || 0) + 1
    this._vehicleStatusRequestId = Number(this._vehicleStatusRequestId || 0) + 1
    this._vehicleImageChangeRequestId =
      Number(this._vehicleImageChangeRequestId || 0) + 1
    this._vehicleUploadSessionId = Number(this._vehicleUploadSessionId || 0) + 1
    this.clearVehicleDetailLoadTimer()
    this.clearVehicleStatusTimer()
    this.clearVehicleImageChangeTimer()
    this.finishVehicleDetailLoadDone()
    this._imageChangePending = false
    if (this._pendingImageCleanupFileIds && this._pendingImageCleanupFileIds.length) {
      requestUploadedFileCleanup(
        this._pendingImageVehicleId,
        this._pendingImageCleanupFileIds
      )
    }
    this._pendingImageCleanupFileIds = []
    this._pendingImageVehicleId = ""
    this._uploadCancelled = true
    const activeUploadTask = this._activeUploadTask
    const cancelActiveUpload = this._cancelActiveUpload
    if (activeUploadTask && typeof activeUploadTask.abort === "function") {
      try {
        activeUploadTask.abort()
      } catch (error) {}
    }
    if (typeof cancelActiveUpload === "function") {
      cancelActiveUpload()
    }
    this._activeUploadTask = null
    this._cancelActiveUpload = null
    if (typeof wx.hideLoading === "function") {
      wx.hideLoading()
    }
  },

  onPullDownRefresh() {
    if (!this.data.pageAuthorized || this.isVehicleDetailInteractionBusy()) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchDetail(this.data.id, () => {
      wx.stopPullDownRefresh()
    })
  },

  fetchDetail(id, done) {
    if (!this.isVehicleDetailActive()) {
      if (typeof done === "function") {
        done()
      }
      return
    }
    if (this.isVehicleDetailMutationBusy()) {
      if (typeof done === "function") {
        done()
      }
      return
    }
    const vehicleId = String(id || "").trim()
    this.finishVehicleDetailLoadDone()
    const requestId = Number(this._vehicleDetailLoadRequestId || 0) + 1
    this._vehicleDetailLoadRequestId = requestId
    this._vehicleDetailLoadDone = typeof done === "function" ? done : null
    this.clearVehicleDetailLoadTimer()
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      this.setData({
        loading: false
      })
      this.finishVehicleDetailLoadDone()
      return
    }

    this.setData({
      loading: true
    })

    let settled = false
    const finishRequest = () => {
      if (
        settled ||
        this._vehicleDetailLoadRequestId !== requestId ||
        !this.isVehicleDetailActive()
      ) {
        return false
      }
      settled = true
      this.clearVehicleDetailLoadTimer()
      this.finishVehicleDetailLoadDone()
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
      this.setData({ loading: false })
    }

    this._vehicleDetailLoadTimer = setTimeout(() => {
      handleFailure("档案加载超时，请重试")
    }, DETAIL_LOAD_TIMEOUT_MS)

    const requestOptions = {
      name: "vehicleDetail",
      data: { id: vehicleId },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.detail) {
          wx.showToast({
            title: formatToastTitle(result && result.message, "加载失败"),
            icon: "none"
          })
          this.setData({
            loading: false
          })
          return
        }

        const detail = result.detail
        this.setData({
          loading: false,
          detail: formatDetail(detail)
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
  },

  handleEdit() {
    if (this.isVehicleDetailInteractionBusy() || !this.data.id) {
      return
    }

    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages-admin/vehicle-edit/vehicle-edit?id=${this.data.id}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "编辑页面打开失败",
          icon: "none"
        })
      }
    })
  },

  handleUpdateStatus(event) {
    if (this.isVehicleDetailInteractionBusy()) {
      return
    }

    const status = String(event.currentTarget.dataset.status || "").trim()
    const detail = this.data.detail || {}
    const id = this.data.id
    const currentStatus = String(detail.status || "").trim()
    const plateNumber = String(detail.plateNumber || "").trim()

    if (!id || !status) {
      return
    }

    if (status === currentStatus) {
      return
    }

    const statusText = STATUS_LABEL_MAP[status] || status

    const action = beginPageNativeAction(this, {
      exclusiveKey: "vehicle-write-confirmation"
    })
    wx.showModal({
      title: "更新状态",
      content: `确认将车辆 ${plateNumber || id} 状态更新为「${statusText}」？`,
      confirmText: "确认更新",
      confirmColor: "#528fff",
      success: (modalRes) => {
        if (
          !isPageNativeActionActive(this, action) ||
          !modalRes.confirm ||
          !this.isVehicleDetailActive() ||
          this.isVehicleDetailInteractionBusy()
        ) {
          return
        }

        this.updateVehicleStatus(id, status)
      }
    })
  },

  handleRetire() {
    const detail = this.data.detail || {}
    const id = this.data.id
    const plateNumber = String(detail.plateNumber || "").trim()

    if (!id || this.isVehicleDetailInteractionBusy()) {
      return
    }

    const action = beginPageNativeAction(this, {
      exclusiveKey: "vehicle-write-confirmation"
    })
    wx.showModal({
      title: "停用车辆",
      content: `确认将车辆 ${plateNumber || id} 标记为停用？`,
      confirmText: "确认停用",
      confirmColor: "#d46868",
      success: (modalRes) => {
        if (
          !isPageNativeActionActive(this, action) ||
          !modalRes.confirm ||
          !this.isVehicleDetailActive() ||
          this.isVehicleDetailInteractionBusy()
        ) {
          return
        }

        this.retireVehicle(id)
      }
    })
  },

  handleRestore() {
    const detail = this.data.detail || {}
    const id = this.data.id
    const plateNumber = String(detail.plateNumber || "").trim()

    if (!id || this.isVehicleDetailInteractionBusy()) {
      return
    }

    const action = beginPageNativeAction(this, {
      exclusiveKey: "vehicle-write-confirmation"
    })
    wx.showModal({
      title: "恢复启用",
      content: `确认将车辆 ${plateNumber || id} 恢复为可管理状态？`,
      confirmText: "确认恢复",
      confirmColor: "#528fff",
      success: (modalRes) => {
        if (
          !isPageNativeActionActive(this, action) ||
          !modalRes.confirm ||
          !this.isVehicleDetailActive() ||
          this.isVehicleDetailInteractionBusy()
        ) {
          return
        }

        this.restoreVehicle(id)
      }
    })
  },

  updateVehicleStatus(id, status) {
    this.runVehicleStatusOperation({
      name: "vehicleUpdateStatus",
      data: { id, status },
      id,
      loadingTitle: "更新中…",
      timeoutTitle: "状态更新超时，请重试",
      failureTitle: "更新失败",
      successTitle: "状态已更新"
    })
  },

  retireVehicle(id) {
    this.runVehicleStatusOperation({
      name: "vehicleRetire",
      data: { id },
      id,
      loadingTitle: "停用中…",
      timeoutTitle: "停用超时，请重试",
      failureTitle: "停用失败",
      successTitle: "停用成功"
    })
  },

  restoreVehicle(id) {
    this.runVehicleStatusOperation({
      name: "vehicleRestore",
      data: { id },
      id,
      loadingTitle: "恢复中…",
      timeoutTitle: "恢复超时，请重试",
      failureTitle: "恢复失败",
      successTitle: "恢复成功"
    })
  },

  runVehicleStatusOperation(input) {
    if (this.isVehicleDetailInteractionBusy() || !this.isVehicleDetailActive()) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const requestId = Number(this._vehicleStatusRequestId || 0) + 1
    this._vehicleStatusRequestId = requestId
    this.clearVehicleStatusTimer()
    this.setData({
      updatingStatus: true
    })

    wx.showLoading({
      title: input.loadingTitle || "处理中…",
      mask: true
    })
    let settled = false
    const finishRequest = () => {
      if (
        settled ||
        this._vehicleStatusRequestId !== requestId ||
        !this.isVehicleDetailActive()
      ) {
        return false
      }
      settled = true
      this.clearVehicleStatusTimer()
      wx.hideLoading()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ updatingStatus: false })
      wx.showToast({
        title: formatToastTitle(message, input.failureTitle || "操作失败"),
        icon: "none"
      })
    }

    this._vehicleStatusTimer = setTimeout(() => {
      handleFailure(input.timeoutTitle || "操作超时，请重试")
    }, STATUS_ACTION_TIMEOUT_MS)

    const requestOptions = {
      name: input.name,
      data: { ...(input.data || {}) },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ updatingStatus: false })
          wx.showToast({
            title: formatToastTitle(
              result && result.message,
              input.failureTitle || "操作失败"
            ),
            icon: "none"
          })
          return
        }

        this.setData({ updatingStatus: false })
        wx.showToast({
          title: formatToastTitle(result.message, input.successTitle || "操作成功"),
          icon: "success"
        })
        this.fetchDetail(input.id)
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

  handleBackList() {
    const action = beginPageNativeAction(this)
    wx.navigateBack({
      delta: 1,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.redirectTo({
          url: "/pages-admin/vehicle-manage/vehicle-manage",
          fail: () => {
            if (!isPageNativeActionActive(this, action)) {
              return
            }
            wx.reLaunch({
              url: "/pages-admin/vehicle-manage/vehicle-manage",
              fail: () => {
                if (!isPageNativeActionActive(this, action)) {
                  return
                }
                wx.showToast({
                  title: "返回车辆管理失败",
                  icon: "none"
                })
              }
            })
          }
        })
      }
    })
  },

  handlePreviewImage(event) {
    if (this.isVehicleDetailInteractionBusy()) {
      return
    }
    const fileId = String(event.currentTarget.dataset.fileId || "").trim()
    const detail = this.data.detail
    const urls = detail && Array.isArray(detail.imageList) ? detail.imageList : []

    if (!fileId || !urls.length) {
      return
    }

    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.previewImage({
      current: fileId,
      urls,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "图片预览失败",
          icon: "none"
        })
      }
    })
  },

  handleManagedImageError(event) {
    const fileId = String(event.currentTarget.dataset.fileId || "").trim()
    const detail = this.data.detail || {}
    const imageItems = Array.isArray(detail.imageItems) ? detail.imageItems : []

    if (!fileId || !imageItems.some((item) => item.fileId === fileId)) {
      return
    }

    this.setData({
      detail: {
        ...detail,
        imageItems: imageItems.map((item) => item.fileId === fileId
          ? { ...item, imageFailed: true }
          : item)
      }
    })
  },

  handleUploadImages() {
    const detail = this.data.detail
    if (!detail || this.isVehicleDetailInteractionBusy()) {
      return
    }

    const remain = Math.max(MAX_IMAGE_COUNT - (detail.imageCount || 0), 0)
    if (remain <= 0) {
      wx.showToast({
        title: `最多上传 ${MAX_IMAGE_COUNT} 张图片`,
        icon: "none"
      })
      return
    }

    wx.chooseImage({
      count: remain,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (chooseRes) => {
        if (!this.isVehicleDetailActive()) {
          return
        }
        const selection = normalizeChosenImages(chooseRes)
        if (!selection.filePaths.length) {
          if (selection.rejectedCount) {
            wx.showToast({
              title: "仅支持10MB内图片",
              icon: "none"
            })
          }
          return
        }

        this.uploadSelectedFiles(selection.filePaths, selection.rejectedCount)
      },
      fail: (error) => {
        if (!this.isVehicleDetailActive()) {
          return
        }
        if (isUserCancelError(error)) {
          return
        }
        wx.showToast({
          title: "选择图片失败，请重试",
          icon: "none"
        })
      }
    })
  },

  uploadSelectedFiles(filePaths, skippedCount) {
    if (
      !this.isVehicleDetailActive() ||
      this.isVehicleDetailInteractionBusy()
    ) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.uploadFile !== "function") {
      wx.showToast({
        title: "云上传能力未初始化",
        icon: "none"
      })
      return
    }

    const selectedPaths = (Array.isArray(filePaths) ? filePaths : []).filter(Boolean)
    if (!selectedPaths.length) {
      return
    }

    const uploadedFileIds = []
    const failedFiles = []
    const vehicleId = String(this.data.id || "").trim()
    const sessionId = Number(this._vehicleUploadSessionId || 0) + 1
    this._vehicleUploadSessionId = sessionId
    this._uploadCancelled = false
    const isSameSession = () => this._vehicleUploadSessionId === sessionId
    const isUploadCurrent = () =>
      isSameSession() && this.isVehicleDetailActive()
    const uploadItems = selectedPaths.map((filePath, index) => ({
      id: `${index}-${filePath}`,
      filePath,
      name: String(filePath).split(/[\\/]/).pop() || `图片 ${index + 1}`,
      status: "pending",
      statusText: "等待上传"
    }))

    this.setData({
      uploading: true,
      uploadItems,
      uploadProgressText: `准备上传 0 / ${selectedPaths.length}`,
      failedUploadPaths: []
    })

    const updateItem = (index, status, statusText) => {
      if (!isUploadCurrent()) {
        return
      }
      const nextItems = this.data.uploadItems.slice()
      nextItems[index] = {
        ...nextItems[index],
        status,
        statusText
      }
      this.setData({
        uploadItems: nextItems,
        uploadProgressText: `已处理 ${uploadedFileIds.length + failedFiles.length} / ${selectedPaths.length}，成功 ${uploadedFileIds.length} 张`
      })
    }

    const finishBatch = () => {
      if (isSameSession()) {
        this._activeUploadTask = null
        this._cancelActiveUpload = null
      }
      if (!isUploadCurrent()) {
        requestUploadedFileCleanup(vehicleId, uploadedFileIds)
        return
      }
      const failedUploadPaths = failedFiles.map((item) => item.filePath)
      if (uploadedFileIds.length) {
        this.setData({
          uploadProgressText: `正在保存 ${uploadedFileIds.length} 张图片…`,
          failedUploadPaths
        })
        const totalSkipped = Number(skippedCount || 0) + failedUploadPaths.length
        const summary = failedUploadPaths.length
          ? { failedUploadPaths, allFilePaths: selectedPaths.slice(), uploadedCount: uploadedFileIds.length }
          : null
        const args = [
          { action: "add", fileIds: uploadedFileIds },
          uploadedFileIds,
          totalSkipped
        ]
        if (summary) {
          args.push(summary)
        }
        this.persistImageChange(...args)
        return
      }

      wx.hideLoading()
      this.setData({
        uploading: false,
        failedUploadPaths,
        uploadProgressText: this._uploadCancelled ? "上传已取消，可重试未完成图片" : "本次图片均未上传成功"
      })
      const firstError = failedFiles[0] && failedFiles[0].error
      wx.showToast({
        title: this._uploadCancelled ? "已取消上传" : getCloudUploadErrorTitle(firstError),
        icon: "none"
      })
    }

    const uploadNext = (index, retryCount = 0) => {
      if (!isUploadCurrent()) {
        finishBatch()
        return
      }
      if (index >= selectedPaths.length) {
        finishBatch()
        return
      }

      if (this._uploadCancelled) {
        for (let nextIndex = index; nextIndex < selectedPaths.length; nextIndex += 1) {
          failedFiles.push({
            filePath: selectedPaths[nextIndex],
            error: { errMsg: "uploadFile:fail cancel" }
          })
          updateItem(nextIndex, "cancelled", "已取消")
        }
        finishBatch()
        return
      }

      const filePath = selectedPaths[index]
      const extension = getFileExtension(filePath)
      const cloudPath = `vehicle-images/${vehicleId}/${Date.now()}_${index}.${extension}`
      updateItem(index, "uploading", retryCount ? "正在重试" : "上传中")

      let uploadSettled = false
      let uploadTimeoutId = null
      const settleUpload = (callback) => {
        if (uploadSettled) {
          return
        }
        uploadSettled = true
        if (isSameSession()) {
          this._activeUploadTask = null
          this._cancelActiveUpload = null
        }
        if (uploadTimeoutId) {
          clearTimeout(uploadTimeoutId)
          uploadTimeoutId = null
        }
        callback()
      }
      const handleUploadFailure = (error) => {
        settleUpload(() => {
          if (!this._uploadCancelled && shouldRetryCloudUpload(error, retryCount)) {
            uploadNext(index, retryCount + 1)
            return
          }
          failedFiles.push({ filePath, error })
          updateItem(index, this._uploadCancelled ? "cancelled" : "failed", this._uploadCancelled ? "已取消" : "上传失败")
          uploadNext(index + 1)
        })
      }

      uploadTimeoutId = setTimeout(() => {
        handleUploadFailure({ errMsg: "uploadFile:fail timeout" })
      }, CLOUD_UPLOAD_TIMEOUT_MS)
      this._cancelActiveUpload = () => {
        handleUploadFailure({ errMsg: "uploadFile:fail cancel" })
      }

      try {
        const uploadTask = wx.cloud.uploadFile({
          cloudPath,
          filePath,
          success: (uploadRes) => {
            if (!uploadRes || !uploadRes.fileID) {
              handleUploadFailure({ errMsg: "uploadFile:fail invalid response" })
              return
            }
            settleUpload(() => {
              uploadedFileIds.push(uploadRes.fileID)
              updateItem(index, "success", "上传成功")
              uploadNext(index + 1)
            })
          },
          fail: handleUploadFailure
        })
        if (!uploadSettled && isSameSession()) {
          this._activeUploadTask = uploadTask
        }
      } catch (error) {
        handleUploadFailure(error)
      }
    }

    uploadNext(0)
  },

  handleCancelUpload() {
    if (!this.data.uploading) {
      return
    }
    this._uploadCancelled = true
    this.setData({
      uploadProgressText: "正在取消上传…"
    })
    const activeUploadTask = this._activeUploadTask
    const cancelActiveUpload = this._cancelActiveUpload
    if (activeUploadTask && typeof activeUploadTask.abort === "function") {
      try {
        activeUploadTask.abort()
      } catch (error) {}
    }
    if (typeof cancelActiveUpload === "function") {
      cancelActiveUpload()
    }
  },

  handleRetryFailedUploads() {
    const filePaths = Array.isArray(this.data.failedUploadPaths) ? this.data.failedUploadPaths.slice() : []
    if (!filePaths.length || this.isVehicleDetailInteractionBusy()) {
      return
    }
    this.uploadSelectedFiles(filePaths, 0)
  },

  handleSetCover(event) {
    const fileId = String(event.currentTarget.dataset.fileId || "").trim()
    if (!fileId || this.isVehicleDetailInteractionBusy()) {
      return
    }

    this.persistImageChange({
      action: "setCover",
      fileId
    })
  },

  handleRemoveImage(event) {
    const fileId = String(event.currentTarget.dataset.fileId || "").trim()
    if (!fileId || this.isVehicleDetailInteractionBusy()) {
      return
    }

    const action = beginPageNativeAction(this, {
      exclusiveKey: "vehicle-write-confirmation"
    })
    wx.showModal({
      title: "移除图片",
      content: "确认将该图片从车辆资料中移除？",
      confirmText: "确认移除",
      confirmColor: "#d46868",
      success: (modalRes) => {
        if (
          !isPageNativeActionActive(this, action) ||
          !modalRes.confirm ||
          !this.isVehicleDetailActive() ||
          this.isVehicleDetailInteractionBusy()
        ) {
          return
        }

        this.persistImageChange({
          action: "remove",
          fileId
        })
      }
    })
  },

  persistImageChange(payload, cleanupFileIds, skippedCount, uploadSummary) {
    const actionPayload = {
      ...(payload || {})
    }
    if (Array.isArray(actionPayload.fileIds)) {
      actionPayload.fileIds = actionPayload.fileIds.slice()
    }
    const vehicleId = String(this.data.id || "").trim()
    const cleanupIds = normalizeStringArray(cleanupFileIds)
    if (!this.isVehicleDetailActive()) {
      requestUploadedFileCleanup(vehicleId, cleanupIds)
      return
    }
    if (
      !vehicleId ||
      this.data.loading ||
      this.data.updatingStatus ||
      this._imageChangePending ||
      (this.data.uploading && actionPayload.action !== "add")
    ) {
      requestUploadedFileCleanup(vehicleId, cleanupIds)
      if (actionPayload.action === "add" && this.data.uploading) {
        this.setData({ uploading: false })
      }
      return
    }
    const getRetryUploadItems = () => actionPayload.action === "add"
      ? (Array.isArray(this.data.uploadItems) ? this.data.uploadItems : []).map((item) => ({
          ...item,
          status: "failed",
          statusText: "保存失败"
        }))
      : this.data.uploadItems
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.hideLoading()
      this.setData({
        uploading: false,
        uploadItems: getRetryUploadItems(),
        failedUploadPaths: uploadSummary && uploadSummary.allFilePaths ? uploadSummary.allFilePaths : this.data.failedUploadPaths
      })
      deleteCloudFilesDirectBestEffort(cleanupIds)
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const requestId = Number(this._vehicleImageChangeRequestId || 0) + 1
    this._vehicleImageChangeRequestId = requestId
    this._imageChangePending = true
    this._pendingImageCleanupFileIds = cleanupIds.slice()
    this._pendingImageVehicleId = vehicleId
    this.clearVehicleImageChangeTimer()
    const showLoading = actionPayload.action === "remove" || actionPayload.action === "setCover"
    if (showLoading) {
      wx.showLoading({
        title: actionPayload.action === "setCover" ? "设置中…" : "处理中…",
        mask: true
      })
    }

    let settled = false
    const finish = (callback) => {
      if (
        settled ||
        this._vehicleImageChangeRequestId !== requestId ||
        !this.isVehicleDetailActive()
      ) {
        return false
      }
      settled = true
      this.clearVehicleImageChangeTimer()
      this._imageChangePending = false
      this._pendingImageCleanupFileIds = []
      this._pendingImageVehicleId = ""
      callback()
      return true
    }
    const handleFailure = () => {
      finish(() => {
        wx.hideLoading()
        this.setData({
          uploading: false,
          uploadItems: getRetryUploadItems(),
          failedUploadPaths: uploadSummary && uploadSummary.allFilePaths ? uploadSummary.allFilePaths : this.data.failedUploadPaths,
          uploadProgressText: actionPayload.action === "add" ? "保存失败，可重试本次图片" : this.data.uploadProgressText
        })
        requestUploadedFileCleanup(vehicleId, cleanupIds)
        wx.showToast({
          title: "图片操作失败",
          icon: "none"
        })
      })
    }

    this._vehicleImageChangeTimer = setTimeout(
      handleFailure,
      IMAGE_CHANGE_TIMEOUT_MS
    )

    const requestOptions = {
      name: "vehicleImageUpdate",
      data: {
        id: vehicleId,
        ...actionPayload
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          finish(() => {
            wx.hideLoading()
            this.setData({
              uploading: false,
              uploadItems: getRetryUploadItems(),
              failedUploadPaths: uploadSummary && uploadSummary.allFilePaths ? uploadSummary.allFilePaths : this.data.failedUploadPaths,
              uploadProgressText: actionPayload.action === "add" ? "保存失败，可重试本次图片" : this.data.uploadProgressText
            })
            requestUploadedFileCleanup(vehicleId, cleanupIds)
            wx.showToast({
              title: formatToastTitle(result && result.message, "图片操作失败"),
              icon: "none"
            })
          })
          return
        }

        finish(() => {
          wx.hideLoading()
          const currentDetail = this.data.detail || {}
          this.setData({
            uploading: false,
            failedUploadPaths: uploadSummary && uploadSummary.failedUploadPaths ? uploadSummary.failedUploadPaths : [],
            uploadProgressText: actionPayload.action === "add"
              ? uploadSummary && uploadSummary.failedUploadPaths && uploadSummary.failedUploadPaths.length
                ? `已上传 ${uploadSummary.uploadedCount} 张，${uploadSummary.failedUploadPaths.length} 张可重试`
                : "图片上传完成"
              : this.data.uploadProgressText,
            detail: formatDetail({
              ...currentDetail,
              imageList: result.imageList,
              coverImage: result.coverImage,
              updatedAt: new Date().toISOString()
            })
          })

          const partialUpload = actionPayload.action === "add" && Number(skippedCount) > 0
          const failedCount = uploadSummary && Array.isArray(uploadSummary.failedUploadPaths)
            ? uploadSummary.failedUploadPaths.length
            : 0
          wx.showToast({
            title:
              actionPayload.action === "setCover"
                ? "封面已更新"
                : actionPayload.action === "remove"
                  ? "图片已移除"
                  : partialUpload
                    ? failedCount
                      ? `成功 ${uploadSummary.uploadedCount} 张，失败 ${failedCount} 张`
                      : `已上传，跳过 ${skippedCount} 张`
                    : "图片已上传",
            icon: partialUpload ? "none" : "success",
            duration: partialUpload ? 2200 : 1500
          })
        })
      },
      fail: handleFailure
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure()
    }
  },

  isVehicleDetailActive() {
    return this._vehicleDetailUnloaded !== true
  },

  isVehicleDetailInteractionBusy() {
    return Boolean(
      this.data.loading ||
      this.isVehicleDetailMutationBusy()
    )
  },

  isVehicleDetailMutationBusy() {
    return Boolean(
      this.data.updatingStatus ||
      this.data.uploading ||
      this._imageChangePending
    )
  },

  finishVehicleDetailLoadDone() {
    const done = this._vehicleDetailLoadDone
    this._vehicleDetailLoadDone = null
    if (typeof done === "function") {
      try {
        done()
      } catch (error) {}
    }
  },

  clearVehicleDetailLoadTimer() {
    if (this._vehicleDetailLoadTimer) {
      clearTimeout(this._vehicleDetailLoadTimer)
      this._vehicleDetailLoadTimer = null
    }
  },

  clearVehicleStatusTimer() {
    if (this._vehicleStatusTimer) {
      clearTimeout(this._vehicleStatusTimer)
      this._vehicleStatusTimer = null
    }
  },

  clearVehicleImageChangeTimer() {
    if (this._vehicleImageChangeTimer) {
      clearTimeout(this._vehicleImageChangeTimer)
      this._vehicleImageChangeTimer = null
    }
  }
})
