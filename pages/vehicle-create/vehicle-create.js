const vehicleUtils = require("../../shared/vehicle")
const { requirePagePermission } = require("../../shared/pageAuth")

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

const TRANSMISSION_LABEL_MAP = {
  manual: "手动挡",
  automatic: "自动挡"
}

const FUEL_TYPE_LABEL_MAP = {
  gasoline: "燃油",
  electric: "纯电",
  hybrid: "混动"
}

const FIELD_LABEL_MAP = {
  plateNumber: "车牌号",
  vehicleType: "车辆类型",
  brandModel: "品牌型号",
  registerDate: "注册日期",
  status: "使用状态",
  location: "城市",
  transmission: "变速箱",
  fuelType: "燃油类型",
  seats: "座位数",
  priceDay: "日租金",
  vin: "VIN",
  engineNumber: "发动机号",
  note: "备注"
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
    today: formatDate(new Date()),
    isSubmitting: false,
    pageAuthorized: false,
    vehicleTypeLabels: buildLabels(vehicleUtils.VEHICLE_TYPES, VEHICLE_TYPE_LABEL_MAP),
    statusLabels: buildLabels(vehicleUtils.VEHICLE_STATUSES, STATUS_LABEL_MAP),
    transmissionLabels: buildLabels(vehicleUtils.TRANSMISSION_TYPES, TRANSMISSION_LABEL_MAP),
    fuelTypeLabels: buildLabels(vehicleUtils.FUEL_TYPES, FUEL_TYPE_LABEL_MAP),
    vehicleTypeIndex: 0,
    statusIndex: 0,
    transmissionIndex: 0,
    fuelTypeIndex: 0,
    vehicleTypeLabel: "",
    statusLabel: "",
    transmissionLabel: "",
    fuelTypeLabel: "",
    form: {
      plateNumber: "",
      vehicleType: "",
      brandModel: "",
      registerDate: "",
      status: "",
      location: "",
      transmission: "",
      fuelType: "",
      seats: "",
      priceDay: "",
      vin: "",
      engineNumber: "",
      note: ""
    }
  },

  navigateToImageManage(id) {
    if (!id) {
      this.finishSubmitFlow()
      return
    }

    wx.redirectTo({
      url: `/pages/vehicle-detail-manage/vehicle-detail-manage?id=${id}`,
      fail: () => {
        wx.navigateTo({
          url: `/pages/vehicle-detail-manage/vehicle-detail-manage?id=${id}`,
          fail: () => {
            this.finishSubmitFlow()
          }
        })
      }
    })
  },

  finishSubmitFlow() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.redirectTo({
            url: "/pages/mine/mine"
          })
        }
      })
      return
    }

    wx.redirectTo({
      url: "/pages/mine/mine",
      fail: () => {
        wx.reLaunch({
          url: "/pages/mine/mine"
        })
      }
    })
  },

  onLoad() {
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

    requirePagePermission(this, {
      required: "canManageVehicles",
      noPermissionMessage: "无权访问新增车辆",
      onAuthorized: () => {}
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

    if (field === "location") {
      value = String(value || "").slice(0, 20)
    }

    if (field === "vin" || field === "engineNumber") {
      value = String(value || "").slice(0, 32)
    }

    if (field === "note") {
      value = String(value || "").slice(0, 200)
    }

    if (field === "seats") {
      value = String(value || "").replace(/\D/g, "").slice(0, 1)
    }

    if (field === "priceDay") {
      value = String(value || "").replace(/\D/g, "").slice(0, 5)
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
    const value = event.detail.value

    this.setData({
      "form.registerDate": value
    })
  },

  handleTransmissionChange(event) {
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.TRANSMISSION_TYPES[index] || ""
    const label = TRANSMISSION_LABEL_MAP[value] || ""

    this.setData({
      transmissionIndex: index,
      transmissionLabel: label,
      "form.transmission": value
    })
  },

  handleFuelTypeChange(event) {
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.FUEL_TYPES[index] || ""
    const label = FUEL_TYPE_LABEL_MAP[value] || ""

    this.setData({
      fuelTypeIndex: index,
      fuelTypeLabel: label,
      "form.fuelType": value
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
    if (this.data.isSubmitting) {
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
      name: "vehicleCreate",
      data: check.value,
      success: (res) => {
        const result = res && res.result ? res.result : null

        if (result && result.ok) {
          this.setData({
            isSubmitting: false
          })

          wx.showModal({
            title: "新增成功",
            content: "车辆已创建，是否现在上传车辆图片？",
            confirmText: "去上传",
            cancelText: "稍后",
            success: (modalRes) => {
              if (modalRes.confirm) {
                this.navigateToImageManage(result.id)
                return
              }

              this.finishSubmitFlow()
            },
            fail: () => {
              this.finishSubmitFlow()
            }
          })
          return
        }

        const title =
          result &&
          result.code === "VALIDATION_ERROR" &&
          result.details &&
          result.details.errors
            ? this.getValidationMessage(result)
            : (result && result.message) || "新增失败"

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
          title: (error && (error.errMsg || error.message)) || "新增失败",
          icon: "none"
        })

        this.setData({
          isSubmitting: false
        })
      }
    })
  }
})
