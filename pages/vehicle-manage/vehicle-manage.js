const vehicleUtils = require("../../shared/vehicle")

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "active", label: "在用" },
  { value: "idle", label: "闲置" },
  { value: "maintenance", label: "维修" },
  { value: "retired", label: "停用" }
]

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

function buildStatusSummary(stats) {
  return [
    { key: "total", label: "总数", value: stats.total || 0 },
    { key: "active", label: "在用", value: stats.active || 0 },
    { key: "idle", label: "闲置", value: stats.idle || 0 },
    { key: "maintenance", label: "维修", value: stats.maintenance || 0 },
    { key: "retired", label: "停用", value: stats.retired || 0 }
  ]
}

function formatPriceDayText(priceDay) {
  if (Number.isInteger(priceDay) && priceDay > 0) {
    return `￥${priceDay} / 24小时`
  }

  return "--"
}

Page({
  data: {
    loading: false,
    keyword: "",
    currentStatus: "all",
    statusOptions: STATUS_OPTIONS,
    total: 0,
    summaryItems: buildStatusSummary({}),
    list: [],
    emptyTitle: "暂无车辆数据",
    emptyDesc: "当前筛选条件下没有匹配的车辆记录"
  },

  onLoad() {
    this.fetchList()
  },

  onShow() {
    if (this.data.loading) {
      return
    }

    this.fetchList()
  },

  onPullDownRefresh() {
    this.fetchList(() => {
      wx.stopPullDownRefresh()
    })
  },

  handleKeywordInput(event) {
    const value = String((event.detail && event.detail.value) || "")

    this.setData({
      keyword: value
    })
  },

  handleKeywordConfirm() {
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

  handleGoCreate() {
    wx.navigateTo({
      url: "/pages/vehicle-create/vehicle-create"
    })
  },

  handleEdit(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()

    if (!id) {
      wx.showToast({
        title: "缺少车辆ID",
        icon: "none"
      })
      return
    }

    wx.navigateTo({
      url: `/pages/vehicle-edit/vehicle-edit?id=${id}`
    })
  },

  handleViewDetail(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()

    if (!id) {
      wx.showToast({
        title: "缺少车辆ID",
        icon: "none"
      })
      return
    }

    wx.navigateTo({
      url: `/pages/vehicle-detail-manage/vehicle-detail-manage?id=${id}`
    })
  },

  handleRetire(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()

    if (!id) {
      wx.showToast({
        title: "缺少车辆ID",
        icon: "none"
      })
      return
    }

    wx.showModal({
      title: "停用车辆",
      content: `确认将车辆 ${plateNumber || id} 标记为停用？`,
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return
        }

        this.retireVehicle(id)
      }
    })
  },

  handleRestore(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()

    if (!id) {
      wx.showToast({
        title: "缺少车辆ID",
        icon: "none"
      })
      return
    }

    wx.showModal({
      title: "恢复启用",
      content: `确认将车辆 ${plateNumber || id} 恢复为可管理状态？`,
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return
        }

        this.restoreVehicle(id)
      }
    })
  },

  handleDelete(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()

    if (!id) {
      wx.showToast({
        title: "缺少车辆ID",
        icon: "none"
      })
      return
    }

    wx.showModal({
      title: "删除车辆",
      content: `确认删除车辆 ${plateNumber || id}？删除后不可恢复。`,
      confirmColor: "#eb5757",
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return
        }

        this.deleteVehicle(id)
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

    wx.showLoading({
      title: "停用中"
    })

    wx.cloud.callFunction({
      name: "vehicleRetire",
      data: { id },
      success: (res) => {
        wx.hideLoading()

        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "停用失败",
            icon: "none"
          })
          return
        }

        wx.showToast({
          title: result.message || "停用成功",
          icon: "success"
        })

        this.fetchList()
      },
      fail: (error) => {
        wx.hideLoading()
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "停用失败",
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

    wx.showLoading({
      title: "恢复中"
    })

    wx.cloud.callFunction({
      name: "vehicleRestore",
      data: { id },
      success: (res) => {
        wx.hideLoading()

        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "恢复失败",
            icon: "none"
          })
          return
        }

        wx.showToast({
          title: result.message || "恢复成功",
          icon: "success"
        })

        this.fetchList()
      },
      fail: (error) => {
        wx.hideLoading()
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "恢复失败",
          icon: "none"
        })
      }
    })
  },

  deleteVehicle(id) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    wx.showLoading({
      title: "删除中"
    })

    wx.cloud.callFunction({
      name: "vehicleDelete",
      data: { id },
      success: (res) => {
        wx.hideLoading()

        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "删除失败",
            icon: "none"
          })
          return
        }

        wx.showToast({
          title: result.message || "删除成功",
          icon: "success"
        })

        this.fetchList()
      },
      fail: (error) => {
        wx.hideLoading()
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "删除失败",
          icon: "none"
        })
      }
    })
  },

  fetchList(done) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })

      if (typeof done === "function") {
        done()
      }
      return
    }

    const filters = {
      keyword: String(this.data.keyword || "").trim(),
      status: this.data.currentStatus
    }

    this.setData({
      loading: true
    })

    wx.cloud.callFunction({
      name: "vehicleList",
      data: filters,
      success: (res) => {
        const result = res && res.result ? res.result : null

        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "查询失败",
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

        const list = Array.isArray(result.list)
          ? result.list.map((item) => ({
              ...item,
              plateNumber: vehicleUtils.normalizePlateNumber(item.plateNumber),
              statusText: STATUS_LABEL_MAP[item.status] || item.status || "未知",
              statusClass: STATUS_CLASS_MAP[item.status] || "status-idle",
              vehicleTypeText: VEHICLE_TYPE_LABEL_MAP[item.vehicleType] || item.vehicleType || "未知",
              updatedAtText: formatDisplayTime(item.updatedAt || item.createdAt),
              locationText: item.location ? String(item.location).trim() : "--",
              priceDayText: formatPriceDayText(item.priceDay),
              transmissionText:
                TRANSMISSION_LABEL_MAP[item.transmission] || (item.transmission ? String(item.transmission) : "--"),
              fuelTypeText: FUEL_TYPE_LABEL_MAP[item.fuelType] || (item.fuelType ? String(item.fuelType) : "--"),
              seatsText: Number.isInteger(item.seats) && item.seats > 0 ? `${item.seats} 座` : "--"
            }))
          : []

        this.setData({
          loading: false,
          total: result.total || 0,
          summaryItems: buildStatusSummary(result.stats || {}),
          list
        })

        if (typeof done === "function") {
          done()
        }
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "查询失败",
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
