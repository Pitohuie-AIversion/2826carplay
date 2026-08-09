const { trackEvent } = require("../../shared/analytics")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const mockCategories = require("../../data/categories")

const DEFAULT_GARAGE_SUBTITLE = "甄选座驾，为每一次出发预留专属席位"
const LEGACY_GARAGE_SUBTITLE = "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页"
const GARAGE_LOAD_TIMEOUT_MS = 15 * 1000
const SEARCH_DEBOUNCE_MS = 350

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
    ...tags
  ]
    .map((value) => String(value || "").toLowerCase())
    .join(" ")
  return searchText.includes(query)
}

function canLoadGarageRemotely() {
  return typeof wx !== "undefined" && wx.cloud && typeof wx.cloud.callFunction === "function"
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
    hasMore: false
  },

  onLoad() {
    activatePageNativeActions(this)
    trackEvent("garage_view")
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
    this.loadCars()
  },

  loadOperationConfig() {
    this.cancelOperationConfigRequest()
    this._cancelOperationConfigRequest = requestOperationConfig({
      onSuccess: (config) => {
        this.setData({
          pageTitle: config.garagePageTitle || this.data.pageTitle,
          pageSubtitle: normalizeGarageSubtitle(config.garagePageSubtitle, this.data.pageSubtitle),
          servicePhone: config.servicePhone || this.data.servicePhone
        })
      }
    })
  },

  loadCars(input) {
    const append = Boolean(input && input.append)
    const force = Boolean(input && input.force)
    const nextPage = append ? this.data.page + 1 : 0
    if (this.data.loadingCars && !force) {
      return
    }

    if (force && this._carsLoadTimer) {
      clearTimeout(this._carsLoadTimer)
      this._carsLoadTimer = null
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      this.setCarsLoadError("云能力未初始化，请稍后重试")
      return
    }

    this.setData({
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
      if (this._carsLoadTimer) {
        clearTimeout(this._carsLoadTimer)
        this._carsLoadTimer = null
      }
      return true
    }

    this._carsLoadTimer = setTimeout(() => {
      if (!finishRequest()) {
        return
      }
      if (append) {
        this.setData({ loadingCars: false })
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
        this.setData({
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
        category: this.data.currentCategory,
        availableOnly: this.data.availableOnly
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
    if (this._carsLoadTimer) {
      clearTimeout(this._carsLoadTimer)
      this._carsLoadTimer = null
    }
    this.clearSearchDebounce()
  },

  cancelOperationConfigRequest() {
    if (typeof this._cancelOperationConfigRequest === "function") {
      this._cancelOperationConfigRequest()
      this._cancelOperationConfigRequest = null
    }
  },

  clearSearchDebounce() {
    if (!this._searchDebounceTimer) {
      return
    }
    clearTimeout(this._searchDebounceTimer)
    this._searchDebounceTimer = null
  },

  setCarsLoadError(message) {
    this.setData({
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
      uniqueCars.push(car)
    })
    const sortedCars = sortCars(uniqueCars)
    const categories = buildCategoriesWithCount(sortedCars, pagination && pagination.categoryCounts)
    const categoryIds = categories.map((item) => item.id)
    const nextCategory = categoryIds.includes(this.data.currentCategory) ? this.data.currentCategory : "all"

    this.setData({
      loadError: false,
      initialLoading: false,
      loadingCars: false,
      categories,
      cars: sortedCars,
      page: pagination && Number.isInteger(pagination.page) ? pagination.page : 0,
      total: pagination ? pagination.total : sortedCars.length,
      truncated: Boolean(pagination && pagination.truncated),
      hasMore: Boolean(pagination && pagination.hasMore)
    })

    this.filterCars(nextCategory, this.data.availableOnly, this.data.searchKeyword, pagination)
  },

  filterCars(categoryId, availableOnlyInput, searchKeywordInput, serverSummary) {
    const nextCategory = categoryId || "all"
    const availableOnly =
      typeof availableOnlyInput === "boolean" ? availableOnlyInput : this.data.availableOnly
    const searchKeyword =
      typeof searchKeywordInput === "string" ? searchKeywordInput : this.data.searchKeyword
    const categoryCars =
      nextCategory === "all"
        ? this.data.cars.slice()
        : this.data.cars.filter((car) => car.category === nextCategory)
    const statusCars = availableOnly
      ? categoryCars.filter((car) => normalizeGarageStatus(car.status) === "idle")
      : categoryCars
    const filteredCars = statusCars.filter((car) => matchesCarSearch(car, searchKeyword))

    this.setData({
      currentCategory: nextCategory,
      availableOnly,
      searchKeyword,
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
        : buildCategorySummary(nextCategory, this.data.categories, categoryCars),
      searchDebouncing: false
    })
  },

  handleSearchInput(event) {
    const keyword = String((event.detail && event.detail.value) || "").slice(0, 50)
    this.filterCars(this.data.currentCategory, this.data.availableOnly, keyword)
    if (!canLoadGarageRemotely()) {
      return
    }
    this.clearSearchDebounce()
    this.setData({
      searchKeyword: keyword,
      searchDebouncing: true
    })
    this._searchDebounceTimer = setTimeout(() => {
      this._searchDebounceTimer = null
      this.loadCars({ force: true })
    }, SEARCH_DEBOUNCE_MS)
  },

  handleClearSearch() {
    if (this.data.searchKeyword) {
      this.clearSearchDebounce()
      this.filterCars(this.data.currentCategory, this.data.availableOnly, "")
      if (canLoadGarageRemotely()) {
        this.loadCars({ force: true })
      }
    }
  },

  handleCategoryTap(event) {
    const { categoryId } = event.currentTarget.dataset

    if (!categoryId || categoryId === this.data.currentCategory) {
      return
    }

    this.clearSearchDebounce()
    this.filterCars(categoryId)
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
    this.filterCars(this.data.currentCategory, availableOnly)
    if (canLoadGarageRemotely()) {
      this.loadCars({ force: true })
    }
  },

  handleShowAllStatuses() {
    if (this.data.availableOnly) {
      this.clearSearchDebounce()
      this.filterCars(this.data.currentCategory, false)
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
      path: "/pages/garage/garage"
    }
  }
})
