const { formatToastTitle } = require("../../shared/uiFeedback")

function normalizeFavoriteCar(car) {
  const source = car && typeof car === "object" ? car : {}
  const status = String(source.status || "").trim()
  const statusMap = {
    idle: {
      status: "available",
      statusText: "可预约",
      statusClass: "status-available"
    },
    available: {
      status: "available",
      statusText: "可预约",
      statusClass: "status-available"
    },
    active: {
      status: "rented",
      statusText: "使用中",
      statusClass: "status-rented"
    },
    rented: {
      status: "rented",
      statusText: "使用中",
      statusClass: "status-rented"
    },
    maintenance: {
      status: "maintenance",
      statusText: "维护中",
      statusClass: "status-maintenance"
    },
    reserved: {
      status: "reserved",
      statusText: "已预约",
      statusClass: "status-reserved"
    }
  }
  const statusMeta = statusMap[status] || statusMap.idle

  return {
    ...source,
    ...statusMeta
  }
}

function buildFavoriteView(list, availableOnly) {
  const normalizedList = (Array.isArray(list) ? list : []).map(normalizeFavoriteCar)
  const availableCount = normalizedList.filter((item) => item.status === "available").length

  return {
    list: normalizedList,
    visibleList: availableOnly
      ? normalizedList.filter((item) => item.status === "available")
      : normalizedList,
    favoriteSummary: {
      total: normalizedList.length,
      available: availableCount
    }
  }
}

Page({
  data: {
    initialLoading: true,
    loading: false,
    loadError: "",
    list: [],
    visibleList: [],
    availableOnly: false,
    favoriteSummary: {
      total: 0,
      available: 0
    },
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

  handleFilterTap(event) {
    const mode = String(event.currentTarget.dataset.mode || "")
    const availableOnly = mode === "available"
    if (availableOnly === this.data.availableOnly) {
      return
    }

    this.applyFavoriteList(this.data.list, {
      availableOnly
    })
  },

  handleShowAll() {
    if (this.data.availableOnly) {
      this.applyFavoriteList(this.data.list, {
        availableOnly: false
      })
    }
  },

  handleBrowseGarage() {
    wx.navigateTo({
      url: "/pages/garage/garage",
      fail: () => {
        wx.showToast({
          title: "车库打开失败",
          icon: "none"
        })
      }
    })
  },

  handleCarTap(event) {
    const detail = event.detail || {}
    const carId = String(detail.carId || "").trim()
    if (!carId) {
      return
    }
    wx.navigateTo({
      url: `/pages/car-detail/car-detail?carId=${carId}`,
      fail: () => {
        wx.showToast({
          title: "车辆详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleRemove(event) {
    const vehicleId = String(event.currentTarget.dataset.id || "").trim()
    if (!vehicleId || this.data.removingId) {
      return
    }
    wx.showModal({
      title: "取消收藏",
      content: "确定将这辆车移出收藏吗？",
      confirmText: "确认取消",
      confirmColor: "#d46868",
      success: (res) => {
        if (res && res.confirm) {
          this.removeFavorite(vehicleId)
        }
      }
    })
  },

  removeFavorite(vehicleId) {
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
          title: formatToastTitle(result && result.message, "取消收藏失败"),
            icon: "none"
          })
          return
        }
        this.applyFavoriteList(this.data.list.filter((item) => item.id !== vehicleId), {
          availableOnly: this.data.availableOnly
        })
        wx.showToast({
          title: "已取消收藏",
          icon: "success"
        })
      },
      fail: (error) => {
        wx.showToast({
          title: "取消收藏失败",
          icon: "none"
        })
      },
      complete: () => {
        this.setData({ removingId: "" })
      }
    })
  },

  applyFavoriteList(list, options) {
    const input = options && typeof options === "object" ? options : {}
    const availableOnly =
      typeof input.availableOnly === "boolean" ? input.availableOnly : this.data.availableOnly
    const view = buildFavoriteView(list, availableOnly)
    const patch = {
      ...view,
      availableOnly
    }

    if (Number.isInteger(input.page)) {
      patch.page = input.page
    }
    if (typeof input.hasMore === "boolean") {
      patch.hasMore = input.hasMore
    }

    this.setData(patch)
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
          const nextList = append ? this.data.list : []
          this.setData({
            initialLoading: false,
            loading: false,
            loadedOnce: true,
            loadError: (result && result.message) || "收藏列表加载失败"
          })
          if (!append) {
            this.applyFavoriteList(nextList, {
              availableOnly: this.data.availableOnly,
              page: 0,
              hasMore: false
            })
          }
          return
        }
        const list = Array.isArray(result.list) ? result.list : []
        const nextList = append ? this.data.list.concat(list) : list
        this.applyFavoriteList(nextList, {
          availableOnly: this.data.availableOnly,
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore)
        })
        this.setData({
          initialLoading: false,
          loading: false,
          loadedOnce: true,
          loadError: ""
        })
      },
      fail: (error) => {
        this.setData({
          initialLoading: false,
          loading: false,
          loadedOnce: true,
          loadError: (error && (error.errMsg || error.message)) || "收藏列表加载失败"
        })
        if (!append) {
          this.applyFavoriteList([], {
            availableOnly: this.data.availableOnly,
            page: 0,
            hasMore: false
          })
        }
      },
      complete: () => {
        if (typeof input.done === "function") {
          input.done()
        }
      }
    })
  }
})
