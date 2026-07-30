Page({
  data: {
    initialLoading: true,
    loading: false,
    loadError: "",
    list: [],
    page: 0,
    pageSize: 10,
    hasMore: false,
    removingId: "",
    loadedOnce: false
  },

  onLoad() {
    this.fetchList()
  },

  onShow() {
    if (this.data.loadedOnce && !this.data.loading && !this.data.removingId) {
      this.fetchList()
    }
  },

  onPullDownRefresh() {
    this.fetchList({
      done: () => wx.stopPullDownRefresh()
    })
  },

  handleRetry() {
    this.fetchList()
  },

  handleLoadMore() {
    if (!this.data.loading && this.data.hasMore) {
      this.fetchList({ append: true })
    }
  },

  handleCarTap(event) {
    const detail = event.detail || {}
    const carId = String(detail.carId || "").trim()
    if (!carId) {
      return
    }
    wx.navigateTo({
      url: `/pages/car-detail/car-detail?carId=${carId}`
    })
  },

  handleRemove(event) {
    const vehicleId = String(event.currentTarget.dataset.id || "").trim()
    if (!vehicleId || this.data.removingId) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    this.setData({ removingId: vehicleId })
    wx.cloud.callFunction({
      name: "favoriteSet",
      data: {
        vehicleId,
        favorited: false
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          wx.showToast({
            title: (result && result.message) || "取消收藏失败",
            icon: "none"
          })
          return
        }
        this.setData({
          list: this.data.list.filter((item) => item.id !== vehicleId)
        })
        wx.showToast({
          title: "已取消收藏",
          icon: "success"
        })
      },
      fail: (error) => {
        wx.showToast({
          title: (error && (error.errMsg || error.message)) || "取消收藏失败",
          icon: "none"
        })
      },
      complete: () => {
        this.setData({ removingId: "" })
      }
    })
  },

  fetchList(options) {
    const input = options && typeof options === "object" ? options : {}
    const append = Boolean(input.append)
    const nextPage = append ? this.data.page + 1 : 0

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setData({
        initialLoading: false,
        loading: false,
        loadError: "云能力未初始化"
      })
      if (typeof input.done === "function") {
        input.done()
      }
      return
    }

    this.setData({
      loading: true,
      loadError: append ? this.data.loadError : ""
    })
    wx.cloud.callFunction({
      name: "favoriteMyList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({
            initialLoading: false,
            loading: false,
            loadedOnce: true,
            loadError: (result && result.message) || "收藏列表加载失败",
            list: append ? this.data.list : []
          })
          return
        }
        const list = Array.isArray(result.list) ? result.list : []
        this.setData({
          initialLoading: false,
          loading: false,
          loadedOnce: true,
          loadError: "",
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore),
          list: append ? this.data.list.concat(list) : list
        })
      },
      fail: (error) => {
        this.setData({
          initialLoading: false,
          loading: false,
          loadedOnce: true,
          loadError: (error && (error.errMsg || error.message)) || "收藏列表加载失败",
          list: append ? this.data.list : []
        })
      },
      complete: () => {
        if (typeof input.done === "function") {
          input.done()
        }
      }
    })
  }
})
