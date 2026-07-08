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
              updatedAtText: formatDisplayTime(item.updatedAt || item.createdAt)
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
