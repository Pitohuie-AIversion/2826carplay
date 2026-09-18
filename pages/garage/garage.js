const { trackEvent } = require("../../shared/analytics")
const { sanitizeAttribution, buildQuery, hasAttribution, isShareLanding } = require("../../shared/contentAttribution")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const { preloadImages, clearExpiredCache } = require("../../shared/imageCache")
const { createPerformanceHelpers } = require("../../shared/performance")
const mockCategories = require("../../data/categories")

const DEFAULT_GARAGE_SUBTITLE = "甄选座驾，为每一次出发预留专属席位"
const LEGACY_GARAGE_SUBTITLE = "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页"
const GARAGE_LOAD_TIMEOUT_MS = 15 * 1000
const SEARCH_DEBOUNCE_MS = 250

const CATEGORY_LABEL_MAP = {
  all: "全部",
  luxury_sedan: "豪华轿车",
  city_suv: "城市SUV",
  offroad: "硬派越野",
  supercar: "超级跑车",
  commuter_ev: "代步电车",
  pickup: "皮卡"
}

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
  const statusTextMap = {
    idle: "可预约",
    active: "使用中",
    maintenance: "维护中",
    reserved: "已预约"
  }

  return statusTextMap[normalizedStatus] || fallbackText || "可预约"
}

function normalizeGarageSubtitle(value, fallback) {
  const subtitle = String(value || "").trim()
  if (!subtitle || subtitle === LEGACY_GARAGE_SUBTITLE) {
    return fallback || DEFAULT_GARAGE_SUBTITLE
  }

  return subtitle
}

function attachStatusClass(car) {
  const normalizedStatus = normalizeGarageStatus(car.status)
  const statusClassMap = {
    idle: "status-idle",
    active: "status-active",
    maintenance: "status-maintenance",
    reserved: "status-reserved"
  }

  return {
    ...car,
    garageStatus: normalizedStatus,
    statusText: getStatusText(car.status, car.statusText),
    statusClass: statusClassMap[normalizedStatus] || "status-idle"
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
    .filter((id) => !baseCategoryIds.includes(id))
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
    servicePhone: "15715710090",
    currentCategory: "all",
    availableOnly: false,
    cityOptions: ["杭州", "上海"],
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
    this.loadOperationConfig()
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

  loadContentGuides() {
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") return
    wx.cloud.callFunction({
      name: "contentGuideList",
      data: { limit: 4 },
      success: (res) => {
        const result = res && res.result
        if (result && result.ok && Array.isArray(result.list)) {
          this._lastGuidesLoadedAt = Date.now()
          this.setData({ contentGuides: result.list })
        }
      }
    })
  },

  handleContentGuideTap(event) {
    const contentId = String(event.currentTarget.dataset.id || "").trim()
    const scene = String(event.currentTarget.dataset.scene || "").trim()
    if (!contentId) return
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages/content-page/content-page?${buildQuery({ contentId, scene, channel: "direct" })}`,
      fail: () => {
        if (isPageNativeActionActive(this, action)) wx.showToast({ title: "场景指南打开失败", icon: "none" })
      }
    })
  },

  loadOperationConfig() {
    this.cancelOperationConfigRequest()
    this._cancelOperationConfigRequest = requestOperationConfig({
      onSuccess: (config) => {
        const nextState = {
          pageTitle: config.garagePageTitle || this.data.pageTitle,
          pageSubtitle: normalizeGarageSubtitle(config.garagePageSubtitle, this.data.pageSubtitle),
          servicePhone: config.servicePhone || this.data.servicePhone
        }
        if (Array.isArray(config.cityOptions) && config.cityOptions.length) {
          nextState.cityOptions = config.cityOptions
        }
        this.applyState(nextState)
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
        wx.showToast({
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
        wx.showToast({
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
        keyword: this.data.searchKeyword,
        city: this.data.selectedCity,
        category: this.data.currentCategory,
        availableOnly: this.data.availableOnly,
        skipStats: append
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok || !Array.isArray(result.list)) {
          this.setCarsLoadError((result && result.message) || "车辆列表加载失败，请稍后重试")
          return
        }

        this._lastCarsLoadedAt = Date.now()
        const nextCars = append ? this.data.cars.concat(result.list) : result.list
        this.applyCars(nextCars, {
          page: Number.isInteger(result.page) ? result.page : nextPage,
          total: Number(result.total) || nextCars.length,
          truncated: Boolean(result.truncated),
          hasMore: Boolean(result.hasMore),
          searchedTotal: Number(result.searchedTotal),
          categoryTotal: Number(result.categoryTotal),
          availableCount: Number(result.availableCount),
          categoryCounts: result.categoryCounts
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
    cancelPageNativeActions(this)
    this._carsRequestId = Number(this._carsRequestId || 0) + 1
    this.cancelOperationConfigRequest()
    this.finishCarsLoadEffects()
    if (this._carsLoadTimer) {
      clearTimeout(this._carsLoadTimer)
      this._carsLoadTimer = null
    }
    this.clearSearchDebounce()
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

  applyCars(carList, pagination) {
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
    const nextCategory = categoryIds.includes(this.data.currentCategory) ? this.data.currentCategory : "all"
    const nextPagination = pagination || {}
    const currentCategory = nextCategory
    const availableOnly = typeof this.data.availableOnly === "boolean" ? this.data.availableOnly : false
    const searchKeyword = typeof this.data.searchKeyword === "string" ? this.data.searchKeyword : ""
    const selectedCity = typeof this.data.selectedCity === "string" ? this.data.selectedCity : ""

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
    const filteredCars = cityCars.filter((car) => matchesCarSearch(car, searchKeyword))
    const serverSummary = nextPagination

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
      categorySummary,
      searchDebouncing: false,
      page: Number.isInteger(nextPagination.page) ? nextPagination.page : 0,
      total: nextPagination && "total" in nextPagination ? nextPagination.total : sortedCars.length,
      truncated: Boolean(nextPagination && nextPagination.truncated),
      hasMore: Boolean(nextPagination && nextPagination.hasMore)
    })
  },

  filterCars(categoryId, availableOnlyInput, searchKeywordInput, serverSummary, keepSearchDebouncing, selectedCityInput) {
    const nextCategory = categoryId || "all"
    const availableOnly =
      typeof availableOnlyInput === "boolean" ? availableOnlyInput : this.data.availableOnly
    const searchKeyword =
      typeof searchKeywordInput === "string" ? searchKeywordInput : this.data.searchKeyword
    const selectedCity =
      typeof selectedCityInput === "string" ? selectedCityInput : this.data.selectedCity
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

    this.applyState({
      currentCategory: nextCategory,
      availableOnly,
      searchKeyword,
      selectedCity,
      searchResultCount: serverSummary && Number.isFinite(serverSummary.total)
        ? serverSummary.total
        : filteredCars.length,
      filteredCars,
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
    this.filterCars(this.data.currentCategory, this.data.availableOnly, resolvedKeyword, null, false, this.data.selectedCity)
    if (canLoadGarageRemotely()) {
      this.setData({ searchDebouncing: false })
      this.loadCars({ force: true })
    } else {
      this.applyState({ searchDebouncing: false })
    }
  },

  handleSearchInput(event) {
    const keyword = String((event.detail && event.detail.value) || "").slice(0, 50)
    this.applyState({
      searchKeyword: keyword,
      searchDebouncing: Boolean(keyword)
    })
    this.filterCars(this.data.currentCategory, this.data.availableOnly, keyword, null, true, this.data.selectedCity)
    this._initStubSearchDebounce()
    if (this._debouncedFilterSearch) {
      this._debouncedFilterSearch(keyword)
    }
  },

  handleClearSearch() {
    if (this.data.searchKeyword) {
      this.clearSearchDebounce()
      this.filterCars(this.data.currentCategory, this.data.availableOnly, "", null, false, this.data.selectedCity)
      if (canLoadGarageRemotely()) {
        this.loadCars({ force: true })
      }
    }
  },

  handleCityFilterTap(event) {
    const city = String((event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.city) || "").trim()
    const nextCity = city === this.data.selectedCity ? "" : city
    this.clearSearchDebounce()
    this.filterCars(this.data.currentCategory, this.data.availableOnly, this.data.searchKeyword, null, false, nextCity)
    if (canLoadGarageRemotely()) {
      this.loadCars({ force: true })
    }
  },

  handleCategoryTap(event) {
    const { categoryId } = event.currentTarget.dataset

    if (!categoryId || categoryId === this.data.currentCategory) {
      return
    }

    this.clearSearchDebounce()
    this.filterCars(categoryId, this.data.availableOnly, this.data.searchKeyword, null, false, this.data.selectedCity)
    if (canLoadGarageRemotely()) {
      this.loadCars({ force: true })
    }
  },

  handleAvailabilityFilterTap(event) {
    const mode = String(event.currentTarget.dataset.mode || "")
    const availableOnly = mode === "available"
    if (availableOnly === this.data.availableOnly) {
      return
    }
    this.clearSearchDebounce()
    this.filterCars(this.data.currentCategory, availableOnly, this.data.searchKeyword, null, false, this.data.selectedCity)
    if (canLoadGarageRemotely()) {
      this.loadCars({ force: true })
    }
  },

  handleShowAllStatuses() {
    if (this.data.availableOnly) {
      this.clearSearchDebounce()
      this.filterCars(this.data.currentCategory, false, this.data.searchKeyword, null, false, this.data.selectedCity)
      if (canLoadGarageRemotely()) {
        this.loadCars({ force: true })
      }
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
    return {
      title: "极境车库",
      path: `/pages/garage/garage?${buildQuery({ channel: "wechat_share" })}`
    }
  }
})
