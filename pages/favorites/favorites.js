const { formatToastTitle } = require("../../shared/uiFeedback")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const { preloadImages, resolveImage } = require("../../shared/imageCache")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const { normalizeFavoriteVehicleStatus } = require("../../shared/vehicleLabels")
const { triggerHapticFeedback } = require("../../shared/hapticFeedback")
const { handleAlbumSaveError } = require("../../shared/albumPermission")
const FAVORITES_LOAD_TIMEOUT_MS = 15 * 1000
const FAVORITE_MUTATION_TIMEOUT_MS = 12 * 1000

function normalizeFavoriteCar(car) {
  const source = car && typeof car === "object" ? car : {}
  const statusMeta = normalizeFavoriteVehicleStatus(source.status)

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
  } catch (error) {
    console.error("Failed to save favorite filter preference", error)
  }
}

function buildCompareState(car1, car2, diffOnly) {
  if (!car1 || !car2) {
    return { compareRows: [], compareHasNoDiff: false, compareDiffOnly: Boolean(diffOnly) }
  }

  const price1 = car1.priceText || (car1.priceDay ? `￥${car1.priceDay}/天` : "日租待确认")
  const price2 = car2.priceText || (car2.priceDay ? `￥${car2.priceDay}/天` : "日租待确认")

  const status1 = car1.statusText || "可预约"
  const status2 = car2.statusText || "可预约"

  const type1 = car1.vehicleType || car1.category || car1.typeText || "甄选座驾"
  const type2 = car2.vehicleType || car2.category || car2.typeText || "甄选座驾"

  const trans1 = car1.transmission || car1.nickname || "自动挡"
  const trans2 = car2.transmission || car2.nickname || "自动挡"

  const fuel1 = car1.fuelType || "燃油动力"
  const fuel2 = car2.fuelType || "燃油动力"

  const tags1 = Array.isArray(car1.tags) ? car1.tags : []
  const tags2 = Array.isArray(car2.tags) ? car2.tags : []

  const service1 = "爱迦车损无忧 · 管家交付"
  const service2 = "爱迦车损无忧 · 管家交付"

  const allRows = [
    {
      key: "price",
      label: "参考日租金",
      val1: price1,
      val2: price2,
      isDiff: price1 !== price2,
      type: "price"
    },
    {
      key: "status",
      label: "当前排期状态",
      val1: status1,
      val2: status2,
      val1Class: car1.statusClass || "status-available",
      val2Class: car2.statusClass || "status-available",
      isDiff: status1 !== status2,
      type: "status"
    },
    {
      key: "type",
      label: "车型分类",
      val1: type1,
      val2: type2,
      isDiff: type1 !== type2,
      type: "text"
    },
    {
      key: "transmission",
      label: "传动 / 排挡",
      val1: trans1,
      val2: trans2,
      isDiff: trans1 !== trans2,
      type: "text"
    },
    {
      key: "fuel",
      label: "动力能源",
      val1: fuel1,
      val2: fuel2,
      isDiff: fuel1 !== fuel2,
      type: "text"
    },
    {
      key: "tags",
      label: "特色亮点",
      tags1: tags1,
      tags2: tags2,
      isDiff: tags1.slice().sort().join(",") !== tags2.slice().sort().join(","),
      type: "tags"
    },
    {
      key: "service",
      label: "尊享服务保障",
      val1: service1,
      val2: service2,
      isDiff: service1 !== service2,
      type: "text"
    }
  ]

  const visibleRows = diffOnly ? allRows.filter((r) => r.isDiff) : allRows

  return {
    compareRows: visibleRows,
    compareHasNoDiff: Boolean(diffOnly && visibleRows.length === 0),
    compareDiffOnly: Boolean(diffOnly)
  }
}

function drawComparePosterRoundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.arcTo(x + width, y, x + width, y + r, r)
  ctx.lineTo(x + width, y + height - r)
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r)
  ctx.lineTo(x + r, y + height)
  ctx.arcTo(x, y + height, x, y + height - r, r)
  ctx.lineTo(x + r, y)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
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
    compareModalVisible: false,
    compareCars: [],
    compareDiffOnly: false,
    compareRows: [],
    compareHasNoDiff: false,
    comparePosterVisible: false,
    comparePosterGenerating: false,
    comparePosterImagePath: "",
    servicePhone: "",
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

  updateServicePhone(value) {
    const servicePhone = String(value || "").trim()
    if (servicePhone === this.data.servicePhone) return
    // A generated poster may still contain a contact number that was removed.
    if (this.data.comparePosterVisible) this.handleCloseComparePosterModal()
    this.setData({ servicePhone })
  },

  cancelOperationConfigRequest() {
    if (typeof this._cancelOperationConfigRequest === "function") {
      this._cancelOperationConfigRequest()
      this._cancelOperationConfigRequest = null
    }
  },

  loadOperationConfig(options) {
    this.cancelOperationConfigRequest()
    this._cancelOperationConfigRequest = requestOperationConfig({
      force: Boolean(options && options.force),
      onSuccess: (config) => {
        this.updateServicePhone(config.servicePhone)
      },
      onFailure: () => this.updateServicePhone(""),
      onInvalidated: () => this.updateServicePhone("")
    })
  },

  onLoad() {
    activatePageNativeActions(this)
    this.restoreFilterPreference()
    try {
      if (typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
        const snapshot = wx.getStorageSync("favorites_last_snapshot")
        if (Array.isArray(snapshot) && snapshot.length > 0) {
          this.applyFavoriteList(snapshot, {
            availableOnly: this.data.availableOnly,
            page: 0,
            hasMore: true
          })
          this.setData({ initialLoading: false, loadedOnce: true })
        }
      }
    } catch (e) {
      console.error("Failed to load favorites snapshot", e)
    }
    this.fetchList()
  },

  onReachBottom() {
    this.handleLoadMore()
  },

  onShow() {
    this.loadOperationConfig()
    if (this.data.comparePosterVisible && this.data.comparePosterGenerating) {
      this.handleCloseComparePosterModal()
    }
    if (
      this.data.loadedOnce &&
      !this.data.loading &&
      !this.data.removingId &&
      !this.data.undoingFavorite
    ) {
      this.fetchList()
    }
  },

  onHide() {
    this.cancelComparePosterGeneration()
  },

  onPullDownRefresh() {
    if (this.data.removingId || this.data.undoingFavorite) {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh()
      }
      return
    }
    this.loadOperationConfig({ force: true })
    this.fetchList({
      done: () => wx.stopPullDownRefresh()
    })
  },

  onUnload() {
    cancelPageNativeActions(this)
    this.cancelComparePosterGeneration()
    this.cancelOperationConfigRequest()
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
    const action = beginPageNativeAction(this, { requireCurrent: true })
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
    const targetCar =
      (this.data.visibleList || []).find((item) => String(item.id || "") === carId) ||
      (this.data.list || []).find((item) => String(item.id || "") === carId)
    if (targetCar) {
      const preloadUrls = []
      if (targetCar.cover) preloadUrls.push(targetCar.cover)
      if (Array.isArray(targetCar.images)) {
        targetCar.images.forEach((img) => {
          if (img && preloadUrls.indexOf(img) === -1) preloadUrls.push(img)
        })
      }
      if (preloadUrls.length) {
        try {
          preloadImages(preloadUrls.slice(0, 4), { priority: 90 })
        } catch (e) {
          console.error("Failed to preload images", e)
        }
      }
      try {
        const app = typeof getApp === "function" ? getApp() : null
        if (app && app.globalData) {
          app.globalData._tempCarDetailPreview = targetCar
        }
      } catch (e) {
        console.error("Failed to set global preview data", e)
      }
    }
    const action = beginPageNativeAction(this, { requireCurrent: true })
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

  handleOpenCompareModal() {
    const list = (this.data.visibleList && this.data.visibleList.length >= 2)
      ? this.data.visibleList
      : this.data.list
    if (!list || list.length < 2) {
      wx.showToast({
        title: "请至少收藏2辆车",
        icon: "none"
      })
      return
    }
    triggerHapticFeedback("light")
    const compareCars = [list[0], list[1]]
    const compareState = buildCompareState(compareCars[0], compareCars[1], false)
    this.setData({
      compareModalVisible: true,
      compareCars,
      ...compareState
    })
  },

  handleCloseCompareModal() {
    this.setData({ compareModalVisible: false })
  },

  handleToggleCompareDiffOnly() {
    const cars = this.data.compareCars || []
    if (cars.length < 2) return
    triggerHapticFeedback("selection")
    const nextDiffOnly = !this.data.compareDiffOnly
    const compareState = buildCompareState(cars[0], cars[1], nextDiffOnly)
    this.setData(compareState)
  },

  handleSwitchCompareCar(event) {
    const carId = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.carid) || "").trim()
    if (!carId) return
    const list = this.data.list || []
    const selected = list.find((c) => c.id === carId)
    if (!selected) return

    const compareCars = (this.data.compareCars || []).slice()
    if (compareCars.some((c) => c.id === carId)) {
      return
    }
    triggerHapticFeedback("selection")
    compareCars[1] = selected
    const compareState = buildCompareState(compareCars[0], compareCars[1], this.data.compareDiffOnly)
    this.setData({
      compareCars,
      ...compareState
    })
  },

  handleCompareCarDetail(event) {
    const carId = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id) || "").trim()
    if (!carId) return
    this.handleCloseCompareModal()
    this.handleCarTap({ detail: { carId } })
  },

  handleOpenComparePosterModal() {
    const cars = this.data.compareCars || []
    if (!cars || cars.length < 2) {
      wx.showToast({ title: "对比车辆不足2辆", icon: "none" })
      return
    }
    triggerHapticFeedback("light")
    this.cancelComparePosterGeneration()
    this.setData({
      comparePosterVisible: true,
      comparePosterGenerating: true,
      comparePosterImagePath: ""
    })
    if (this._comparePosterTimer) {
      clearTimeout(this._comparePosterTimer)
    }
    this._comparePosterTimer = setTimeout(() => {
      this._comparePosterTimer = null
      this.renderComparePoster()
    }, 80)
  },

  handleCloseComparePosterModal() {
    this.cancelComparePosterGeneration()
    this.setData({
      comparePosterVisible: false,
      comparePosterGenerating: false
    })
  },

  cancelComparePosterGeneration() {
    this._comparePosterRenderSerial = Number(this._comparePosterRenderSerial || 0) + 1
    this._comparePosterSaveTask = null
    if (this._comparePosterSaveTimer) clearTimeout(this._comparePosterSaveTimer)
    this._comparePosterSaveTimer = null
    if (this._comparePosterTimer) {
      clearTimeout(this._comparePosterTimer)
      this._comparePosterTimer = null
    }
    if (this._comparePosterSaveLoadingAction) {
      this._comparePosterSaveLoadingAction = null
      if (typeof wx !== "undefined" && typeof wx.hideLoading === "function") wx.hideLoading()
    }
  },

  async resolveComparePosterCover(src) {
    if (!src || typeof src !== "string") return ""
    if (src.startsWith("/assets/") || src.startsWith("wxfile://") || src.startsWith("http://tmp/")) {
      return src
    }
    try {
      const res = await resolveImage(src, { priority: 100 })
      if (res && res.localPath) {
        return res.localPath
      }
    } catch (e) {
      console.error("Failed to resolve image via cache", e)
    }

    if (typeof wx !== "undefined" && typeof wx.getImageInfo === "function") {
      try {
        const info = await new Promise((resolve, reject) => {
          wx.getImageInfo({ src, success: resolve, fail: reject })
        })
        if (info && info.path) {
          return info.path
        }
      } catch (e) {
        console.error("Failed to resolve image info", e)
      }
    }
    return src
  },

  renderComparePoster() {
    const action = beginPageNativeAction(this, { requireCurrent: true })
    const serial = Number(this._comparePosterRenderSerial || 0)
    const isActive = () => isPageNativeActionActive(this, action) &&
      Number(this._comparePosterRenderSerial || 0) === serial &&
      this.data.comparePosterVisible

    if (!isActive()) return

    if (typeof wx === "undefined" || !wx || typeof wx.createSelectorQuery !== "function") {
      this.fallbackRenderComparePoster(isActive)
      return
    }

    const query = wx.createSelectorQuery().in(this)
    query
      .select("#comparePosterCanvas")
      .fields({ node: true, size: true })
      .exec(async (res) => {
        if (!isActive()) return
        if (!res || !res[0] || !res[0].node) {
          this.fallbackRenderComparePoster(isActive)
          return
        }
        const canvas = res[0].node
        const ctx = canvas.getContext ? canvas.getContext("2d") : null
        if (!ctx) {
          this.fallbackRenderComparePoster(isActive)
          return
        }

        const width = 640
        const height = 1020
        const dpr = Math.min(2, (wx.getSystemInfoSync && wx.getSystemInfoSync().pixelRatio) || 2)
        canvas.width = width * dpr
        canvas.height = height * dpr
        if (typeof ctx.scale === "function") {
          ctx.scale(dpr, dpr)
        }

        // Background
        const bgGrad = ctx.createLinearGradient ? ctx.createLinearGradient(0, 0, 0, height) : null
        if (bgGrad) {
          bgGrad.addColorStop(0, "#131722")
          bgGrad.addColorStop(0.4, "#0D1016")
          bgGrad.addColorStop(1, "#080A0E")
          ctx.fillStyle = bgGrad
        } else {
          ctx.fillStyle = "#0D1016"
        }
        ctx.fillRect(0, 0, width, height)

        // Outer Frame
        ctx.strokeStyle = "rgba(208, 158, 90, 0.25)"
        ctx.lineWidth = 1
        drawComparePosterRoundedRect(ctx, 16, 16, width - 32, height - 32, 14)
        ctx.stroke()

        // Brand Pillar
        ctx.fillStyle = "#D09E5A"
        drawComparePosterRoundedRect(ctx, 36, 42, 5, 34, 2)
        ctx.fill()

        // Header Title
        ctx.fillStyle = "#E8C88B"
        ctx.font = "bold 21px sans-serif"
        ctx.fillText("爱迦租车 · 心仪双车深度对比", 50, 62)

        // Header Subtitle
        ctx.fillStyle = "#7E8B9E"
        ctx.font = "11px sans-serif"
        ctx.fillText("AIJIA CAR RENTAL BENCHMARK MATRIX", 50, 80)

        // Benchmark Badge
        ctx.fillStyle = "rgba(208, 158, 90, 0.12)"
        drawComparePosterRoundedRect(ctx, width - 156, 44, 120, 30, 15)
        ctx.fill()
        ctx.strokeStyle = "rgba(208, 158, 90, 0.35)"
        ctx.lineWidth = 1
        drawComparePosterRoundedRect(ctx, width - 156, 44, 120, 30, 15)
        ctx.stroke()
        ctx.fillStyle = "#E8C88B"
        ctx.font = "bold 12px sans-serif"
        ctx.fillText("尊享甄选对决", width - 132, 63)

        const cars = this.data.compareCars || []
        const car1 = cars[0] || {}
        const car2 = cars[1] || {}

        // Dual Car Cards
        const cardW = 266
        const cardH = 200
        const cardY = 104
        const card1X = 36
        const card2X = 338

        // Card 1
        ctx.fillStyle = "rgba(255, 255, 255, 0.03)"
        drawComparePosterRoundedRect(ctx, card1X, cardY, cardW, cardH, 12)
        ctx.fill()
        ctx.strokeStyle = "rgba(208, 158, 90, 0.2)"
        ctx.lineWidth = 1
        drawComparePosterRoundedRect(ctx, card1X, cardY, cardW, cardH, 12)
        ctx.stroke()

        // Card 2
        ctx.fillStyle = "rgba(255, 255, 255, 0.03)"
        drawComparePosterRoundedRect(ctx, card2X, cardY, cardW, cardH, 12)
        ctx.fill()
        ctx.strokeStyle = "rgba(208, 158, 90, 0.2)"
        ctx.lineWidth = 1
        drawComparePosterRoundedRect(ctx, card2X, cardY, cardW, cardH, 12)
        ctx.stroke()

        // Car 1 Info
        ctx.fillStyle = "#FFFFFF"
        ctx.font = "bold 15px sans-serif"
        ctx.fillText(String(car1.name || "车辆一").slice(0, 14), card1X + 16, cardY + 34)
        ctx.fillStyle = "#79D5A7"
        ctx.font = "11px sans-serif"
        ctx.fillText(car1.statusText || "可预约", card1X + 16, cardY + 56)
        ctx.fillStyle = "#38BDF8"
        ctx.font = "bold 15px sans-serif"
        ctx.fillText(car1.priceText || (car1.priceDay ? `￥${car1.priceDay}/天` : "日租待确认"), card1X + 16, cardY + 84)
        ctx.fillStyle = "#94A3B8"
        ctx.font = "11px sans-serif"
        ctx.fillText(`${car1.vehicleType || "甄选车型"} · ${car1.transmission || car1.nickname || "自动挡"}`, card1X + 16, cardY + 108)

        // Car 2 Info
        ctx.fillStyle = "#FFFFFF"
        ctx.font = "bold 15px sans-serif"
        ctx.fillText(String(car2.name || "车辆二").slice(0, 14), card2X + 16, cardY + 34)
        ctx.fillStyle = "#79D5A7"
        ctx.font = "11px sans-serif"
        ctx.fillText(car2.statusText || "可预约", card2X + 16, cardY + 56)
        ctx.fillStyle = "#38BDF8"
        ctx.font = "bold 15px sans-serif"
        ctx.fillText(car2.priceText || (car2.priceDay ? `￥${car2.priceDay}/天` : "日租待确认"), card2X + 16, cardY + 84)
        ctx.fillStyle = "#94A3B8"
        ctx.font = "11px sans-serif"
        ctx.fillText(`${car2.vehicleType || "甄选车型"} · ${car2.transmission || car2.nickname || "自动挡"}`, card2X + 16, cardY + 108)

        // VS Badge
        const vsX = width / 2
        const vsY = cardY + cardH / 2
        ctx.beginPath()
        ctx.arc(vsX, vsY, 18, 0, Math.PI * 2)
        ctx.fillStyle = "#1E2532"
        ctx.fill()
        ctx.strokeStyle = "rgba(230, 197, 135, 0.6)"
        ctx.lineWidth = 1.5
        ctx.stroke()
        ctx.fillStyle = "#F5DFB8"
        ctx.font = "bold 12px sans-serif"
        ctx.textAlign = "center"
        ctx.fillText("VS", vsX, vsY + 4)
        ctx.textAlign = "left"

        // Specifications Section
        const tableY = 328
        ctx.fillStyle = "#D09E5A"
        ctx.font = "bold 13px sans-serif"
        ctx.fillText("【参数并排对比】BENCHMARK SPECIFICATIONS", 36, tableY)

        const rows = buildCompareState(car1, car2, false).compareRows.slice(0, 6)
        let curRowY = tableY + 16
        const rowH = 46
        const tableW = width - 72

        rows.forEach((row, idx) => {
          if (idx % 2 === 1) {
            ctx.fillStyle = "rgba(255, 255, 255, 0.02)"
            ctx.fillRect(36, curRowY, tableW, rowH)
          }
          if (row.isDiff) {
            ctx.fillStyle = "rgba(230, 197, 135, 0.05)"
            ctx.fillRect(36, curRowY, tableW, rowH)
            ctx.fillStyle = "#D09E5A"
            ctx.fillRect(36, curRowY, 3, rowH)
          }

          // Label
          ctx.fillStyle = row.isDiff ? "#E8C88B" : "#8E9CAE"
          ctx.font = row.isDiff ? "bold 12px sans-serif" : "12px sans-serif"
          ctx.fillText(row.label + (row.isDiff ? " [异]" : ""), 48, curRowY + 28)

          // Val 1
          const v1 = row.type === "tags" ? (row.tags1 || []).slice(0, 2).join("、") || "尊享配置" : String(row.val1 || "—").slice(0, 16)
          ctx.fillStyle = row.isDiff ? "#FFFFFF" : "#CBD5E1"
          ctx.font = "12px sans-serif"
          ctx.fillText(v1, 226, curRowY + 28)

          // Val 2
          const v2 = row.type === "tags" ? (row.tags2 || []).slice(0, 2).join("、") || "尊享配置" : String(row.val2 || "—").slice(0, 16)
          ctx.fillStyle = row.isDiff ? "#FFFFFF" : "#CBD5E1"
          ctx.font = "12px sans-serif"
          ctx.fillText(v2, 436, curRowY + 28)

          curRowY += rowH
        })

        // Footer
        const footerY = 880
        ctx.strokeStyle = "rgba(255, 255, 255, 0.1)"
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(36, footerY)
        ctx.lineTo(width - 36, footerY)
        ctx.stroke()

        const phone = String(this.data.servicePhone || "爱迦管家专属通道").trim()
        ctx.fillStyle = "#E8C88B"
        ctx.font = "bold 13px sans-serif"
        ctx.fillText("专属管家服务专线 · " + phone, 36, footerY + 36)

        ctx.fillStyle = "#7E8B9E"
        ctx.font = "11px sans-serif"
        ctx.fillText("微信搜索【爱迦租车】小程序，尊享专属试驾与排期确认", 36, footerY + 58)

        // Seal Emblem
        const emblemSize = 60
        const emblemX = width - 36 - emblemSize
        const emblemY = footerY + 16
        ctx.fillStyle = "rgba(208, 158, 90, 0.12)"
        drawComparePosterRoundedRect(ctx, emblemX, emblemY, emblemSize, emblemSize, 12)
        ctx.fill()
        ctx.strokeStyle = "rgba(208, 158, 90, 0.35)"
        ctx.lineWidth = 1
        drawComparePosterRoundedRect(ctx, emblemX, emblemY, emblemSize, emblemSize, 12)
        ctx.stroke()
        ctx.fillStyle = "#E8C88B"
        ctx.font = "bold 12px sans-serif"
        ctx.textAlign = "center"
        ctx.fillText("爱迦", emblemX + emblemSize / 2, emblemY + 26)
        ctx.fillText("租车", emblemX + emblemSize / 2, emblemY + 46)
        ctx.textAlign = "left"

        if (!isActive()) return
        if (typeof wx.canvasToTempFilePath === "function") {
          wx.canvasToTempFilePath({
            canvas,
            fileType: "png",
            quality: 1,
            success: (tempRes) => {
              if (!isPageNativeActionActive(this, action) || !isActive()) return
              this.setData({
                comparePosterImagePath: tempRes.tempFilePath,
                comparePosterGenerating: false
              })
            },
            fail: () => {
              this.fallbackRenderComparePoster(isActive)
            }
          })
        } else {
          this.fallbackRenderComparePoster(isActive)
        }
      })
  },

  fallbackRenderComparePoster(isActive) {
    if (typeof isActive === "function" && !isActive()) return
    this.setData({
      comparePosterGenerating: false,
      comparePosterImagePath: "/assets/icons/jijing-garage-emblem.png"
    })
  },

  async handleSaveComparePoster() {
    if (this._comparePosterSaveTask) return
    const action = beginPageNativeAction(this, { requireCurrent: true, exclusiveKey: "compare-poster-save" })
    const serial = Number(this._comparePosterRenderSerial || 0)
    const isActive = () => isPageNativeActionActive(this, action) &&
      Number(this._comparePosterRenderSerial || 0) === serial &&
      this.data.comparePosterVisible
    if (!isActive()) return
    const filePath = this.data.comparePosterImagePath
    if (!filePath) {
      wx.showToast({ title: "海报生成中", icon: "none" })
      return
    }
    const saveTask = {}
    this._comparePosterSaveTask = saveTask
    const finishSave = () => {
      if (this._comparePosterSaveTask !== saveTask) return false
      this._comparePosterSaveTask = null
      if (this._comparePosterSaveTimer) clearTimeout(this._comparePosterSaveTimer)
      this._comparePosterSaveTimer = null
      return isActive()
    }
    const handleFailure = (error) => {
      if (finishSave()) handleAlbumSaveError(this, error, isActive)
    }
    this._comparePosterSaveTimer = setTimeout(() => {
      if (finishSave()) wx.showToast({ title: "保存未确认，请重试", icon: "none" })
    }, 60000)

    if (typeof wx.saveImageToPhotosAlbum === "function") {
      try {
        wx.saveImageToPhotosAlbum({
          filePath,
          success: () => {
            if (finishSave()) {
              triggerHapticFeedback("medium")
              wx.showToast({ title: "海报已保存相册", icon: "success" })
              this.handleCloseComparePosterModal()
            }
          },
          fail: handleFailure
        })
      } catch (error) { handleFailure(error) }
    } else {
      finishSave()
      wx.showToast({ title: "系统暂不支持", icon: "none" })
    }
  },

  handleCallConsultant() {
    const cars = this.data.compareCars || []
    if (!cars.length) return
    triggerHapticFeedback("light")
    const car1 = cars[0]
    const car2 = cars[1] || {}
    const c1Name = car1.name || "车型一"
    const c2Name = car2.name || "车型二"
    const inquiryText = `【爱迦租车 · 心仪车型对比咨询】\n您好专属管家，我在小程序心仪对比中看中了：\n1. ${c1Name} (${car1.priceText || "待核价"})\n2. ${c2Name} (${car2.priceText || "待核价"})\n想了解这两款车近期的排期与尊享租赁方案。`

    let action = beginPageNativeAction(this, { requireCurrent: true, exclusiveKey: "copy-inquiry" })
    if (typeof wx.setClipboardData === "function") {
      wx.setClipboardData({
        data: inquiryText,
        success: () => {
          if (isPageNativeActionActive(this, action)) {
            wx.showToast({ title: "已复制咨询详情", icon: "none" })
          }
        },
        fail: () => {}
      })
    }

    const phone = String(this.data.servicePhone || "").trim()
    if (!phone) {
      wx.showModal({
        title: "已复制对比咨询内容",
        content: `对比车型已复制到剪贴板，暂未配置管家电话，您可直接粘贴发给微信客服或顾问：\n${c1Name} vs ${c2Name}`,
        confirmText: "知道了",
        confirmColor: "#528fff",
        showCancel: false
      })
      return
    }

    action = beginPageNativeAction(this, { requireCurrent: true, exclusiveKey: "consultant-call" })
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: (error) => {
        if (!isPageNativeActionActive(this, action) || String(this.data.servicePhone || "").trim() !== phone) return
        const message = error && (error.errMsg || error.message)
        if (message && String(message).includes("cancel")) return
        wx.showModal({
          title: "拨号未完成",
          content: `已复制咨询内容，请联系专属管家电话：${phone}`,
          confirmText: "知道了",
          confirmColor: "#528fff",
          showCancel: false
        })
      }
    })
  },

  handleCopyComparison() {
    const cars = this.data.compareCars || []
    if (!cars.length) return
    triggerHapticFeedback("light")
    const c1 = cars[0] || {}
    const c2 = cars[1] || {}
    const diffState = buildCompareState(c1, c2, false)
    const diffRows = diffState.compareRows.filter((r) => r.isDiff)

    const lines = ["【爱迦租车 · 心仪车型深度对比】"]
    lines.push(`▶ 对比车型：${c1.name || "车型一"} VS ${c2.name || "车型二"}`)
    lines.push(`1. ${c1.name}：${c1.priceText || "日租待确认"} | ${c1.statusText || "可预约"} | ${c1.transmission || c1.nickname || "自动挡"}`)
    lines.push(`2. ${c2.name}：${c2.priceText || "日租待确认"} | ${c2.statusText || "可预约"} | ${c2.transmission || c2.nickname || "自动挡"}`)

    if (diffRows.length > 0) {
      lines.push("\n【关键差异亮点】")
      diffRows.forEach((r) => {
        const v1 = r.type === "tags" ? (r.tags1 || []).join("、") : r.val1
        const v2 = r.type === "tags" ? (r.tags2 || []).join("、") : r.val2
        lines.push(`• ${r.label}：${c1.name}「${v1}」 vs ${c2.name}「${v2}」`)
      })
    } else {
      lines.push("\n【参数对比】：两款车型在核心参数上高度一致，均为顶格甄选。")
    }

    const phone = String(this.data.servicePhone || "").trim()
    if (phone) {
      lines.push(`\n专属管家电话：${phone}`)
    }
    lines.push("更多车型与排期请在微信搜索【爱迦租车】小程序查看。")

    const text = lines.join("\n")
    const action = beginPageNativeAction(this, { requireCurrent: true, exclusiveKey: "copy-compare-list" })
    if (typeof wx.setClipboardData === "function") {
      wx.setClipboardData({
        data: text,
        success: () => {
          if (isPageNativeActionActive(this, action)) {
            wx.showToast({ title: "对比清单已复制", icon: "none" })
          }
        },
        fail: () => {}
      })
    }
  },

  handleRemove(event) {
    const vehicleId = String(event.currentTarget.dataset.id || "").trim()
    if (!vehicleId || this.data.loading || this.data.removingId || this.data.undoingFavorite) {
      return
    }
    const action = beginPageNativeAction(this, {
      requireCurrent: true,
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
    if (!targetVehicleId || this.data.loading || this.data.removingId || this.data.undoingFavorite) {
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
    const feedbackAction = beginPageNativeAction(this, { requireCurrent: true })
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
      if (isPageNativeActionActive(this, feedbackAction)) wx.showToast({
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
          if (isPageNativeActionActive(this, feedbackAction)) wx.showToast({
            title: formatToastTitle(result && result.message, "取消收藏失败"),
            icon: "none"
          })
          return
        }
        this.applyFavoriteList(this.data.list.filter((item) => item.id !== targetVehicleId), {
          availableOnly: this.data.availableOnly
        })
        this.invalidateFavoritePagination()
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
          this.startUndoFavoriteWindow()
        }
        if (isPageNativeActionActive(this, feedbackAction)) wx.showToast({
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
    if (!undo || !undo.car || this.data.undoingFavorite || this.data.removingId || this.data.loading) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({ title: "云能力未初始化", icon: "none" })
      return
    }

    const feedbackAction = beginPageNativeAction(this, { requireCurrent: true })
    const mutationSerial = Number(this._favoriteUndoSerial || 0) + 1
    const vehicleId = String(undo.car.id || "").trim()
    this._favoriteUndoSerial = mutationSerial
    this._favoritesRequestId = Number(this._favoritesRequestId || 0) + 1
    this.finishFavoritesLoadEffects()
    this.clearFavoriteUndoTimer()
    if (this._undoFavoriteTimer) {
      clearTimeout(this._undoFavoriteTimer)
      this._undoFavoriteTimer = null
    }
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
      this.startUndoFavoriteWindow()
      if (isPageNativeActionActive(this, feedbackAction)) wx.showToast({
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
          this.startUndoFavoriteWindow()
          if (isPageNativeActionActive(this, feedbackAction)) wx.showToast({
            title: formatToastTitle(result && result.message, "撤销失败"),
            icon: "none"
          })
          return
        }
        const nextList = this.data.list.filter((item) => item.id !== vehicleId)
        nextList.splice(Math.min(Math.max(Number(undo.index) || 0, 0), nextList.length), 0, undo.car)
        this.applyFavoriteList(nextList, { availableOnly: this.data.availableOnly })
        this.invalidateFavoritePagination()
        if (this._undoFavoriteTimer) {
          clearTimeout(this._undoFavoriteTimer)
          this._undoFavoriteTimer = null
        }
        this.setData({ undoFavorite: null, undoingFavorite: false })
        if (isPageNativeActionActive(this, feedbackAction)) wx.showToast({ title: "已恢复收藏", icon: "success" })
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

  startUndoFavoriteWindow() {
    if (this._undoFavoriteTimer) clearTimeout(this._undoFavoriteTimer)
    if (!this.data.undoFavorite) return
    this._undoFavoriteTimer = setTimeout(() => {
      this._undoFavoriteTimer = null
      this.setData({ undoFavorite: null })
    }, 5000)
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

  invalidateFavoritePagination() {
    // Removing or restoring a row shifts offset pages on the server. Refresh
    // from page zero before the next append so a boundary row cannot be skipped.
    this._favoritesPaginationDirty = true
    try {
      if (typeof wx.setStorageSync === "function") wx.setStorageSync("favorites_last_snapshot", this.data.list.slice(0, this.data.pageSize))
    } catch (error) {
      console.error("Failed to save favorites snapshot", error)
    }
  },

  fetchList(options) {
    const input = options && typeof options === "object" ? options : {}
    if (this.data.removingId || this.data.undoingFavorite) {
      if (typeof input.done === "function") input.done()
      return
    }
    const append = Boolean(input.append) && !this._favoritesPaginationDirty
    const nextPage = append ? this.data.page + 1 : 0
    const requestId = Number(this._favoritesRequestId || 0) + 1
    this._favoritesRequestId = requestId
    this.finishFavoritesLoadEffects()

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      if (!append) this._favoritesPaginationDirty = true
      this.setData({
        initialLoading: false,
        loading: false,
        loadedOnce: true,
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
      if (!append) this._favoritesPaginationDirty = true
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
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          handleFailure((result && result.message) || "收藏列表加载失败")
          return
        }
        if (!Array.isArray(result.list) || result.list.some((car) => !car || typeof car.id !== "string" || !car.id.trim())) {
          handleFailure("收藏列表数据异常，请重新加载")
          return
        }
        if (!finishRequest()) {
          return
        }
        const list = result.list
        const nextList = Array.from(new Map((append ? this.data.list.concat(list) : list).map((car) => [car.id, car])).values())
        this._favoritesPaginationDirty = false
        if (!append && typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
          try { wx.setStorageSync("favorites_last_snapshot", nextList) } catch (e) {
            console.error("Failed to save favorites snapshot on fetch", e)
          }
        }
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
  },

  onShareAppMessage() {
    return {
      title: "爱迦租车 · 心仪豪华座驾收藏",
      path: "/pages/favorites/favorites?channel=wechat_share"
    }
  },

  onShareTimeline() {
    return {
      title: "爱迦租车 · 心仪豪华座驾收藏",
      query: "channel=timeline_share"
    }
  }
})
