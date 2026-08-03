const vehicleUtils = require("../../shared/vehicle")
const { buildVehicleFormProgress } = require("../../shared/vehicleFormProgress")
const { requirePagePermission } = require("../../shared/pageAuth")
const { formatToastTitle } = require("../../shared/uiFeedback")

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
  id: "车辆ID",
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
  publicDescription: "公开说明",
  note: "内部备注"
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
    loadFailed: false,
    loadErrorText: "车辆档案加载失败，请稍后重试",
    isSubmitting: false,
    publicDescriptionLength: 0,
    noteLength: 0,
    formProgress: buildVehicleFormProgress({}),
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
      publicDescription: "",
      note: ""
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
        title: "车辆编号缺失",
        icon: "none"
      })
      this.setData({
        loading: false,
        loadFailed: true,
        loadErrorText: "缺少车辆ID，无法加载车辆档案"
      })
      return
    }

    this.setData({ id })
    requirePagePermission(this, {
      required: "canManageVehicles",
      noPermissionMessage: "无权访问编辑车辆",
      onAuthorized: () => {
        this.fetchDetail(id)
      }
    })
  },

  fetchDetail(id) {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      this.setData({
        loading: false,
        loadFailed: true,
        loadErrorText: "云能力未初始化，请稍后重试"
      })
      return
    }

    wx.cloud.callFunction({
      name: "vehicleDetail",
      data: {
        id
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !result.detail) {
          wx.showToast({
          title: formatToastTitle(result && result.message, "加载失败"),
            icon: "none"
          })
          this.setData({
            loading: false,
            loadFailed: true,
            loadErrorText: (result && result.message) || "车辆档案加载失败，请稍后重试"
          })
          return
        }

        const current = result.detail

        const vehicleTypeIndex = Math.max(vehicleUtils.VEHICLE_TYPES.indexOf(current.vehicleType), 0)
        const statusIndex = Math.max(vehicleUtils.VEHICLE_STATUSES.indexOf(current.status), 0)
        const transmissionIndex = Math.max(vehicleUtils.TRANSMISSION_TYPES.indexOf(current.transmission), 0)
        const fuelTypeIndex = Math.max(vehicleUtils.FUEL_TYPES.indexOf(current.fuelType), 0)
        const vehicleType = vehicleUtils.VEHICLE_TYPES[vehicleTypeIndex] || ""
        const status = vehicleUtils.VEHICLE_STATUSES[statusIndex] || ""
        const transmission = current.transmission || ""
        const fuelType = current.fuelType || ""

        this.setData({
          loading: false,
          loadFailed: false,
          publicDescriptionLength: String(current.publicDescription || "").length,
          noteLength: String(current.note || "").length,
          vehicleTypeIndex,
          statusIndex,
          transmissionIndex: transmission ? transmissionIndex : 0,
          fuelTypeIndex: fuelType ? fuelTypeIndex : 0,
          vehicleTypeLabel: VEHICLE_TYPE_LABEL_MAP[vehicleType] || "",
          statusLabel: STATUS_LABEL_MAP[status] || "",
          transmissionLabel: TRANSMISSION_LABEL_MAP[transmission] || "",
          fuelTypeLabel: FUEL_TYPE_LABEL_MAP[fuelType] || "",
          formProgress: buildVehicleFormProgress({
            plateNumber: current.plateNumber,
            vehicleType,
            brandModel: current.brandModel,
            registerDate: current.registerDate,
            status
          }),
          form: {
            plateNumber: vehicleUtils.normalizePlateNumber(current.plateNumber),
            vehicleType,
            brandModel: current.brandModel || "",
            registerDate: current.registerDate || "",
            status,
            location: current.location || "",
            transmission,
            fuelType,
            seats: current.seats === undefined || current.seats === null ? "" : String(current.seats),
            priceDay: current.priceDay === undefined || current.priceDay === null ? "" : String(current.priceDay),
            vin: current.vin || "",
            engineNumber: current.engineNumber || "",
            publicDescription: current.publicDescription || "",
            note: current.note || ""
          }
        })
      },
      fail: (error) => {
        wx.showToast({
          title: "加载失败",
          icon: "none"
        })
        this.setData({
          loading: false,
          loadFailed: true,
          loadErrorText: (error && (error.errMsg || error.message)) || "车辆档案加载失败，请稍后重试"
        })
      }
    })
  },

  handlePlateInput(event) {
    let value = vehicleUtils.normalizePlateNumber(event.detail.value)
    value = value.replace(/\s/g, "")
    value = value.replace(/[^0-9A-Z\u4e00-\u9fa5]/g, "").slice(0, 8)

    this.setData({
      "form.plateNumber": value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, plateNumber: value })
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

    if (field === "publicDescription" || field === "note") {
      value = String(value || "").slice(0, 200)
    }

    if (field === "seats") {
      value = String(value || "").replace(/\D/g, "").slice(0, 1)
    }

    if (field === "priceDay") {
      value = String(value || "").replace(/\D/g, "").slice(0, 5)
    }

    const nextData = {
      [`form.${field}`]: value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, [field]: value })
    }
    if (field === "publicDescription") {
      nextData.publicDescriptionLength = String(value || "").length
    }
    if (field === "note") {
      nextData.noteLength = String(value || "").length
    }

    this.setData(nextData)
  },

  handleVehicleTypeChange(event) {
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.VEHICLE_TYPES[index] || ""
    const label = VEHICLE_TYPE_LABEL_MAP[value] || ""

    this.setData({
      vehicleTypeIndex: index,
      vehicleTypeLabel: label,
      "form.vehicleType": value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, vehicleType: value })
    })
  },

  handleStatusChange(event) {
    const index = Number(event.detail.value) || 0
    const value = vehicleUtils.VEHICLE_STATUSES[index] || ""
    const label = STATUS_LABEL_MAP[value] || ""

    this.setData({
      statusIndex: index,
      statusLabel: label,
      "form.status": value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, status: value })
    })
  },

  handleDateChange(event) {
    this.setData({
      "form.registerDate": event.detail.value,
      formProgress: buildVehicleFormProgress({ ...this.data.form, registerDate: event.detail.value })
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

  handleManageImages() {
    if (!this.data.id || this.data.loading) {
      return
    }

    wx.navigateTo({
      url: `/pages/vehicle-detail-manage/vehicle-detail-manage?id=${this.data.id}`,
      fail: () => {
        wx.showToast({
          title: "车辆详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleRetryLoad() {
    if (!this.data.id) {
      return
    }

    this.setData({
      loading: true,
      loadFailed: false
    })
    this.fetchDetail(this.data.id)
  },

  handleBackList() {
    const pages = getCurrentPages()
    if (pages.length > 1) {
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
      return
    }

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
        title: formatToastTitle(this.getValidationMessage(check), "车辆信息有误"),
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
          title: "保存失败",
          icon: "none"
        })

        this.setData({
          isSubmitting: false
        })
      }
    })
  }
})
