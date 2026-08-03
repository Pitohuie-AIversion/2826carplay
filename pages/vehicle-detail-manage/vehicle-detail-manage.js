const { requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")

const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024
const ALLOWED_IMAGE_EXTENSIONS = new Set(["jpg", "jpeg", "png", "webp"])

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
    updatingStatus: false,
    pageAuthorized: false,
    statusOpOptions: STATUS_OP_OPTIONS,
    detail: null
  },

  onLoad(options) {
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

  onPullDownRefresh() {
    if (!this.data.pageAuthorized) {
      wx.stopPullDownRefresh()
      return
    }
    this.fetchDetail(this.data.id, () => {
      wx.stopPullDownRefresh()
    })
  },

  fetchDetail(id, done) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      this.setData({
        loading: false
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
      name: "vehicleDetail",
      data: { id },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.detail) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "加载失败"),
            icon: "none"
          })
          this.setData({
            loading: false
          })
          if (typeof done === "function") {
            done()
          }
          return
        }

        const detail = result.detail
        this.setData({
          loading: false,
          detail: formatDetail(detail)
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
          loading: false
        })
        if (typeof done === "function") {
          done()
        }
      }
    })
  },

  handleEdit() {
    if (!this.data.id) {
      return
    }

    wx.navigateTo({
      url: `/pages/vehicle-edit/vehicle-edit?id=${this.data.id}`,
      fail: () => {
        wx.showToast({
          title: "编辑页面打开失败",
          icon: "none"
        })
      }
    })
  },

  handleUpdateStatus(event) {
    if (this.data.updatingStatus || this.data.loading) {
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

    wx.showModal({
      title: "更新状态",
      content: `确认将车辆 ${plateNumber || id} 状态更新为「${statusText}」？`,
      confirmText: "确认更新",
      confirmColor: "#528fff",
      success: (modalRes) => {
        if (!modalRes.confirm) {
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

    if (!id || this.data.updatingStatus) {
      return
    }

    wx.showModal({
      title: "停用车辆",
      content: `确认将车辆 ${plateNumber || id} 标记为停用？`,
      confirmText: "确认停用",
      confirmColor: "#d46868",
      success: (modalRes) => {
        if (!modalRes.confirm) {
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

    if (!id || this.data.updatingStatus) {
      return
    }

    wx.showModal({
      title: "恢复启用",
      content: `确认将车辆 ${plateNumber || id} 恢复为可管理状态？`,
      confirmText: "确认恢复",
      confirmColor: "#528fff",
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return
        }

        this.restoreVehicle(id)
      }
    })
  },

  updateVehicleStatus(id, status) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({
      updatingStatus: true
    })

    wx.showLoading({
      title: "更新中…",
      mask: true
    })

    wx.cloud.callFunction({
      name: "vehicleUpdateStatus",
      data: { id, status },
      success: (res) => {
        wx.hideLoading()
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ updatingStatus: false })
          wx.showToast({
          title: formatToastTitle(result && result.message, "更新失败"),
            icon: "none"
          })
          return
        }

        wx.showToast({
        title: formatToastTitle(result.message, "状态已更新"),
          icon: "success"
        })
        this.fetchDetail(id, () => {
          this.setData({ updatingStatus: false })
        })
      },
      fail: (error) => {
        wx.hideLoading()
        this.setData({ updatingStatus: false })
        wx.showToast({
          title: "更新失败",
          icon: "none"
        })
      }
    })
  },

  retireVehicle(id) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({
      updatingStatus: true
    })

    wx.showLoading({
      title: "停用中…",
      mask: true
    })

    wx.cloud.callFunction({
      name: "vehicleRetire",
      data: { id },
      success: (res) => {
        wx.hideLoading()
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ updatingStatus: false })
          wx.showToast({
          title: formatToastTitle(result && result.message, "停用失败"),
            icon: "none"
          })
          return
        }

        wx.showToast({
        title: formatToastTitle(result.message, "停用成功"),
          icon: "success"
        })
        this.fetchDetail(id, () => {
          this.setData({ updatingStatus: false })
        })
      },
      fail: (error) => {
        wx.hideLoading()
        this.setData({ updatingStatus: false })
        wx.showToast({
          title: "停用失败",
          icon: "none"
        })
      }
    })
  },

  restoreVehicle(id) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({
      updatingStatus: true
    })

    wx.showLoading({
      title: "恢复中…",
      mask: true
    })

    wx.cloud.callFunction({
      name: "vehicleRestore",
      data: { id },
      success: (res) => {
        wx.hideLoading()
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ updatingStatus: false })
          wx.showToast({
          title: formatToastTitle(result && result.message, "恢复失败"),
            icon: "none"
          })
          return
        }

        wx.showToast({
        title: formatToastTitle(result.message, "恢复成功"),
          icon: "success"
        })
        this.fetchDetail(id, () => {
          this.setData({ updatingStatus: false })
        })
      },
      fail: (error) => {
        wx.hideLoading()
        this.setData({ updatingStatus: false })
        wx.showToast({
          title: "恢复失败",
          icon: "none"
        })
      }
    })
  },

  handleBackList() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.redirectTo({
          url: "/pages/vehicle-manage/vehicle-manage",
          fail: () => {
            wx.reLaunch({
              url: "/pages/vehicle-manage/vehicle-manage",
              fail: () => {
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
    const fileId = String(event.currentTarget.dataset.fileId || "").trim()
    const detail = this.data.detail
    const urls = detail && Array.isArray(detail.imageList) ? detail.imageList : []

    if (!fileId || !urls.length) {
      return
    }

    wx.previewImage({
      current: fileId,
      urls,
      fail: () => {
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
    if (!detail || this.data.uploading) {
      return
    }

    const remain = Math.max(9 - (detail.imageCount || 0), 0)
    if (remain <= 0) {
      wx.showToast({
        title: "最多上传 9 张图片",
        icon: "none"
      })
      return
    }

    wx.chooseImage({
      count: remain > 3 ? 3 : remain,
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (chooseRes) => {
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
    if (!wx.cloud || typeof wx.cloud.uploadFile !== "function") {
      wx.showToast({
        title: "云上传能力未初始化",
        icon: "none"
      })
      return
    }

    const uploadedFileIds = []
    const vehicleId = this.data.id

    this.setData({
      uploading: true
    })

    wx.showLoading({
      title: "上传中…",
      mask: true
    })

    const uploadNext = (index) => {
      if (index >= filePaths.length) {
        this.persistImageChange({
          action: "add",
          fileIds: uploadedFileIds
        }, uploadedFileIds, skippedCount)
        return
      }

      const filePath = filePaths[index]
      const extension = getFileExtension(filePath)
      const cloudPath = `vehicle-images/${vehicleId}/${Date.now()}_${index}.${extension}`

      wx.cloud.uploadFile({
        cloudPath,
        filePath,
        success: (uploadRes) => {
          if (uploadRes && uploadRes.fileID) {
            uploadedFileIds.push(uploadRes.fileID)
          }
          uploadNext(index + 1)
        },
        fail: (error) => {
          wx.hideLoading()
          this.setData({
            uploading: false
          })
          deleteCloudFilesDirectBestEffort(uploadedFileIds)
          wx.showToast({
            title: "图片上传失败",
            icon: "none"
          })
        }
      })
    }

    uploadNext(0)
  },

  handleSetCover(event) {
    const fileId = String(event.currentTarget.dataset.fileId || "").trim()
    if (!fileId || this.data.uploading) {
      return
    }

    this.persistImageChange({
      action: "setCover",
      fileId
    })
  },

  handleRemoveImage(event) {
    const fileId = String(event.currentTarget.dataset.fileId || "").trim()
    if (!fileId || this.data.uploading) {
      return
    }

    wx.showModal({
      title: "移除图片",
      content: "确认将该图片从车辆资料中移除？",
      confirmText: "确认移除",
      confirmColor: "#d46868",
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return
        }

        this.persistImageChange({
          action: "remove",
          fileId
        })
      }
    })
  },

  persistImageChange(payload, cleanupFileIds, skippedCount) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.hideLoading()
      this.setData({
        uploading: false
      })
      deleteCloudFilesDirectBestEffort(cleanupFileIds)
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const showLoading = payload.action === "add" || payload.action === "remove" || payload.action === "setCover"
    if (showLoading) {
      wx.showLoading({
        title: payload.action === "setCover" ? "设置中…" : payload.action === "remove" ? "处理中…" : "上传中…",
        mask: true
      })
    }

    wx.cloud.callFunction({
      name: "vehicleImageUpdate",
      data: {
        id: this.data.id,
        ...payload
      },
      success: (res) => {
        wx.hideLoading()

        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            uploading: false
          })
          requestUploadedFileCleanup(this.data.id, cleanupFileIds)
          wx.showToast({
          title: formatToastTitle(result && result.message, "图片操作失败"),
            icon: "none"
          })
          return
        }

        const currentDetail = this.data.detail || {}
        this.setData({
          uploading: false,
          detail: formatDetail({
            ...currentDetail,
            imageList: result.imageList,
            coverImage: result.coverImage,
            updatedAt: new Date().toISOString()
          })
        })

        const partialUpload = payload.action === "add" && Number(skippedCount) > 0
        wx.showToast({
          title:
            payload.action === "setCover"
              ? "封面已更新"
              : payload.action === "remove"
                ? "图片已移除"
                : partialUpload
                  ? `已上传，跳过 ${skippedCount} 张`
                  : "图片已上传",
          icon: partialUpload ? "none" : "success",
          duration: partialUpload ? 2200 : 1500
        })
      },
      fail: (error) => {
        wx.hideLoading()
        this.setData({
          uploading: false
        })
        requestUploadedFileCleanup(this.data.id, cleanupFileIds)
        wx.showToast({
          title: "图片操作失败",
          icon: "none"
        })
      }
    })
  }
})
