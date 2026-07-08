Page({
  data: {
    brandName: "极境车库",
    servicePhone: "4008001234",
    userName: "车库来访者",
    userDesc: "静态展示页，更多个人功能将在后续版本完善",
    menuItems: [
      {
        key: "vehicleCreate",
        title: "新增车辆",
        desc: "录入新的车辆信息"
      },
      {
        key: "bookings",
        title: "我的预约",
        desc: "查看已提交的预约咨询"
      },
      {
        key: "favorites",
        title: "我的收藏",
        desc: "收藏喜欢的车型，方便再次查看"
      },
      {
        key: "faq",
        title: "常见问题",
        desc: "了解预约流程、档期与取还车说明"
      },
      {
        key: "rules",
        title: "平台规则",
        desc: "价格、档期、押金和规则以客服最终确认为准"
      }
    ]
  },

  handleMenuTap(event) {
    const { key, title } = event.currentTarget.dataset

    if (key === "vehicleCreate") {
      wx.navigateTo({
        url: "/pages/vehicle-create/vehicle-create",
        fail: () => {
          wx.showToast({
            title: "页面跳转失败",
            icon: "none"
          })
        }
      })
      return
    }

    wx.showToast({
      title: `${title} 即将开放`,
      icon: "none"
    })
  },

  handlePhoneCall() {
    wx.makePhoneCall({
      phoneNumber: this.data.servicePhone,
      fail: () => {
        wx.showToast({
          title: `请联系客服：${this.data.servicePhone}`,
          icon: "none"
        })
      }
    })
  },

  handleBackHome() {
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
