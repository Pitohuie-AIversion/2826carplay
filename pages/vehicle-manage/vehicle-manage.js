const vehicleUtils = require("../../shared/vehicle")
const { requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")

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

const DEFAULT_PAGE_SIZE = 20

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
    { key: "idle", label: "在库", value: stats.idle || 0 },
    { key: "active", label: "在用", value: stats.active || 0 },
    { key: "maintenance", label: "维修中", value: stats.maintenance || 0 },
    { key: "recentAdded7d", label: "近7天新增", value: stats.recentAdded7d || 0 }
  ]
}

function buildStatusRatioSegments(stats) {
  const idle = Number(stats && stats.idle) || 0
  const active = Number(stats && stats.active) || 0
  const maintenance = Number(stats && stats.maintenance) || 0
  const total = idle + active + maintenance

  const base = [
    { key: "idle", label: "在库", value: idle, className: "ratio-idle" },
    { key: "active", label: "在用", value: active, className: "ratio-active" },
    { key: "maintenance", label: "维修中", value: maintenance, className: "ratio-maintenance" }
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

function formatPriceDayText(priceDay) {
  if (Number.isInteger(priceDay) && priceDay > 0) {
    return `￥${priceDay} / 24小时`
  }

  return "—"
}

function buildMediaHealth(item) {
  const source = item && typeof item === "object" ? item : {}
  const imageCount = Math.max(0, Number(source.imageCount) || 0)
  const hasCover = Boolean(source.coverImage)

  if (!hasCover) {
    return {
      imageCount,
      mediaStatusText: "待补封面",
      mediaStatusClass: "media-health-missing",
      mediaProgress: 0
    }
  }

  if (imageCount < 3) {
    return {
      imageCount,
      mediaStatusText: "基础素材",
      mediaStatusClass: "media-health-basic",
      mediaProgress: Math.round((imageCount / 3) * 100)
    }
  }

  return {
    imageCount,
    mediaStatusText: "素材充足",
    mediaStatusClass: "media-health-ready",
    mediaProgress: 100
  }
}

function buildRecentAddedViewModel(list) {
  if (!Array.isArray(list)) {
    return []
  }

  return list.map((item) => ({
    id: item.id || "",
    plateNumber: vehicleUtils.normalizePlateNumber(item.plateNumber),
    brandModel: item.brandModel || "—",
    status: item.status || "",
    statusText: STATUS_LABEL_MAP[item.status] || item.status || "未知",
    statusClass: STATUS_CLASS_MAP[item.status] || "status-idle",
    locationText: item.location ? String(item.location).trim() : "—",
    createdAtText: formatDisplayTime(item.createdAt)
  }))
}

Page({
  data: {
    loading: false,
    pageAuthorized: false,
    keyword: "",
    currentStatus: "all",
    statusOptions: STATUS_OPTIONS,
    statusOpOptions: STATUS_OP_OPTIONS,
    total: 0,
    truncated: false,
    summaryItems: buildStatusSummary({}),
    statusRatioSegments: buildStatusRatioSegments({}),
    recentAddedList: [],
    list: [],
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    hasMore: false,
    emptyTitle: "暂无车辆数据",
    emptyDesc: "当前筛选条件下没有匹配的车辆记录"
  },

  onLoad() {
    requirePagePermission(this, {
      required: "canManageVehicles",
      noPermissionMessage: "无权访问车辆管理",
      onAuthorized: () => {
        this.fetchList()
      }
    })
  },

  onShow() {
    if (!this.data.pageAuthorized || this.data.loading) {
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

  handleClearKeyword() {
    if (!this.data.keyword) {
      return
    }
    this.setData({ keyword: "" }, () => this.fetchList())
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

  handleLoadMore() {
    if (this.data.loading || !this.data.hasMore) {
      return
    }

    this.fetchList({ append: true })
  },

  handleGoCreate() {
    wx.navigateTo({
      url: "/pages/vehicle-create/vehicle-create",
      fail: () => {
        wx.showToast({
          title: "新建页面打开失败",
          icon: "none"
        })
      }
    })
  },

  handleEdit(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()

    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      return
    }

    wx.navigateTo({
      url: `/pages/vehicle-edit/vehicle-edit?id=${id}`,
      fail: () => {
        wx.showToast({
          title: "编辑页面打开失败",
          icon: "none"
        })
      }
    })
  },

  handleViewDetail(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()

    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      return
    }

    wx.navigateTo({
      url: `/pages/vehicle-detail-manage/vehicle-detail-manage?id=${id}`,
      fail: () => {
        wx.showToast({
          title: "车辆详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleCoverImageError(event) {
    const index = Number(event.currentTarget.dataset.index)
    const list = Array.isArray(this.data.list) ? this.data.list : []

    if (!Number.isInteger(index) || index < 0 || index >= list.length) {
      return
    }

    const nextList = list.map((item, itemIndex) => itemIndex === index
      ? {
          ...item,
          coverImage: "",
          coverLoadFailed: true,
          mediaStatusText: "封面不可用",
          mediaStatusClass: "media-health-missing",
          mediaProgress: 0
        }
      : item)

    this.setData({ list: nextList })
  },

  handleUpdateStatus(event) {
    if (this.data.loading) {
      return
    }

    const id = String(event.currentTarget.dataset.id || "").trim()
    const status = String(event.currentTarget.dataset.status || "").trim()
    const currentStatus = String(event.currentTarget.dataset.currentStatus || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()

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

  handleRetire(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()

    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
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

  handleRestore(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()

    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
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

  handleDelete(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    const plateNumber = String(event.currentTarget.dataset.plateNumber || "").trim()

    if (!id) {
      wx.showToast({
        title: "车辆编号缺失",
        icon: "none"
      })
      return
    }

    wx.showModal({
      title: "删除车辆",
      content: `确认删除车辆 ${plateNumber || id}？仅无预约历史的车辆可删除；有预约历史请改为停用。删除后不可恢复。`,
      confirmText: "确认删除",
      confirmColor: "#d46868",
      success: (modalRes) => {
        if (!modalRes.confirm) {
          return
        }

        this.deleteVehicle(id)
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
        this.fetchList()
      },
      fail: (error) => {
        wx.hideLoading()
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

        this.fetchList()
      },
      fail: (error) => {
        wx.hideLoading()
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

        this.fetchList()
      },
      fail: (error) => {
        wx.hideLoading()
        wx.showToast({
          title: "恢复失败",
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
      title: "删除中…",
      mask: true
    })

    wx.cloud.callFunction({
      name: "vehicleDelete",
      data: { id },
      success: (res) => {
        wx.hideLoading()

        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "删除失败"),
            icon: "none"
          })
          return
        }

        wx.showToast({
        title: formatToastTitle(result.message, "删除成功"),
          icon: "success"
        })

        this.fetchList()
      },
      fail: (error) => {
        wx.hideLoading()
        wx.showToast({
          title: "删除失败",
          icon: "none"
        })
      }
    })
  },

  fetchList(input) {
    const done = typeof input === "function" ? input : input && input.done
    const append = Boolean(input && typeof input === "object" && input.append)
    const nextPage = append ? this.data.page + 1 : 0
    const pageSize = this.data.pageSize || DEFAULT_PAGE_SIZE

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
      status: this.data.currentStatus,
      page: nextPage,
      pageSize
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
          title: formatToastTitle(result && result.message, "查询失败"),
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
              locationText: item.location ? String(item.location).trim() : "—",
              priceDayText: formatPriceDayText(item.priceDay),
              transmissionText:
                TRANSMISSION_LABEL_MAP[item.transmission] || (item.transmission ? String(item.transmission) : "—"),
              fuelTypeText: FUEL_TYPE_LABEL_MAP[item.fuelType] || (item.fuelType ? String(item.fuelType) : "—"),
              seatsText: Number.isInteger(item.seats) && item.seats > 0 ? `${item.seats} 座` : "—",
              ...buildMediaHealth(item)
            }))
          : []

        const nextList = append ? this.data.list.concat(list) : list

        this.setData({
          loading: false,
          total: result.total || 0,
          truncated: Boolean(result.truncated),
          summaryItems: buildStatusSummary(result.dashboard || {}),
          statusRatioSegments: buildStatusRatioSegments(result.dashboard || {}),
          recentAddedList: buildRecentAddedViewModel(result.recentAddedList),
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          list: nextList
        })

        if (typeof done === "function") {
          done()
        }
      },
      fail: (error) => {
        wx.showToast({
          title: "查询失败",
          icon: "none"
        })

        this.setData({
          loading: false,
          page: 0,
          hasMore: false,
          list: []
        })

        if (typeof done === "function") {
          done()
        }
      }
    })
  }
})
