const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const FAVORITES_LOAD_TIMEOUT_MS = 15 * 1000
const FAVORITE_MUTATION_TIMEOUT_MS = 12 * 1000

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

const FAVORITE_FILTER_STORAGE_KEY = "favorite_available_only_preference"

function getSavedFavoriteFilterPreference() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return false
  }
  try {
    return Boolean(wx.getStorageSync(FAVORITE_FILTER_STORAGE_KEY))
  } catch (error) {
    return false
  }
}

function saveFavoriteFilterPreference(availableOnly) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
    return
  }
  try {
    wx.setStorageSync(FAVORITE_FILTER_STORAGE_KEY, Boolean(availableOnly))
  } catch (error) {}
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
    undoFavorite: null,
    undoingFavorite: false,
    loadedOnce: false
  },

  restoreFilterPreference() {
    const saved = getSavedFavoriteFilterPreference()
    if (saved) {
      this.setData({
        availableOnly: true
      })
    }
  },

  onLoad() {
    activatePageNativeActions(this)
    this.restoreFilterPreference()
    this.fetchList()
  },

  onShow() {
    if (
      this.data.loadedOnce &&
      !this.data.loading &&
      !this.data.removingId &&
      !this.data.undoingFavorite
    ) {
      this.fetchList()
    }
  },

  onPullDownRefresh() {
    if (this.data.removingId || this.data.undoingFavorite) {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh()
      }
      return
    }
    this.fetchList({
      done: () => wx.stopPullDownRefresh()
    })
  },

  onUnload() {
    cancelPageNativeActions(this)
    this._favoritesRequestId = Number(this._favoritesRequestId || 0) + 1
    this._favoriteRemoveSerial = Number(this._favoriteRemoveSerial || 0) + 1
    this._favoriteUndoSerial = Number(this._favoriteUndoSerial || 0) + 1
    this.finishFavoritesLoadEffects()
    this.clearFavoriteRemoveTimer()
    this.clearFavoriteUndoTimer()
    if (this._undoFavoriteTimer) {
      clearTimeout(this._undoFavoriteTimer)
      this._undoFavoriteTimer = null
    }
  },

  handleRetry() {
    if (this.data.loading || this.data.removingId || this.data.undoingFavorite) {
      return
    }
    this.fetchList()
  },

  handleLoadMore() {
    if (
      !this.data.loading &&
      !this.data.removingId &&
      !this.data.undoingFavorite &&
      this.data.hasMore
    ) {
      this.fetchList({ append: true })
    }
  },

  handleFilterTap(event) {
    const mode = String(event.currentTarget.dataset.mode || "")
    const availableOnly = mode === "available"
    if (availableOnly === this.data.availableOnly) {
      return
    }

    saveFavoriteFilterPreference(availableOnly)
    this.applyFavoriteList(this.data.list, {
      availableOnly
    })
  },

  handleShowAll() {
    if (this.data.availableOnly) {
      saveFavoriteFilterPreference(false)
      this.applyFavoriteList(this.data.list, {
        availableOnly: false
      })
    }
  },

  handleBrowseGarage() {
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: "/pages/garage/garage",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
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
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages/car-detail/car-detail?carId=${carId}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "车辆详情打开失败",
          icon: "none"
        })
      }
    })
  },

  handleRemove(event) {
    const vehicleId = String(event.currentTarget.dataset.id || "").trim()
    if (!vehicleId || this.data.loading || this.data.removingId) {
      return
    }
    const action = beginPageNativeAction(this, {
      exclusiveKey: "favorite-remove-confirmation"
    })
    wx.showModal({
      title: "取消收藏",
      content: "确定将这辆车移出收藏吗？",
      confirmText: "确认取消",
      confirmColor: "#d46868",
      success: (res) => {
        if (isPageNativeActionActive(this, action) && res && res.confirm) {
          this.removeFavorite(vehicleId)
        }
      }
    })
  },

  removeFavorite(vehicleId) {
    const targetVehicleId = String(vehicleId || "").trim()
    if (!targetVehicleId || this.data.loading || this.data.removingId) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const removedIndex = this.data.list.findIndex((item) => item.id === targetVehicleId)
    const removedCar = removedIndex >= 0 ? this.data.list[removedIndex] : null
    const mutationSerial = Number(this._favoriteRemoveSerial || 0) + 1
    this._favoriteRemoveSerial = mutationSerial
    this._favoritesRequestId = Number(this._favoritesRequestId || 0) + 1
    this.finishFavoritesLoadEffects()
    this.clearFavoriteRemoveTimer()
    this.setData({ removingId: targetVehicleId, loading: false })

    let settled = false
    const finishRequest = () => {
      if (settled || mutationSerial !== this._favoriteRemoveSerial) {
        return false
      }
      settled = true
      this.clearFavoriteRemoveTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ removingId: "" })
      wx.showToast({
        title: formatToastTitle(message, "取消收藏失败"),
        icon: "none"
      })
    }

    this._favoriteRemoveTimer = setTimeout(() => {
      handleFailure("取消收藏超时，请重试")
    }, FAVORITE_MUTATION_TIMEOUT_MS)

    const requestOptions = {
      name: "favoriteSet",
      data: {
        vehicleId: targetVehicleId,
        favorited: false
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ removingId: "" })
          wx.showToast({
            title: formatToastTitle(result && result.message, "取消收藏失败"),
            icon: "none"
          })
          return
        }
        this.applyFavoriteList(this.data.list.filter((item) => item.id !== targetVehicleId), {
          availableOnly: this.data.availableOnly
        })
        if (this._undoFavoriteTimer) {
          clearTimeout(this._undoFavoriteTimer)
        }
        if (removedCar) {
          this.setData({
            undoFavorite: {
              car: removedCar,
              index: removedIndex
            }
          })
          this._undoFavoriteTimer = setTimeout(() => {
            this._undoFavoriteTimer = null
            this.setData({ undoFavorite: null })
          }, 5000)
        }
        wx.showToast({
          title: "已取消，可撤销",
          icon: "none"
        })
        this.setData({ removingId: "" })
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  handleUndoRemove() {
    const undo = this.data.undoFavorite
    if (!undo || !undo.car || this.data.undoingFavorite) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({ title: "云能力未初始化", icon: "none" })
      return
    }

    const mutationSerial = Number(this._favoriteUndoSerial || 0) + 1
    const vehicleId = String(undo.car.id || "").trim()
    this._favoriteUndoSerial = mutationSerial
    this._favoritesRequestId = Number(this._favoritesRequestId || 0) + 1
    this.finishFavoritesLoadEffects()
    this.clearFavoriteUndoTimer()
    this.setData({ undoingFavorite: true, loading: false })

    let settled = false
    const finishRequest = () => {
      if (settled || mutationSerial !== this._favoriteUndoSerial) {
        return false
      }
      settled = true
      this.clearFavoriteUndoTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ undoingFavorite: false })
      wx.showToast({
        title: formatToastTitle(message, "撤销失败"),
        icon: "none"
      })
    }

    this._favoriteUndoTimer = setTimeout(() => {
      handleFailure("撤销超时，请重试")
    }, FAVORITE_MUTATION_TIMEOUT_MS)

    const requestOptions = {
      name: "favoriteSet",
      data: {
        vehicleId,
        favorited: true
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ undoingFavorite: false })
          wx.showToast({
            title: formatToastTitle(result && result.message, "撤销失败"),
            icon: "none"
          })
          return
        }
        const nextList = this.data.list.filter((item) => item.id !== vehicleId)
        nextList.splice(Math.min(Math.max(Number(undo.index) || 0, 0), nextList.length), 0, undo.car)
        this.applyFavoriteList(nextList, { availableOnly: this.data.availableOnly })
        if (this._undoFavoriteTimer) {
          clearTimeout(this._undoFavoriteTimer)
          this._undoFavoriteTimer = null
        }
        this.setData({ undoFavorite: null, undoingFavorite: false })
        wx.showToast({ title: "已恢复收藏", icon: "success" })
      },
      fail: (error) => {
        handleFailure(error && (error.errMsg || error.message))
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error && (error.errMsg || error.message))
    }
  },

  clearFavoriteRemoveTimer() {
    if (!this._favoriteRemoveTimer) {
      return
    }
    clearTimeout(this._favoriteRemoveTimer)
    this._favoriteRemoveTimer = null
  },

  clearFavoriteUndoTimer() {
    if (!this._favoriteUndoTimer) {
      return
    }
    clearTimeout(this._favoriteUndoTimer)
    this._favoriteUndoTimer = null
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
    const requestId = Number(this._favoritesRequestId || 0) + 1
    this._favoritesRequestId = requestId
    this.finishFavoritesLoadEffects()

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

    this._favoritesLoadDone = typeof input.done === "function" ? input.done : null
    this.setData({
      loading: true,
      loadError: append ? this.data.loadError : ""
    })

    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._favoritesRequestId) {
        return false
      }
      settled = true
      this.finishFavoritesLoadEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({
        initialLoading: false,
        loading: false,
        loadedOnce: true,
        loadError: String(message || "收藏列表加载失败")
      })
      if (!append) {
        this.applyFavoriteList([], {
          availableOnly: this.data.availableOnly,
          page: 0,
          hasMore: false
        })
      }
    }

    this._favoritesLoadTimer = setTimeout(() => {
      handleFailure("收藏列表加载超时，请检查网络后重试")
    }, FAVORITES_LOAD_TIMEOUT_MS)

    const requestOptions = {
      name: "favoriteMyList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
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
        handleFailure((error && (error.errMsg || error.message)) || "收藏列表加载失败")
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure((error && (error.errMsg || error.message)) || "收藏列表加载失败")
    }
  },

  finishFavoritesLoadEffects() {
    if (this._favoritesLoadTimer) {
      clearTimeout(this._favoritesLoadTimer)
      this._favoritesLoadTimer = null
    }
    const done = this._favoritesLoadDone
    this._favoritesLoadDone = null
    if (typeof done === "function") {
      done()
    }
  }
})
