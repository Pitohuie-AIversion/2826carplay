// Phase 9 note:
// 当前预约页只做本地表单校验与提交提示，不创建真实订单。
// 后续如接入云数据库，可在保留当前表单字段的前提下，
// 将提交结果写入 bookings 集合或云端接口。
// 建议预约字段继续保持：
// carId, carName, userName, phone, startDate, endDate, city, note, status, createdAt
const cars = require("../../data/cars")

function formatDate(date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, "0")
  const day = `${date.getDate()}`.padStart(2, "0")

  return `${year}-${month}-${day}`
}

Page({
  data: {
    carId: "",
    carName: "",
    today: formatDate(new Date()),
    endMinDate: formatDate(new Date()),
    notFoundText: "未找到该车辆，请返回车库重新选择",
    submitText: "预约信息已提交，客服将尽快联系您",
    submitButtonText: "提交预约",
    isSubmitting: false,
    privacyTip: "提交预约即表示您同意我们仅将所填信息用于本次车辆预约沟通。车辆档期、价格、押金及取还车规则以客服最终确认为准。",
    form: {
      userName: "",
      phone: "",
      startDate: "",
      endDate: "",
      city: "",
      note: ""
    }
  },

  onLoad(options) {
    const carId = options.carId || ""
    const car = cars.find((item) => item.id === carId)

    this.setData({
      carId,
      carName: car ? car.name : "",
      "form.city": car ? car.location : ""
    })

    wx.setNavigationBarTitle({
      title: car ? `${car.name} 预约` : "预约咨询"
    })
  },

  handleInput(event) {
    const { field } = event.currentTarget.dataset
    let value = event.detail.value

    if (!field) {
      return
    }

    if (field === "phone") {
      value = String(value || "").replace(/\D/g, "").slice(0, 11)
    }

    this.setData({
      [`form.${field}`]: value
    })
  },

  handleDateChange(event) {
    const { field } = event.currentTarget.dataset
    const value = event.detail.value

    if (!field) {
      return
    }

    if (field === "startDate") {
      const nextData = {
        "form.startDate": value,
        endMinDate: value
      }

      if (this.data.form.endDate && this.data.form.endDate < value) {
        nextData["form.endDate"] = ""
      }

      this.setData(nextData)
      return
    }

    this.setData({
      [`form.${field}`]: value
    })
  },

  validateForm() {
    const form = this.data.form

    if (!this.data.carId || !this.data.carName) {
      return "未找到该车辆，请返回车库重新选择"
    }

    if (!form.userName.trim()) {
      return "请输入姓名"
    }

    if (!form.phone.trim()) {
      return "请输入手机号"
    }

    if (!/^1\d{10}$/.test(form.phone.trim())) {
      return "请输入正确的 11 位手机号"
    }

    if (!form.startDate) {
      return "请选择取车日期"
    }

    if (!form.endDate) {
      return "请选择还车日期"
    }

    if (form.endDate < form.startDate) {
      return "还车日期不能早于取车日期"
    }

    return ""
  },

  handleSubmit() {
    if (this.data.isSubmitting) {
      return
    }

    const errorMessage = this.validateForm()

    if (errorMessage) {
      wx.showToast({
        title: errorMessage,
        icon: "none"
      })
      return
    }

    const defaultCity = this.data.form.city

    this.setData({
      isSubmitting: true,
      submitButtonText: "已提交"
    })

    wx.showToast({
      title: this.data.submitText,
      icon: "none",
      duration: 2500
    })

    setTimeout(() => {
      this.setData({
        isSubmitting: false,
        submitButtonText: "提交预约",
        form: {
          userName: "",
          phone: "",
          startDate: "",
          endDate: "",
          city: defaultCity,
          note: ""
        },
        endMinDate: this.data.today
      })
    }, 2500)
  },

  handleBackGarage() {
    const pages = getCurrentPages()

    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          wx.redirectTo({
            url: "/pages/garage/garage"
          })
        }
      })
      return
    }

    wx.redirectTo({
      url: "/pages/garage/garage",
      fail: () => {
        wx.reLaunch({
          url: "/pages/garage/garage"
        })
      }
    })
  }
})
