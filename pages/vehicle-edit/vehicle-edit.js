const vehicleUtils = require("../../shared/vehicle")

const VEHICLE_TYPE_LABEL_MAP = {
  sedan: "轿车",
  suv: "SUV",
  mpv: "MPV",
  sports: "跑车",
  truck: "卡车",
  other: "其他"
}

const STATUS_LABEL_MAP = {
  active: "在用",
  idle: "闲置",
  maintenance: "维修",
  retired: "停用"
}

const FIELD_LABEL_MAP = {
  id: "车辆ID",
  plateNumber: "车牌号",
  vehicleType: "车辆类型",
  brandModel: "品牌型号",
  registerDate: "注册日期",
  status: "使用状态"
}

function formatDate(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")
  return `${year}-${month}-${day}`
}

function buildLabels(values, map) {
  return values.map((value) => map[value] || value)
}

Page({
  data: {
    id: "",
    today: formatDate(new Date()),
    loading: true,
    isSubmitting: false,
    vehicleTypeLabels: buildLabels(vehicleUtils.VEHICLE_TYPES, VEHICLE_TYPE_LABEL_MAP),
    statusLabels: buildLabels(vehicleUtils.VEHICLE_STATUSES, STATUS_LABEL_MAP),
    vehicleTypeIndex: 0,
    statusIndex: 0,
    vehicleTypeLabel: "",
    statusLabel: "",
    form: {
      plateNumber: "",
      vehicleType: "",
      brandModel: "",
      registerDate: "",
      status: ""
    }
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

  fetchDetail(id) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      this.setData({
        loading: false
      })
      return
    }

    wx.cloud.callFunction({
      name: "vehicleList",
      data: {
        status: "all",
        keyword: ""
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "加载失败",
            icon: "none"
          })
          this.setData({
            loading: false
          })
          return
        }

        const list = Array.isArray(result.list) ? result.list : []
        const current = list.find((item) => item.id === id)
        if (!current) {
          wx.showToast({
            title: "车辆不存在",
            icon: "none"
          })
          this.setData({
            loading: false
          })
          return
        }

        const vehicleTypeIndex = Math.max(vehicleUtils.VEHICLE_TYPES.indexOf(current.vehicleType), 0)
        const statusIndex = Math.max(vehicleUtils.VEHICLE_STATUSES.indexOf(current.status), 0)
        const vehicleType = vehicleUtils.VEHICLE_TYPES[vehicleTypeIndex] || ""
        const status = vehicleUtils.VEHICLE_STATUSES[statusIndex] || ""

        this.setData({
          loading: false,
          vehicleTypeIndex,
          statusIndex,
          vehicleTypeLabel: VEHICLE_TYPE_LABEL_MAP[vehicleType] || "",
          statusLabel: STATUS_LABEL_MAP[status] || "",
          form: {
            plateNumber: vehicleUtils.normalizePlateNumber(current.plateNumber),
            vehicleType,
            brandModel: current.brandModel || "",
            registerDate: current.registerDate || "",
            status
          }
        })
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "加载失败",
          icon: "none"
        })
        this.setData({
          loading: false
        })
      }
    })
  },

  handlePlateInput(event) {
    let value = vehicleUtils.normalizePlateNumber(event.detail.value)
    value = value.replace(/\s/g, "")
    value = value.replace(/[^0-9A-Z\u4e00-\u9fa5]/g, "").slice(0, 8)

    this.setData({
      "form.plateNumber": value
    })
  },

  handleTextInput(event) {
    const { field } = event.currentTarget.dataset
    if (!field) {
      return
    }

    let value = event.detail.value

    if (field === "brandModel") {
      value = String(value || "").slice(0, 50)
    }

    this.setData({
      [`form.${field}`]: value
    })
  },

  handleVehicleTypeChange(event) {
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.VEHICLE_TYPES[index] || ""
    const label = VEHICLE_TYPE_LABEL_MAP[value] || ""

    this.setData({
      vehicleTypeIndex: index,
      vehicleTypeLabel: label,
      "form.vehicleType": value
    })
  },

  handleStatusChange(event) {
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.VEHICLE_STATUSES[index] || ""
    const label = STATUS_LABEL_MAP[value] || ""

    this.setData({
      statusIndex: index,
      statusLabel: label,
      "form.status": value
    })
  },

  handleDateChange(event) {
    this.setData({
      "form.registerDate": event.detail.value
    })
  },

  handleManageImages() {
    if (!this.data.id || this.data.loading) {
      return
    }

    wx.navigateTo({
      url: `/pages/vehicle-detail-manage/vehicle-detail-manage?id=${this.data.id}`
    })
  },

  getValidationMessage(result) {
    const details = result && result.details
    const errors = details && details.errors
    const first = Array.isArray(errors) ? errors[0] : null

    if (!first) {
      return (result && result.message) || "参数校验失败"
    }

    const fieldLabel = FIELD_LABEL_MAP[first.field] || first.field
    const message = first.message ? `${fieldLabel}：${first.message}` : fieldLabel
    return message.length > 30 ? message.slice(0, 30) : message
  },

  handleSubmit() {
    if (this.data.loading || this.data.isSubmitting) {
      return
    }

    const check = vehicleUtils.validateVehicle(this.data.form)
    if (!check.ok) {
      wx.showToast({
        title: this.getValidationMessage(check),
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

    this.setData({
      isSubmitting: true
    })

    wx.cloud.callFunction({
      name: "vehicleUpdate",
      data: {
        id: this.data.id,
        ...check.value
      },
      success: (res) => {
        const result = res && res.result ? res.result : null

        if (result && result.ok) {
          wx.showToast({
            title: "保存成功",
            icon: "success",
            duration: 1200
          })

          setTimeout(() => {
            wx.navigateBack({
              delta: 1,
              fail: () => {
                wx.redirectTo({
                  url: "/pages/vehicle-manage/vehicle-manage"
                })
              }
            })
          }, 900)
          return
        }

        const title =
          result &&
          result.code === "VALIDATION_ERROR" &&
          result.details &&
          result.details.errors
            ? this.getValidationMessage(result)
            : (result && result.message) || "保存失败"

        wx.showToast({
          title,
          icon: "none"
        })

        this.setData({
          isSubmitting: false
        })
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "保存失败",
          icon: "none"
        })

        this.setData({
          isSubmitting: false
        })
      }
    })
  }
})
