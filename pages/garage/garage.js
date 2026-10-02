const { trackEvent } = require("../../shared/analytics")
const { sanitizeAttribution, buildQuery, hasAttribution, isShareLanding } = require("../../shared/contentAttribution")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const { requestCloudRead } = require("../../shared/cloudReadRequest")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const { preloadImages, clearExpiredCache } = require("../../shared/imageCache")
const { onNetworkReconnect } = require("../../shared/networkStatus")
const { triggerHapticFeedback } = require("../../shared/hapticFeedback")
const { createPerformanceHelpers } = require("../../shared/performance")
const {
  CATEGORY_LABEL_MAP: BASE_CATEGORY_LABEL_MAP,
  CLIENT_VEHICLE_STATUS_TEXT_MAP,
  CLIENT_VEHICLE_STATUS_CLASS_MAP
} = require("../../shared/vehicleLabels")
const mockCategories = require("../../data/categories")

const DEFAULT_GARAGE_SUBTITLE = "甄选座驾，为每一次出发预留专属席位"
const GARAGE_LOAD_TIMEOUT_MS = 15 * 1000
const SEARCH_DEBOUNCE_MS = 250
const SNAPSHOT_MAX_AGE_MS = 60 * 1000

function garageQueryKey(filters) {
  return JSON.stringify([
    filters.category || "all", filters.city || "", filters.keyword || "",
    filters.availableOnly === true, filters.sortBy || "default"
  ])
}

const CATEGORY_LABEL_MAP = Object.assign({}, BASE_CATEGORY_LABEL_MAP)

mockCategories.forEach((item) => {
  CATEGORY_LABEL_MAP[item.id] = item.name
})

function normalizeGarageStatus(status) {
  const value = String(status || "").trim()
  if (value === "idle" || value === "available") {
    return "idle"
  }
  if (value === "active" || value === "rented") {
    return "active"
  }
  if (value === "maintenance") {
    return "maintenance"
  }
  if (value === "reserved") {
    return "reserved"
  }
  return "idle"
}

function getStatusText(status, fallbackText) {
  const normalizedStatus = normalizeGarageStatus(status)
  return CLIENT_VEHICLE_STATUS_TEXT_MAP[normalizedStatus] || fallbackText || "可预约"
}

function normalizeGarageSubtitle(value, fallback) {
  const subtitle = String(value || "").trim()
  if (!subtitle) {
    return fallback || DEFAULT_GARAGE_SUBTITLE
  }

  return subtitle
}

function attachStatusClass(car) {
  const normalizedStatus = normalizeGarageStatus(car.status)
  return {
    ...car,
    garageStatus: normalizedStatus,
    statusText: getStatusText(car.status, car.statusText),
    statusClass: CLIENT_VEHICLE_STATUS_CLASS_MAP[normalizedStatus] || "status-idle"
  }
}

function sortCars(carList) {
  return carList
    .slice()
    .sort((prev, next) => {
      const prevSort = Number(prev.sort || 0)
      const nextSort = Number(next.sort || 0)
      if (prevSort > 1000000 || nextSort > 1000000) {
        return nextSort - prevSort
      }

      return prevSort - nextSort
    })
    .map(attachStatusClass)
}

function buildCategoriesWithCount(carList, serverCountMap) {
  const countMap = serverCountMap && typeof serverCountMap === "object" ? { ...serverCountMap } : {}

  if (!serverCountMap) carList.forEach((car) => {
    const categoryId = String(car.category || "").trim()
    if (!categoryId) {
      return
    }

    countMap[categoryId] = (countMap[categoryId] || 0) + 1
  })

  const baseCategories = mockCategories
    .map((item) => ({
      id: String(item && item.id ? item.id : "").trim(),
      name: String(item && item.name ? item.name : "").trim()
    }))
    .filter((item) => item.id)

  const baseCategoryIds = baseCategories.map((item) => item.id)

  const dynamicCategories = Object.keys(countMap)
    .filter((id) => id !== "all" && !baseCategoryIds.includes(id))
    .sort()
    .map((id) => ({
      id,
      name: CATEGORY_LABEL_MAP[id] || id,
      count: countMap[id]
    }))

  const mergedBase = baseCategories.map((item) => ({
    id: item.id,
    name: item.name || CATEGORY_LABEL_MAP[item.id] || item.id,
    count: countMap[item.id] || 0
  }))

  return [
    {
      id: "all",
      name: "全部",
      count: Number.isFinite(Number(countMap.all)) ? Number(countMap.all) : carList.length
    }
  ]
    .concat(mergedBase)
    .concat(dynamicCategories)
}

function buildCategorySummary(categoryId, categories, filteredCars) {
  const currentCategory = categories.find((category) => category.id === categoryId) || {}
  const availableCars = filteredCars.filter((car) => normalizeGarageStatus(car.status) === "idle").length

  return {
    name: currentCategory.name || "",
    total: filteredCars.length,
    available: availableCars
  }
}

function matchesCarSearch(car, keyword) {
  const query = String(keyword || "").trim().toLowerCase()
  if (!query) {
    return true
  }
  const source = car && typeof car === "object" ? car : {}
  const tags = Array.isArray(source.tags) ? source.tags : []
  const searchText = [
    source.name,
    source.nickname,
    source.brand,
    source.category,
    CATEGORY_LABEL_MAP[source.category],
    source.location,
    ...tags
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ")
  return searchText.includes(query)
}

function canLoadGarageRemotely() {
  return typeof wx !== "undefined" && wx.cloud && typeof wx.cloud.callFunction === "function"
}

function pickListCarFields(car) {
  if (!car || typeof car !== "object") {
    return car
  }
  const images = Array.isArray(car.images) ? car.images.slice(0, 4) : car.cover ? [car.cover] : []
  return {
    id: car.id,
    name: car.name,
    nickname: car.nickname,
    brand: car.brand,
    category: car.category,
    priceDay: Number(car.priceDay) || 0,
    priceText: car.priceText,
    status: car.status,
    statusText: car.statusText,
    location: car.location,
    tags: car.tags,
    cover: car.cover,
    coverPlaceholderText: car.coverPlaceholderText,
    sort: car.sort,
    images
  }
}

Page({
  data: {
    pageTitle: "极境车库",
    pageSubtitle: DEFAULT_GARAGE_SUBTITLE,
    emptyText: "当前分类暂无车辆，更多车型即将入库",
    loadError: false,
    loadErrorText: "车辆列表加载失败，请稍后重试",
    categorySummary: {
      name: "",
      total: 0,
      available: 0
    },
    servicePhone: "",
    currentCategory: "all",
    availableOnly: false,
    sortBy: "default",
    cityOptions: [],
    selectedCity: "",
    searchKeyword: "",
    searchResultCount: 0,
    searchDebouncing: false,
    categories: [],
    cars: [],
    filteredCars: [],
    initialLoading: true,
    loadingCars: false,
    page: 0,
    pageSize: 20,
    total: 0,
    truncated: false,
    hasMore: false,
    contentGuides: []
  },

  applyState(patch) { this.setData(patch) },

  _initStubSearchDebounce() {
    if (this._debouncedFilterSearch) return
    let timer = null
    const self = this
    const fn = function (keyword) {
      if (timer) clearTimeout(timer)
      timer = setTimeout(function () {
        timer = null
        self._runFilteredCarsSearch(keyword)
      }, 250)
    }
    fn.cancel = function () {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
    }
    this._debouncedFilterSearch = fn
  },

  onLoad(options) {
    activatePageNativeActions(this)
    const perf = createPerformanceHelpers(this)
    this._perf = perf
    this.applyState = perf.applyState
    this.flushStateNow = perf.flushStateNow
    this._debouncedFilterSearch = perf.debounce(
      (keyword) => {
        this._runFilteredCarsSearch(keyword)
      },
      SEARCH_DEBOUNCE_MS
    )
    trackEvent("garage_view")
    const attribution = sanitizeAttribution(options)
    if (hasAttribution(attribution) && attribution.channel && attribution.channel !== "direct" && isShareLanding()) {
      trackEvent("share_open", attribution.vehicleId, attribution)
    }
    const initCategory = String((options && options.category) || "").trim()
    const initCity = String((options && options.city) || "").trim()
    const initSortBy = String((options && options.sortBy) || "").trim()
    if (initCategory || initCity || initSortBy) {
      this.setData({
        currentCategory: initCategory || this.data.currentCategory,
        selectedCity: initCity || this.data.selectedCity,
        sortBy: initSortBy || this.data.sortBy
      })
    }
    const app = typeof getApp === "function" ? getApp() : null
    const env =
      app &&
      app.globalData &&
      app.globalData.cloudEnvId
        ? app.globalData.cloudEnvId
        : undefined

    if (typeof wx !== "undefined" && wx.cloud && typeof wx.cloud.init === "function") {
      try {
        wx.cloud.init({
          env,
          traceUser: true
        })
      } catch (error) {}
    }

    this._unsubscribeNetwork = onNetworkReconnect(() => {
      if (this.data.loadError) {
        this.loadCars()
      }
    })

    try {
      if (typeof wx !== "undefined" && typeof wx.getStorageSync === "function") {
        const snapshot = wx.getStorageSync("garage_last_snapshot")
        const filters = { category: this.data.currentCategory, city: this.data.selectedCity,
          keyword: this.data.searchKeyword, availableOnly: this.data.availableOnly, sortBy: this.data.sortBy }
        const age = snapshot && Date.now() - Number(snapshot.savedAt)
        if (snapshot && Array.isArray(snapshot.cars) && age >= 0 && age < SNAPSHOT_MAX_AGE_MS &&
            snapshot.filters && garageQueryKey(snapshot.filters) === garageQueryKey(filters)) {
          this.applyCars(snapshot.cars, snapshot.pagination, filters, { persist: false, savedAt: snapshot.savedAt })
        }
      }
    } catch (e) {}
  },

  onShow() {
    this.loadOperationConfig()
    const now = Date.now()
    const carsFresh =
      Boolean(this._lastCarsLoadedAt) &&
      now - this._lastCarsLoadedAt < 60 * 1000 &&
      Array.isArray(this.data.cars) &&
      this.data.cars.length > 0
    if (!carsFresh) {
      this.loadCars()
    }
    const guidesFresh =
      Boolean(this._lastGuidesLoadedAt) &&
      now - this._lastGuidesLoadedAt < 120 * 1000 &&
      Array.isArray(this.data.contentGuides) &&
      this.data.contentGuides.length > 0
    if (!guidesFresh) {
      this.loadContentGuides()
    }
    try { clearExpiredCache() } catch (e) {}
  },

  onPullDownRefresh() {
    if (this.data.loadingCars) {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh()
      }
      return
    }
    this.loadOperationConfig({ force: true })
    this.loadContentGuides()
    this.loadCars({
      force: true,
      done: () => {
        if (typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh()
        }
      }
    })
  },

  onReachBottom() {
    this.handleLoadMore()
  },

  loadContentGuides() {
    if (this._cancelContentGuidesRequest) this._cancelContentGuidesRequest()
    this._cancelContentGuidesRequest = requestCloudRead({
      name: "contentGuideList",
      data: { limit: 4 },
      onSuccess: (result) => {
        if (Array.isArray(result.list)) {
          this._lastGuidesLoadedAt = Date.now()
          this.setData({ contentGuides: result.list })
        }
      },
      onFailure: () => {
        this._lastGuidesLoadedAt = 0
        this.setData({ contentGuides: [] })
      }
    })
  },

  handleContentGuideTap(event) {
    const contentId = String(event.currentTarget.dataset.id || "").trim()
    const scene = String(event.currentTarget.dataset.scene || "").trim()
    if (!contentId) return
    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.navigateTo({
      url: `/pages/content-page/content-page?${buildQuery({ contentId, scene, channel: "direct" })}`,
      fail: () => {
        if (isPageNativeActionActive(this, action)) wx.showToast({ title: "场景指南打开失败", icon: "none" })
      }
    })
  },

  loadOperationConfig(options) {
    this.cancelOperationConfigRequest()
    this._cancelOperationConfigRequest = requestOperationConfig({
      force: Boolean(options && options.force),
      onSuccess: (config) => {
        const nextState = {
          pageTitle: config.garagePageTitle || this.data.pageTitle,
          pageSubtitle: normalizeGarageSubtitle(config.garagePageSubtitle, this.data.pageSubtitle),
          servicePhone: String(config.servicePhone || "").trim()
        }
        if (Array.isArray(config.cityOptions)) {
          nextState.cityOptions = config.cityOptions
        }
        const resetCity = Array.isArray(config.cityOptions) && this.data.selectedCity &&
          !config.cityOptions.includes(this.data.selectedCity)
        if (resetCity) nextState.selectedCity = ""
        this.applyState(nextState)
        if (resetCity) this.loadCars({ force: true, city: "" })
      },
      onFailure: () => {
        this.applyState({ servicePhone: "" })
      }
    })
  },

  finishCarsLoadEffects() {
    if (this._carsLoadTimer) {
      clearTimeout(this._carsLoadTimer)
      this._carsLoadTimer = null
    }
    if (typeof this._carsLoadDone === "function") {
      const done = this._carsLoadDone
      this._carsLoadDone = null
      try {
        done()
      } catch (error) {}
    }
  },

  loadCars(input) {
    const append = Boolean(input && input.append)
    const force = Boolean(input && input.force)
    const category = (input && input.category !== undefined) ? input.category : this.data.currentCategory
    const city = (input && input.city !== undefined) ? input.city : this.data.selectedCity
    const keyword = (input && input.keyword !== undefined) ? input.keyword : this.data.searchKeyword
    const availableOnly = (input && typeof input.availableOnly === "boolean") ? input.availableOnly : this.data.availableOnly
    const sortBy = (input && input.sortBy !== undefined) ? input.sortBy : (this.data.sortBy || "default")
    const nextPage = append ? this.data.page + 1 : 0
    if (this.data.loadingCars && !force) {
      if (input && typeof input.done === "function") {
        try { input.done() } catch (e) {}
      }
      return
    }

    if (force) {
      this.finishCarsLoadEffects()
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setCarsLoadError("云能力未初始化，请稍后重试")
      if (input && typeof input.done === "function") {
        try { input.done() } catch (e) {}
      }
      return
    }

    this._carsLoadDone = input && typeof input.done === "function" ? input.done : null
    this.applyState({
      loadingCars: true
    })

    const requestId = Number(this._carsRequestId || 0) + 1
    this._carsRequestId = requestId
    const feedbackAction = beginPageNativeAction(this, { requireCurrent: true })
    let settled = false
    const finishRequest = () => {
      if (settled || this._carsRequestId !== requestId) {
        return false
      }
      settled = true
      this.finishCarsLoadEffects()
      return true
    }

    this._carsLoadTimer = setTimeout(() => {
      if (!finishRequest()) {
        return
      }
      if (append) {
        this.applyState({ loadingCars: false })
        if (isPageNativeActionActive(this, feedbackAction)) wx.showToast({
          title: "加载超时，请重试",
          icon: "none"
        })
        return
      }
      this.setCarsLoadError("加载超时，请检查网络后重试")
    }, GARAGE_LOAD_TIMEOUT_MS)

    const handleFailure = (error) => {
      if (!finishRequest()) {
        return
      }
      if (append) {
        this.applyState({
          loadingCars: false
        })
        if (isPageNativeActionActive(this, feedbackAction)) wx.showToast({
          title: "加载更多失败",
          icon: "none"
        })
        return
      }
      this.setCarsLoadError((error && (error.errMsg || error.message)) || "车辆列表加载失败，请稍后重试")
    }

    const requestOptions = {
      name: "garageVehicleList",
      data: {
        page: nextPage,
        pageSize: this.data.pageSize,
        keyword,
        city,
        category,
        availableOnly,
        sortBy,
        refreshStats: force && !append,
        skipStats: append
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !Array.isArray(result.list)) {
          if (append) {
            this.applyState({ loadingCars: false })
            if (isPageNativeActionActive(this, feedbackAction)) wx.showToast({ title: "加载更多失败", icon: "none" })
            return
          }
          this.setCarsLoadError((result && result.message) || "车辆列表加载失败，请稍后重试")
          return
        }

        if (!append) this._lastCarsLoadedAt = Date.now()
        const nextCars = append ? this.data.cars.concat(result.list) : result.list
        const pagination = {
          ...(append ? this._carsPagination : {}),
          page: Number.isInteger(result.page) ? result.page : nextPage,
          hasMore: Boolean(result.hasMore)
        }
        for (const key of ["total", "searchedTotal", "categoryTotal", "availableCount"]) {
          if (result[key] !== undefined && Number.isFinite(Number(result[key]))) pagination[key] = Number(result[key])
        }
        if (!Number.isFinite(pagination.total)) pagination.total = nextCars.length
        if (Object.prototype.hasOwnProperty.call(result, "truncated")) pagination.truncated = Boolean(result.truncated)
        if (result.categoryCounts && typeof result.categoryCounts === "object") pagination.categoryCounts = result.categoryCounts
        this.applyCars(nextCars, pagination, {
          category,
          city,
          keyword,
          availableOnly,
          sortBy
        }, {
          savedAt: append ? this._carsSnapshotSavedAt : this._lastCarsLoadedAt
        })
      },
      fail: handleFailure
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure(error)
    }
  },

  onUnload() {
    if (this._cancelContentGuidesRequest) this._cancelContentGuidesRequest()
    cancelPageNativeActions(this)
    this._carsRequestId = Number(this._carsRequestId || 0) + 1
    this.cancelOperationConfigRequest()
    this.finishCarsLoadEffects()
    if (this._carsLoadTimer) {
      clearTimeout(this._carsLoadTimer)
      this._carsLoadTimer = null
    }
    this.clearSearchDebounce()
    if (typeof this._unsubscribeNetwork === "function") {
      this._unsubscribeNetwork()
      this._unsubscribeNetwork = null
    }
    if (this._perf && typeof this._perf.dispose === "function") {
      try { this._perf.dispose() } catch (e) {}
      this._perf = null
    }
  },

  cancelOperationConfigRequest() {
    if (typeof this._cancelOperationConfigRequest === "function") {
      this._cancelOperationConfigRequest()
      this._cancelOperationConfigRequest = null
    }
  },

  clearSearchDebounce() {
    if (this._debouncedFilterSearch && typeof this._debouncedFilterSearch.cancel === "function") {
      try { this._debouncedFilterSearch.cancel() } catch (e) {}
    }
    if (!this._searchDebounceTimer) {
      return
    }
    clearTimeout(this._searchDebounceTimer)
    this._searchDebounceTimer = null
  },

  setCarsLoadError(message) {
    this._lastCarsLoadedAt = 0
    this.applyState({
      loadError: true,
      initialLoading: false,
      loadingCars: false,
      loadErrorText: String(message || "车辆列表加载失败，请稍后重试"),
      categories: [],
      cars: [],
      filteredCars: [],
      page: 0,
      total: 0,
      truncated: false,
      hasMore: false,
      categorySummary: {
        name: "",
        total: 0,
        available: 0
      }
    })
  },

  applyCars(carList, pagination, filterParams, options) {
    const uniqueCars = []
    const ids = new Set()
    ;(Array.isArray(carList) ? carList : []).forEach((car) => {
      const id = String((car && car.id) || "").trim()
      if (!id || ids.has(id)) {
        return
      }
      ids.add(id)
      uniqueCars.push(pickListCarFields(car))
    })
    const sortedCars = sortCars(uniqueCars)
    const categories = buildCategoriesWithCount(sortedCars, pagination && pagination.categoryCounts)
    const categoryIds = categories.map((item) => item.id)
    const params = filterParams && typeof filterParams === "object" ? filterParams : {}
    const requestedCategory = params.category !== undefined ? params.category : this.data.currentCategory
    const nextCategory = categoryIds.includes(requestedCategory) ? requestedCategory : "all"
    const nextPagination = pagination || {}
    const currentCategory = nextCategory
    const availableOnly = typeof params.availableOnly === "boolean" ? params.availableOnly : !!this.data.availableOnly
    const searchKeyword = typeof params.keyword === "string" ? params.keyword : (this.data.searchKeyword || "")
    const selectedCity = typeof params.city === "string" ? params.city : (this.data.selectedCity || "")
    const sortBy = typeof params.sortBy === "string" ? params.sortBy : (this.data.sortBy || "default")

    const categoryCars =
      currentCategory === "all"
        ? sortedCars
        : sortedCars.filter((car) => car.category === currentCategory)
    const statusCars = availableOnly
      ? categoryCars.filter((car) => normalizeGarageStatus(car.status) === "idle")
      : categoryCars
    const cityCars = selectedCity
      ? statusCars.filter((car) => String((car && car.location) || "").toLowerCase().includes(selectedCity.toLowerCase()))
      : statusCars
    let filteredCars = cityCars.filter((car) => matchesCarSearch(car, searchKeyword))
    if (sortBy === "price_asc") {
      filteredCars.sort((a, b) => (Number(a.priceDay) || 0) - (Number(b.priceDay) || 0))
    } else if (sortBy === "price_desc") {
      filteredCars.sort((a, b) => (Number(b.priceDay) || 0) - (Number(a.priceDay) || 0))
    }
    const serverSummary = nextPagination
    this._carsPagination = { ...nextPagination }
    this._carsSnapshotSavedAt = options && Number.isFinite(options.savedAt) ? options.savedAt : Date.now()

    const searchResultCount = serverSummary && Number.isFinite(serverSummary.total)
      ? serverSummary.total
      : filteredCars.length
    const categorySummary = serverSummary && Number.isFinite(serverSummary.categoryTotal)
      ? {
          name: (categories.find((item) => item.id === currentCategory) || {}).name || "",
          total: serverSummary.categoryTotal,
          available: Number.isFinite(serverSummary.availableCount) ? serverSummary.availableCount : 0
        }
      : buildCategorySummary(currentCategory, categories, selectedCity ? cityCars : categoryCars)

    this.applyState({
      loadError: false,
      initialLoading: false,
      loadingCars: false,
      categories,
      cars: sortedCars,
      filteredCars,
      currentCategory,
      availableOnly,
      selectedCity,
      searchKeyword,
      searchResultCount,
      sortBy,
      categorySummary,
      searchDebouncing: false,
      page: Number.isInteger(nextPagination.page) ? nextPagination.page : 0,
      total: nextPagination && "total" in nextPagination ? nextPagination.total : sortedCars.length,
      truncated: Boolean(nextPagination && nextPagination.truncated),
      hasMore: Boolean(nextPagination && nextPagination.hasMore)
    })

    const topCovers = sortedCars.slice(0, 6).map((c) => c.cover).filter(Boolean)
    if (topCovers.length) {
      try {
        preloadImages(topCovers, { priority: 30 })
      } catch (e) {}
    }
    if ((!options || options.persist !== false) && typeof wx !== "undefined" && typeof wx.setStorageSync === "function") {
      try {
        wx.setStorageSync("garage_last_snapshot", {
          cars: sortedCars,
          pagination: serverSummary,
          filters: { category: currentCategory, city: selectedCity, keyword: searchKeyword, availableOnly, sortBy },
          savedAt: this._carsSnapshotSavedAt
        })
      } catch (e) {}
    }
  },

  filterCars(categoryId, availableOnlyInput, searchKeywordInput, serverSummary, keepSearchDebouncing, selectedCityInput, sortByInput) {
    const nextCategory = categoryId || "all"
    const availableOnly =
      typeof availableOnlyInput === "boolean" ? availableOnlyInput : this.data.availableOnly
    const searchKeyword =
      typeof searchKeywordInput === "string" ? searchKeywordInput : this.data.searchKeyword
    const selectedCity =
      typeof selectedCityInput === "string" ? selectedCityInput : this.data.selectedCity
    const sortBy =
      typeof sortByInput === "string" ? sortByInput : (this.data.sortBy || "default")
    const categoryCars =
      nextCategory === "all"
        ? this.data.cars.slice()
        : this.data.cars.filter((car) => car.category === nextCategory)
    const statusCars = availableOnly
      ? categoryCars.filter((car) => normalizeGarageStatus(car.status) === "idle")
      : categoryCars
    const cityCars = selectedCity
      ? statusCars.filter((car) => String((car && car.location) || "").toLowerCase().includes(selectedCity.toLowerCase()))
      : statusCars
    const filteredCars = cityCars.filter((car) => matchesCarSearch(car, searchKeyword))
    let sortedCars = filteredCars.slice()
    if (sortBy === "price_asc") {
      sortedCars.sort((a, b) => (Number(a.priceDay) || 0) - (Number(b.priceDay) || 0))
    } else if (sortBy === "price_desc") {
      sortedCars.sort((a, b) => (Number(b.priceDay) || 0) - (Number(a.priceDay) || 0))
    }

    this.applyState({
      currentCategory: nextCategory,
      availableOnly,
      searchKeyword,
      selectedCity,
      sortBy,
      searchResultCount: serverSummary && Number.isFinite(serverSummary.total)
        ? serverSummary.total
        : sortedCars.length,
      filteredCars: sortedCars,
      categorySummary: serverSummary && Number.isFinite(serverSummary.categoryTotal)
        ? {
            name: (this.data.categories.find((item) => item.id === nextCategory) || {}).name || "",
            total: serverSummary.categoryTotal,
            available: Number.isFinite(serverSummary.availableCount) ? serverSummary.availableCount : 0
          }
        : buildCategorySummary(nextCategory, this.data.categories, selectedCity ? cityCars : categoryCars),
      searchDebouncing: keepSearchDebouncing ? Boolean(this.data.searchDebouncing) : false
    })
  },

  _runFilteredCarsSearch(keyword) {
    const resolvedKeyword = typeof keyword === "string" ? keyword : this.data.searchKeyword
    this.filterCars(this.data.currentCategory, this.data.availableOnly, resolvedKeyword, null, false, this.data.selectedCity, this.data.sortBy)
    if (canLoadGarageRemotely()) {
      this.setData({ searchDebouncing: false })
      this.loadCars({ force: true, keyword: resolvedKeyword, sortBy: this.data.sortBy })
    } else {
      this.applyState({ searchDebouncing: false })
    }
  },

  handleSearchInput(event) {
    const keyword = String((event.detail && event.detail.value) || "").slice(0, 50)
    // Invalidate immediately; a response during the debounce window belongs to
    // the previous query and must not replace the new input or its pagination.
    this._carsRequestId = Number(this._carsRequestId || 0) + 1
    this.finishCarsLoadEffects()
    this.applyState({
      loadingCars: false,
      searchKeyword: keyword,
      searchDebouncing: canLoadGarageRemotely()
    })
    this.filterCars(this.data.currentCategory, this.data.availableOnly, keyword, null, true, this.data.selectedCity, this.data.sortBy)
    this._initStubSearchDebounce()
    if (this._debouncedFilterSearch) {
      this._debouncedFilterSearch(keyword)
    }
  },

  handleSearchConfirm(event) {
    const value = event && event.detail && event.detail.value
    const keyword = String(value === undefined ? this.data.searchKeyword || "" : value).slice(0, 50)
    this.clearSearchDebounce()
    this._runFilteredCarsSearch(keyword)
  },

  handleClearSearch() {
    if (this.data.searchKeyword) {
      this.clearSearchDebounce()
      this.filterCars(this.data.currentCategory, this.data.availableOnly, "", null, false, this.data.selectedCity, this.data.sortBy)
      if (canLoadGarageRemotely()) {
        this.loadCars({ force: true, keyword: "", sortBy: this.data.sortBy })
      }
    }
  },

  handleCityFilterTap(event) {
    const city = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.city) || "").trim()
    const nextCity = city === this.data.selectedCity ? "" : city
    this.clearSearchDebounce()
    this.filterCars(this.data.currentCategory, this.data.availableOnly, this.data.searchKeyword, null, false, nextCity, this.data.sortBy)
    if (canLoadGarageRemotely()) {
      this.loadCars({ force: true, city: nextCity, sortBy: this.data.sortBy })
    }
  },

  handleCategoryTap(event) {
    const { categoryId } = event.currentTarget.dataset

    if (!categoryId || categoryId === this.data.currentCategory) {
      return
    }

    this.clearSearchDebounce()
    this.filterCars(categoryId, this.data.availableOnly, this.data.searchKeyword, null, false, this.data.selectedCity, this.data.sortBy)
    if (canLoadGarageRemotely()) {
      this.loadCars({ force: true, category: categoryId, sortBy: this.data.sortBy })
    }
  },

  handleAvailabilityFilterTap(event) {
    const mode = String(event.currentTarget.dataset.mode || "")
    const availableOnly = mode === "available"
    if (availableOnly === this.data.availableOnly) {
      return
    }
    this.clearSearchDebounce()
    this.filterCars(this.data.currentCategory, availableOnly, this.data.searchKeyword, null, false, this.data.selectedCity, this.data.sortBy)
    if (canLoadGarageRemotely()) {
      this.loadCars({ force: true, availableOnly, sortBy: this.data.sortBy })
    }
  },

  handleShowAllStatuses() {
    if (this.data.availableOnly) {
      this.clearSearchDebounce()
      this.filterCars(this.data.currentCategory, false, this.data.searchKeyword, null, false, this.data.selectedCity, this.data.sortBy)
      if (canLoadGarageRemotely()) {
        this.loadCars({ force: true, availableOnly: false, sortBy: this.data.sortBy })
      }
    }
  },

  handleSortChange(event) {
    const sort = String(event.currentTarget.dataset.sort || "default").trim()
    if (sort === this.data.sortBy) {
      return
    }
    triggerHapticFeedback("light")
    this.setData({ sortBy: sort })
    this.filterCars(
      this.data.currentCategory,
      this.data.availableOnly,
      this.data.searchKeyword,
      null,
      false,
      this.data.selectedCity,
      sort
    )
    if (canLoadGarageRemotely()) {
      this.loadCars({ force: true, sortBy: sort })
    }
  },

  handleLoadMore() {
    if (this.data.loadingCars || this.data.searchDebouncing || !this.data.hasMore) {
      return
    }

    this.loadCars({ append: true })
  },

  handleCarTap(event) {
    const detail = event.detail || {}
    const carId = detail.carId || event.currentTarget.dataset.carId

    if (!carId) {
      return
    }

    const findCar = (list) => {
      const arr = Array.isArray(list) ? list : []
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i]
        if (c && String(c.id || "") === String(carId)) return c
      }
      return null
    }
    const targetCar = findCar(this.data.filteredCars) || findCar(this.data.cars)
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
        } catch (e) {}
      }
      try {
        const app = typeof getApp === "function" ? getApp() : null
        if (app && app.globalData) {
          app.globalData._tempCarDetailPreview = targetCar
        }
      } catch (e) {}
    }

    const action = beginPageNativeAction(this, { requireCurrent: true })
    const cityParam = this.data.selectedCity ? `&city=${encodeURIComponent(this.data.selectedCity)}` : ""
    wx.navigateTo({
      url: `/pages/car-detail/car-detail?carId=${carId}${cityParam}`,
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

  handlePhoneCall() {
    const phone = String(this.data.servicePhone || "").trim()
    if (!phone) {
      wx.showToast({
        title: "客服电话暂不可用",
        icon: "none"
      })
      return
    }

    trackEvent("phone_call")

    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.makePhoneCall({
      phoneNumber: phone,
      fail: (error) => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        const message = error && (error.errMsg || error.message)
        if (message && String(message).includes("cancel")) {
          return
        }
        wx.showModal({
          title: "拨号失败",
          content: `请联系客服：${phone}`,
          confirmText: "知道了",
          confirmColor: "#528fff",
          showCancel: false
        })
      }
    })
  },

  handleRetryLoad() {
    if (this.data.loadingCars || this.data.searchDebouncing) {
      return
    }

    this.loadCars()
  },

  onShareAppMessage() {
    trackEvent("share")
    const params = ["channel=wechat_share"]
    if (this.data.currentCategory && this.data.currentCategory !== "all") params.push(`category=${encodeURIComponent(this.data.currentCategory)}`)
    if (this.data.selectedCity) params.push(`city=${encodeURIComponent(this.data.selectedCity)}`)
    if (this.data.sortBy && this.data.sortBy !== "default") params.push(`sortBy=${encodeURIComponent(this.data.sortBy)}`)
    return {
      title: "极境车库",
      path: `/pages/garage/garage?${params.join("&")}`
    }
  }
})
