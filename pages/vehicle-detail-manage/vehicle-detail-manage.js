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

const VEHICLE_TYPE_LABEL_MAP = {
  sedan: "轿车",
  suv: "SUV",
  mpv: "MPV",
  sports: "跑车",
  truck: "卡车",
  other: "其他"
}

function formatDisplayTime(value) {
  if (!value) {
    return "--"
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "--"
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
    isCover: fileId === coverImage
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
    createdAtText: formatDisplayTime(detail.createdAt),
    updatedAtText: formatDisplayTime(detail.updatedAt),
    vinText: detail.vin || "--",
    engineNumberText: detail.engineNumber || "--",
    noteText: detail.note || "--",
    createdByOpenidText: detail.createdByOpenid || "--"
  }
}

function getFileExtension(filePath) {
  const match = String(filePath || "").match(/\.([a-zA-Z0-9]+)(\?|$)/)
  return match && match[1] ? match[1].toLowerCase() : "jpg"
}

Page({
  data: {
    id: "",
    loading: true,
    uploading: false,
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
        title: "缺少车辆ID",
        icon: "none"
      })
      this.setData({
        loading: false
      })
      return
    }

    this.setData({ id })
    this.fetchDetail(id)
  },

  onPullDownRefresh() {
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
            title: (result && result.message) || "加载失败",
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
  },

  handleEdit() {
    if (!this.data.id) {
      return
    }

    wx.navigateTo({
      url: `/pages/vehicle-edit/vehicle-edit?id=${this.data.id}`
    })
  },

  handleBackList() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.redirectTo({
          url: "/pages/vehicle-manage/vehicle-manage"
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
      urls
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
        const tempFilePaths = Array.isArray(chooseRes.tempFilePaths) ? chooseRes.tempFilePaths : []
        if (!tempFilePaths.length) {
          return
        }

        this.uploadSelectedFiles(tempFilePaths)
      }
    })
  },

  uploadSelectedFiles(filePaths) {
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
      title: "上传中"
    })

    const uploadNext = (index) => {
      if (index >= filePaths.length) {
        this.persistImageChange({
          action: "add",
          fileIds: uploadedFileIds
        })
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
          wx.showToast({
            title: (error && (error.errMsg || error.message)) || "图片上传失败",
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

  persistImageChange(payload) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.hideLoading()
      this.setData({
        uploading: false
      })
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const showLoading = payload.action === "add" || payload.action === "remove" || payload.action === "setCover"
    if (showLoading) {
      wx.showLoading({
        title: payload.action === "setCover" ? "设置中" : payload.action === "remove" ? "处理中" : "上传中"
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
          wx.showToast({
            title: (result && result.message) || "图片操作失败",
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

        wx.showToast({
          title:
            payload.action === "setCover"
              ? "封面已更新"
              : payload.action === "remove"
                ? "图片已移除"
                : "图片已上传",
          icon: "success"
        })
      },
      fail: (error) => {
        wx.hideLoading()
        this.setData({
          uploading: false
        })
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "图片操作失败",
          icon: "none"
        })
      }
    })
  }
})
