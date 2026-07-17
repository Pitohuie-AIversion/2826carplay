function mapStatusText(status) {
  const value = String(status || "").trim()
  if (value === "contacted") {
    return "已联系"
  }
  if (value === "completed") {
    return "已完成"
  }
  if (value === "cancelled") {
    return "已取消"
  }
  return "待联系"
}

function mapStatusClass(status) {
  const value = String(status || "").trim()
  if (value === "contacted") {
    return "status-contacted"
  }
  if (value === "completed") {
    return "status-completed"
  }
  if (value === "cancelled") {
    return "status-cancelled"
  }
  return "status-pending"
}

function canCancelBooking(status) {
  const value = String(status || "").trim()
  return value === "pending" || value === "contacted"
}

Page({
  data: {
    loading: false,
    list: []
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
  },

  onShow() {
    this.loadList()
  },

  loadList() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        loading: false,
        list: []
      })
      return
    }

    this.setData({
      loading: true
    })

    wx.cloud.callFunction({
      name: "bookingMyList",
      data: { limit: 30 },
      success: (res) => {
        const result = res && res.result ? res.result : null
        const rawList = result && result.ok && Array.isArray(result.list) ? result.list : []
        const list = rawList.map((item) => ({
          ...item,
          statusText: mapStatusText(item.status),
          statusClass: mapStatusClass(item.status),
          canCancel: canCancelBooking(item.status)
        }))
        this.setData({
          loading: false,
          list
        })
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "加载失败",
          icon: "none"
        })
        this.setData({
          loading: false,
          list: []
        })
      }
    })
  },

  handleViewDetail(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (!id) {
      return
    }

    const current = this.data.list.find((item) => item.id === id)

    wx.navigateTo({
      url: `/pages/booking-detail/booking-detail?id=${id}`,
      success: (res) => {
        if (current && res && res.eventChannel) {
          res.eventChannel.emit("acceptBookingDetail", {
            booking: current
          })
        }
      },
      fail: () => {
        wx.showToast({
          title: "页面跳转失败",
          icon: "none"
        })
      }
    })
  },

  handleCancel(event) {
    const id = String(event.currentTarget.dataset.id || "").trim()
    if (!id || this.data.loading) {
      return
    }

    wx.showModal({
      title: "取消预约",
      content: "已完成的预约不可取消。确认取消当前预约吗？",
      success: (res) => {
        if (!res.confirm) {
          return
        }

        this.cancelBooking(id)
      }
    })
  },

  cancelBooking(id) {
    this.setData({
      loading: true
    })

    wx.cloud.callFunction({
      name: "bookingCancel",
      data: { id },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "取消失败",
            icon: "none"
          })
          this.setData({
            loading: false
          })
          return
        }

        wx.showToast({
          title: "预约已取消",
          icon: "none"
        })
        this.loadList()
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "取消失败",
          icon: "none"
        })
        this.setData({
          loading: false
        })
      }
    })
  },

  handleBackGarage() {
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
