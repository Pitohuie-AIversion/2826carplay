const { trackEvent } = require("../../shared/analytics")
const { sanitizeAttribution, buildQuery, hasAttribution, isShareLanding } = require("../../shared/contentAttribution")
const { formatToastTitle } = require("../../shared/uiFeedback")
const { requestOperationConfig } = require("../../shared/operationConfigRequest")
const { onNetworkReconnect } = require("../../shared/networkStatus")
const { triggerHapticFeedback } = require("../../shared/hapticFeedback")
const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../../shared/pageNativeAction")
const {
  resolveImage,
  getCachedPath,
  preloadImages,
  isImageLoaded,
  markImageLoaded,
  unmarkImageLoaded
} = require("../../shared/imageCache")
const { openCustomerService, hasWxKfConfig } = require("../../shared/customerService")
const detailLoadedImagesCache = new Set()
const carDetailMemoryCache = new Map()
const CAR_DETAIL_LOAD_TIMEOUT_MS = 15 * 1000
const FAVORITE_STATUS_TIMEOUT_MS = 10 * 1000
const FAVORITE_UPDATE_TIMEOUT_MS = 12 * 1000
const DEFAULT_RENTAL_TERMS = {
  includedText: "基础日租仅包含车辆使用费，其他项目会在正式报价前单独列明。",
  protectionText: "基础保障内容根据车型与租期确认，不默认包含额外保障服务。",
  serviceFeeText: "如有车辆整备或门店服务费，将在报价明细中单独列示。",
  deliveryFeeText: "取送车服务及费用按城市、距离和时段确认，无该服务时不收费。",
  depositText: "车辆押金与违章押金的金额、支付方式和退还时间会在确认前明确告知。",
  cancellationText: "预约提交后可取消；顾问确认后的取消或改期规则以有效报价说明为准。",
  overtimeText: "超时用车费用按最终确认的计费规则执行，产生前由顾问说明。",
  energyText: "取还车油量或电量标准会在交付前确认，并以交接记录为准。",
  estimateDisclaimer: "页面价格为基础日租参考，不是正式报价，提交预约也不会自动锁定车辆。"
}

function normalizeRentalTerms(raw) {
  const input = raw && typeof raw === "object" ? raw : {}
  return Object.keys(DEFAULT_RENTAL_TERMS).reduce((result, key) => {
    result[key] = String(input[key] || "").trim() || DEFAULT_RENTAL_TERMS[key]
    return result
  }, {})
}

function buildPricingOverview(car, rentalTermsInput) {
  const source = car && typeof car === "object" ? car : {}
  const rentalTerms = normalizeRentalTerms(rentalTermsInput)
  const priceSummary = source.priceSummary && typeof source.priceSummary === "object"
    ? source.priceSummary
    : {}
  const priceDay = Number(source.priceDay)
  const hasBasePrice = priceSummary.hasBasePrice === true || (Number.isInteger(priceDay) && priceDay > 0)
  const baseDailyRate = Number(priceSummary.baseDailyRate) || (hasBasePrice ? priceDay : 0)

  return {
    hasBasePrice,
    baseDailyRateText: hasBasePrice
      ? String(priceSummary.baseDailyRateText || `￥${baseDailyRate}`)
      : "待顾问确认",
    billingUnit: String(priceSummary.billingUnit || "24小时"),
    estimateLabel: String(priceSummary.estimateLabel || "基础日租参考"),
    includedText: rentalTerms.includedText,
    feeItems: [
      { key: "protection", label: "保障说明", text: rentalTerms.protectionText },
      { key: "service", label: "服务费用", text: rentalTerms.serviceFeeText },
      { key: "delivery", label: "取送车费用", text: rentalTerms.deliveryFeeText }
    ],
    ruleItems: [
      { key: "deposit", label: "押金与退还", text: rentalTerms.depositText },
      { key: "cancellation", label: "取消与改期", text: rentalTerms.cancellationText },
      { key: "overtime", label: "超时用车", text: rentalTerms.overtimeText },
      { key: "energy", label: "油量或电量", text: rentalTerms.energyText }
    ],
    disclaimer: rentalTerms.estimateDisclaimer
  }
}

function getStatusText(status, fallbackText) {
  const statusTextMap = {
    available: "可预约",
    rented: "使用中",
    maintenance: "维护中",
    reserved: "已预约"
  }

  return statusTextMap[status] || fallbackText || "可预约"
}

function attachStatusClass(car) {
  const statusClassMap = {
    available: "status-available",
    rented: "status-rented",
    maintenance: "status-maintenance",
    reserved: "status-reserved"
  }

  return {
    ...car,
    statusText: getStatusText(car.status, car.statusText),
    statusClass: statusClassMap[car.status] || "status-available"
  }
}

function buildTrustArchiveView(input) {
  const source = input && typeof input === "object" ? input : {}
  const status = ["current", "pending", "stale", "missing"].includes(source.status)
    ? source.status
    : "missing"
  return {
    status,
    statusText: String(source.statusText || "资料缺失"),
    statusClass: `trust-status-${status}`,
    lastUpdatedDate: String(source.lastUpdatedDate || ""),
    lastUpdatedText: source.lastUpdatedDate ? `最近资料日期 ${source.lastUpdatedDate}` : "暂无有效更新日期",
    freshnessText: Number.isInteger(source.freshnessDays) ? `${source.freshnessDays} 天前更新` : "新鲜度待补充",
    missingCount: Number(source.missingCount) || 0,
    items: Array.isArray(source.items) ? source.items : []
  }
}

const PERFORMANCE_PRESETS = [
  { match: ["911", "gt3", "gt2"], acc: "3.4s", power: "450Ps", drive: "后置后驱 (RR)", torque: "530N·m", tags: ["水平对置 6 缸双涡轮", "Sport Chrono 弹射起步", "可调运动排气阀门", "PASM 主动悬挂系统"] },
  { match: ["718", "cayman", "boxster"], acc: "4.1s", power: "300Ps", drive: "中置后驱 (MR)", torque: "380N·m", tags: ["50:50 黄金中置配重", "动态变速箱支承", "运动排气系统", "PSM 动态稳定管理"] },
  { match: ["f8", "ferrari", "488"], acc: "2.9s", power: "720Ps", drive: "中置后驱 (MR)", torque: "770N·m", tags: ["3.9T V8 双涡轮引擎", "F1 赛道双离合变速箱", "侧滑角控制系统 SSC", "碳纤维运动方向盘"] },
  { match: ["m4", "m3", "m5", "m8"], acc: "3.5s", power: "510Ps", drive: "M xDrive 智能四驱", torque: "650N·m", tags: ["S58 双涡轮增压发动机", "M 专属排气声浪系统", "可调节制动脚感", "后驱漂移模式切换"] },
  { match: ["mustang", "野马", "5.0"], acc: "4.3s", power: "466Ps", drive: "后轮驱动 (RWD)", torque: "556N·m", tags: ["5.0L V8 自然吸气声浪", "主动声浪控制排气", "Line Lock 弹射暖胎", "MagneRide 避震系统"] },
  { match: ["mx-5", "miata"], acc: "6.5s", power: "184Ps", drive: "前中置后驱 (FMR)", torque: "205N·m", tags: ["轻量化 1.05 吨车身", "高转速自然吸气引擎", "一键手动软顶敞篷", "机械式限滑差速器 LSD"] },
  { match: ["mini", "cooper"], acc: "6.7s", power: "192Ps", drive: "前轮驱动 (FWD)", torque: "280N·m", tags: ["卡丁车级敏捷转向", "中置双出运动排气", "运动底盘调校", "MINI 驾控体验模式"] },
  { match: ["740", "s450", "a8", "panamera", "sedan"], acc: "5.6s", power: "340Ps", drive: "后轮驱动 / 智能四驱", torque: "450N·m", tags: ["双腔空气悬架系统", "静音电吸车门", "豪华环绕座舱音响", "后排头等舱舒享座椅"] },
  { match: ["suv", "g63", "cullinan", "urus"], acc: "3.8s", power: "585Ps", drive: "全时四驱 (AWD)", torque: "850N·m", tags: ["全地形自适应驾驶模式", "空气悬架底盘升降", "运动排气阀门控制", "前后桥电子差速锁"] }
]

function buildPerformanceHighlights(car) {
  const source = car && typeof car === "object" ? car : {}
  const rawPerf = source.performance && typeof source.performance === "object" ? source.performance : {}
  const target = `${source.name || ""} ${source.brand || ""} ${source.category || ""}`.toLowerCase()
  const matched = PERFORMANCE_PRESETS.find(item => item.match.some(key => target.includes(key)))

  const defaultAcc = (matched && matched.acc) || "4.2s"
  const defaultPower = (matched && matched.power) || "380Ps"
  const defaultDrivetrain = (matched && matched.drive) || "后轮驱动 (RWD)"
  const defaultTorque = (matched && matched.torque) || "500N·m"
  const defaultHighlights = (matched && matched.tags) || ["可变运动排气声浪", "专属驾控运动底盘", "驾驶模式自定义切换"]

  return {
    acceleration: String(rawPerf.acceleration || source.acceleration || defaultAcc),
    horsepower: String(rawPerf.horsepower || source.horsepower || defaultPower),
    drivetrain: String(rawPerf.drivetrain || source.drivetrain || defaultDrivetrain),
    torque: String(rawPerf.torque || source.torque || defaultTorque),
    highlights: Array.isArray(rawPerf.highlights) && rawPerf.highlights.length ? rawPerf.highlights : defaultHighlights
  }
}

function formatCarViewModel(car) {
  const transmissionMap = {
    manual: "手动挡",
    automatic: "自动挡",
    unknown: "—"
  }

  const fuelTypeMap = {
    gasoline: "燃油",
    electric: "纯电",
    hybrid: "混动",
    unknown: "—"
  }

  const statusNoticeMap = {
    available: "",
    reserved: "该车当前已被预约，可先提交咨询，由客服为您确认候补档期或推荐相近车型。",
    rented: "该车当前正在使用中，可先提交咨询，由客服为您确认可预约时间。",
    maintenance: "该车当前维护中，可先提交咨询，由客服为您确认恢复时间或推荐相近车型。"
  }

  const primaryActionTextMap = {
    available: "立即预约",
    reserved: "咨询候补",
    rented: "咨询档期",
    maintenance: "咨询恢复时间"
  }

  const actionHintMap = {
    available: "提交意向后，由顾问确认档期、价格与服务规则",
    reserved: "可先登记候补意向，由顾问协助确认档期",
    rented: "可先咨询后续档期，由顾问联系确认时间",
    maintenance: "可先咨询恢复时间或获取相近车型推荐"
  }

  const statusCar = attachStatusClass(car)
  const images = Array.isArray(car.images) && car.images.length ? car.images : car.cover ? [car.cover] : []
  const imageItems = images.map((src, index) => {
    const displaySrc = getCachedPath(src)
    const isAlreadyLoaded =
      isImageLoaded(src) ||
      (displaySrc && isImageLoaded(displaySrc)) ||
      detailLoadedImagesCache.has(src) ||
      detailLoadedImagesCache.has(displaySrc)
    return {
      key: `vehicle-image-${index}`,
      src,
      displaySrc,
      loaded: Boolean(isAlreadyLoaded),
      failed: false
    }
  })

  return {
    ...statusCar,
    images,
    imageItems,
    hasImages: images.length > 0,
    statusNoticeText: statusNoticeMap[car.status] || "",
    primaryActionText: primaryActionTextMap[car.status] || "立即预约",
    actionHintText:
      actionHintMap[car.status] || "提交意向后，由顾问确认档期、价格与服务规则",
    transmissionText: transmissionMap[car.transmission] || car.transmission || "—",
    fuelTypeText: fuelTypeMap[car.fuelType] || car.fuelType || "—",
    seatsText: car.seatsText || (car.seats ? `${car.seats} 座` : "—"),
    brand: car.brand || "未知品牌",
    location: car.location || "门店咨询",
    performance: buildPerformanceHighlights(car),
    trustArchive: buildTrustArchiveView(car.trustArchive),
    vehicleYear: car.vehicleYear || (car.registerDate ? String(car.registerDate).slice(0, 4) : "—")
  }
}

Page({
  data: {
    brandName: "极境车库",
    servicePhone: "15715710090",
    wxKfReady: false,
    rentalTerms: normalizeRentalTerms(),
    pricingOverview: buildPricingOverview(null, DEFAULT_RENTAL_TERMS),
    pricingExpanded: false,
    rulesExpanded: false,
    trustExpanded: false,
    carId: "",
    car: null,
    relatedGuides: [],
    attribution: { channel: "", scene: "", contentId: "", vehicleId: "" },
    currentImageIndex: 0,
    favoriteLoading: false,
    favorited: false,
    loading: true,
    loadError: false,
    loadErrorText: "车辆详情加载失败，请返回车库后重试",
    notFoundText: "未找到该车辆，请返回车库重新选择",
    serviceSteps: [
      { key: "request", index: "01", title: "提交意向", desc: "填写日期与联系方式" },
      { key: "confirm", index: "02", title: "顾问确认", desc: "核对档期、价格和规则" },
      { key: "delivery", index: "03", title: "安排交付", desc: "确认取还车时间与方式" }
    ],
    posterModalVisible: false,
    posterGenerating: false,
    posterImagePath: ""
  },

  onLoad(options) {
    activatePageNativeActions(this)
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

    const attribution = sanitizeAttribution(options)
    const carId = attribution.vehicleId || String((options && options.carId) || "").trim()
    this._initialCity = String((options && options.city) || "").trim()
    this.setData({
      carId,
      attribution: sanitizeAttribution({ ...attribution, vehicleId: carId })
    })

    try {
      const previewCar = app && app.globalData ? app.globalData._tempCarDetailPreview : null
      if (previewCar && String(previewCar.id || "") === String(carId)) {
        app.globalData._tempCarDetailPreview = null
        this.applyCar(previewCar)
      }
    } catch (e) {}

    this.loadOperationConfig()
    this.loadCarDetail(carId)
    this.loadFavoriteStatus(carId)
    trackEvent("vehicle_detail", carId)
    if (hasAttribution(attribution) && attribution.channel && attribution.channel !== "direct" && isShareLanding()) {
      trackEvent("share_open", carId, this.data.attribution)
    }

    this._unsubscribeNetwork = onNetworkReconnect(() => {
      if (this.data.loadError && this.data.carId) {
        this.loadCarDetail(this.data.carId)
        this.loadFavoriteStatus(this.data.carId)
      }
    })
  },

  onReady() {
    if (this.data.carId) {
      this.loadRelatedGuides(this.data.carId)
    }
  },

  onPullDownRefresh() {
    if (this.data.loading || this.data.favoriteLoading || this.data.posterGenerating) {
      if (typeof wx.stopPullDownRefresh === "function") {
        wx.stopPullDownRefresh()
      }
      return
    }
    this.loadOperationConfig()
    if (this.data.carId) {
      this.loadFavoriteStatus(this.data.carId)
      this.loadRelatedGuides(this.data.carId)
    }
    this.loadCarDetail(this.data.carId, {
      done: () => {
        if (typeof wx.stopPullDownRefresh === "function") {
          wx.stopPullDownRefresh()
        }
      }
    })
  },

  loadRelatedGuides(vehicleId) {
    if (!vehicleId || !wx.cloud || typeof wx.cloud.callFunction !== "function") return
    wx.cloud.callFunction({
      name: "contentGuideList",
      data: { vehicleId, limit: 4 },
      success: (res) => {
        const result = res && res.result
        if (result && result.ok && Array.isArray(result.list)) this.setData({ relatedGuides: result.list })
      }
    })
  },

  handleRelatedGuideTap(event) {
    const contentId = String(event.currentTarget.dataset.id || "").trim()
    const scene = String(event.currentTarget.dataset.scene || "").trim()
    if (!contentId) return
    const attribution = sanitizeAttribution({ ...this.data.attribution, channel: this.data.attribution.channel || "direct", contentId, scene, vehicleId: this.data.carId })
    const action = beginPageNativeAction(this)
    wx.navigateTo({
      url: `/pages/content-page/content-page?${buildQuery(attribution)}`,
      fail: () => {
        if (isPageNativeActionActive(this, action)) wx.showToast({ title: "场景指南打开失败", icon: "none" })
      }
    })
  },

  loadOperationConfig() {
    this.cancelOperationConfigRequest()
    this._cancelOperationConfigRequest = requestOperationConfig({
      onSuccess: (config) => {
        const servicePhone =
          String(config.servicePhone || "").trim()
        const rentalTerms = normalizeRentalTerms(config.rentalTerms)

        this.setData({
          brandName: String(config.brandName || "").trim() || this.data.brandName,
          servicePhone: servicePhone || this.data.servicePhone,
          wxKfReady: hasWxKfConfig(config),
          rentalTerms,
          pricingOverview: buildPricingOverview(this.data.car, rentalTerms)
        })
      }
    })
  },

  loadFavoriteStatus(carId) {
    const requestId = Number(this._favoriteStatusRequestId || 0) + 1
    this._favoriteStatusRequestId = requestId
    this.clearFavoriteStatusTimer()
    if (!carId || !wx.cloud || typeof wx.cloud.callFunction !== "function") {
      return
    }
    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._favoriteStatusRequestId) {
        return false
      }
      settled = true
      this.clearFavoriteStatusTimer()
      return true
    }

    this._favoriteStatusTimer = setTimeout(() => {
      finishRequest()
    }, FAVORITE_STATUS_TIMEOUT_MS)

    const requestOptions = {
      name: "favoriteStatus",
      data: {
        vehicleId: carId
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (result && result.ok) {
          this.setData({
            favorited: Boolean(result.favorited)
          })
        }
      },
      fail: () => {
        finishRequest()
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      finishRequest()
    }
  },

  finishCarDetailLoadEffects() {
    this.clearCarDetailLoadTimer()
    if (typeof this._carDetailLoadDone === "function") {
      const done = this._carDetailLoadDone
      this._carDetailLoadDone = null
      try {
        done()
      } catch (error) {}
    }
  },

  loadCarDetail(carId, options) {
    const input = options && typeof options === "object" ? options : {}
    const requestId = Number(this._carDetailRequestId || 0) + 1
    this._carDetailRequestId = requestId
    this.finishCarDetailLoadEffects()

    if (!carId) {
      this.applyCar(null)
      if (typeof input.done === "function") {
        try { input.done() } catch (e) {}
      }
      return
    }

    const cachedCar = carDetailMemoryCache.get(carId)
    if (cachedCar && !this.data.car) {
      this.applyCar(cachedCar)
    }

    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      if (!cachedCar) {
        this.setLoadError("云能力未初始化，请稍后重试")
      }
      if (typeof input.done === "function") {
        try { input.done() } catch (e) {}
      }
      return
    }

    this._carDetailLoadDone = typeof input.done === "function" ? input.done : null
    this.setData({
      loading: !this.data.car,
      loadError: false
    })

    let settled = false
    const finishRequest = () => {
      if (settled || requestId !== this._carDetailRequestId) {
        return false
      }
      settled = true
      this.finishCarDetailLoadEffects()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setLoadError(message || "车辆详情加载失败，请返回车库后重试")
    }

    this._carDetailLoadTimer = setTimeout(() => {
      handleFailure("车辆详情加载超时，请检查网络后重试")
    }, CAR_DETAIL_LOAD_TIMEOUT_MS)

    const requestOptions = {
      name: "vehiclePublicDetail",
      data: {
        id: carId
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        const car = result && result.ok ? result.car : null
        if (car) {
          carDetailMemoryCache.set(carId, car)
          if (carDetailMemoryCache.size > 30) {
            const oldestKey = carDetailMemoryCache.keys().next().value
            carDetailMemoryCache.delete(oldestKey)
          }
          this.applyCar(car)
          return
        }

        if (result && result.code === "NOT_FOUND") {
          carDetailMemoryCache.delete(carId)
          this.applyCar(null)
          return
        }

        this.setLoadError((result && result.message) || "车辆详情加载失败，请返回车库后重试")
      },
      fail: (error) => {
        handleFailure((error && (error.errMsg || error.message)) || "车辆详情加载失败，请返回车库后重试")
      }
    }

    try {
      wx.cloud.callFunction(requestOptions)
    } catch (error) {
      handleFailure((error && (error.errMsg || error.message)) || "车辆详情加载失败，请返回车库后重试")
    }
  },

  clearCarDetailLoadTimer() {
    if (!this._carDetailLoadTimer) {
      return
    }
    clearTimeout(this._carDetailLoadTimer)
    this._carDetailLoadTimer = null
  },

  onUnload() {
    cancelPageNativeActions(this)
    if (typeof this._unsubscribeNetwork === "function") {
      this._unsubscribeNetwork()
      this._unsubscribeNetwork = null
    }
    if (this._posterTimer) {
      clearTimeout(this._posterTimer)
      this._posterTimer = null
    }
    this._carDetailRequestId = Number(this._carDetailRequestId || 0) + 1
    this._favoriteStatusRequestId = Number(this._favoriteStatusRequestId || 0) + 1
    this._favoriteUpdateSerial = Number(this._favoriteUpdateSerial || 0) + 1
    this.cancelOperationConfigRequest()
    this.cancelImageResolves()
    this.finishCarDetailLoadEffects()
    this.clearCarDetailLoadTimer()
    this.clearFavoriteStatusTimer()
    this.clearFavoriteUpdateTimer()
  },

  cancelOperationConfigRequest() {
    if (typeof this._cancelOperationConfigRequest === "function") {
      this._cancelOperationConfigRequest()
      this._cancelOperationConfigRequest = null
    }
  },

  clearFavoriteStatusTimer() {
    if (this._favoriteStatusTimer) {
      clearTimeout(this._favoriteStatusTimer)
      this._favoriteStatusTimer = null
    }
  },

  setLoadError(message) {
    this.setData({
      car: null,
      currentImageIndex: 0,
      trustExpanded: false,
      loading: false,
      loadError: true,
      loadErrorText: String(message || "车辆详情加载失败，请返回车库后重试")
    })

    if (typeof wx !== "undefined" && typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({
        title: "车辆详情"
      })
    }
  },

  applyCar(targetCar) {
    this.cancelImageResolves()
    if (!targetCar) {
      this.setData({
        car: null,
        currentImageIndex: 0,
        loading: false,
        loadError: false
      })
      if (typeof wx !== "undefined" && typeof wx.setNavigationBarTitle === "function") {
        wx.setNavigationBarTitle({
          title: "车辆详情"
        })
      }
      return
    }

    const viewModel = formatCarViewModel(targetCar)
    const isSameCar = Boolean(this.data.car && targetCar && String(this.data.car.id || "") === String(targetCar.id || ""))
    const nextImageIndex = isSameCar
      ? Math.min(Math.max(Number(this.data.currentImageIndex) || 0, 0), Math.max((viewModel.imageItems.length || 1) - 1, 0))
      : 0
    this.setData({
      car: viewModel,
      pricingOverview: buildPricingOverview(targetCar, this.data.rentalTerms),
      currentImageIndex: nextImageIndex,
      trustExpanded: false,
      loading: false,
      loadError: false
    })
    this._trustProfileViewTracked = false
    this.scheduleImageResolves(viewModel.imageItems, 0)

    if (typeof wx !== "undefined" && typeof wx.setNavigationBarTitle === "function") {
      wx.setNavigationBarTitle({
        title: targetCar.name || "车辆详情"
      })
    }
  },

  scheduleImageResolves(imageItems, currentIndex) {
    this.cancelImageResolves()
    const serial = Number(this._imageResolveSerial || 0) + 1
    this._imageResolveSerial = serial
    const items = Array.isArray(imageItems) ? imageItems : []
    if (!items.length) return

    const order = []
    order.push({ index: currentIndex, priority: 100 })
    if (items.length > 1) {
      order.push({ index: (currentIndex + 1) % items.length, priority: 70 })
    }
    if (items.length > 2) {
      order.push({ index: (currentIndex - 1 + items.length) % items.length, priority: 60 })
    }
    items.forEach((item, idx) => {
      if (!order.find((o) => o.index === idx)) {
        order.push({ index: idx, priority: Math.max(10, 40 - idx * 5) })
      }
    })

    order.forEach((entry) => {
      const item = items[entry.index]
      if (!item || !item.src) return
      if (item.displaySrc && item.displaySrc !== item.src) return
      resolveImage(item.src, { priority: entry.priority })
        .then((result) => {
          if (this._imageResolveSerial !== serial || !result || !result.localPath) return
          const car = this.data.car
          if (!car || !Array.isArray(car.imageItems)) return
          const current = car.imageItems[entry.index]
          if (!current || current.src !== item.src) return
          if (result.localPath === current.displaySrc) return
          this.setData({
            [`car.imageItems[${entry.index}].displaySrc`]: result.localPath,
            [`car.imageItems[${entry.index}].loaded`]: true
          })
        })
        .catch(() => {})
    })
  },

  cancelImageResolves() {
    this._imageResolveSerial = Number(this._imageResolveSerial || 0) + 1
  },

  handleHeroImageLoad(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) {
      return
    }

    const car = this.data.car
    const item = car && car.imageItems && car.imageItems[index]
    if (item) {
      if (item.src) {
        detailLoadedImagesCache.add(item.src)
        markImageLoaded(item.src)
      }
      if (item.displaySrc) {
        detailLoadedImagesCache.add(item.displaySrc)
        markImageLoaded(item.displaySrc)
      }
    }

    this.setData({
      [`car.imageItems[${index}].loaded`]: true,
      [`car.imageItems[${index}].failed`]: false
    })
  },

  handleHeroImageError(event) {
    const index = Number(event.currentTarget.dataset.index)
    if (!Number.isInteger(index) || index < 0) {
      return
    }

    const car = this.data.car
    const item = car && car.imageItems && car.imageItems[index]
    if (item) {
      if (item.src) {
        detailLoadedImagesCache.delete(item.src)
        unmarkImageLoaded(item.src)
      }
      if (item.displaySrc) {
        detailLoadedImagesCache.delete(item.displaySrc)
        unmarkImageLoaded(item.displaySrc)
      }
    }

    if (item && item.displaySrc && item.src && item.displaySrc !== item.src) {
      this.setData({
        [`car.imageItems[${index}].displaySrc`]: item.src
      })
      return
    }

    this.setData({
      [`car.imageItems[${index}].loaded`]: false,
      [`car.imageItems[${index}].failed`]: true
    })
  },

  handleHeroSwiperChange(event) {
    const current = Number(event && event.detail && event.detail.current)
    const car = this.data.car
    const imageCount = car && Array.isArray(car.imageItems) ? car.imageItems.length : 0
    const nextIndex = Number.isInteger(current) && current >= 0 && current < imageCount ? current : 0
    this.setData({ currentImageIndex: nextIndex })
    if (car && Array.isArray(car.imageItems)) {
      this.scheduleImageResolves(car.imageItems, nextIndex)
    }
  },

  handleHeroImageTap(event) {
    const car = this.data.car
    if (!car || !Array.isArray(car.images) || !car.images.length) {
      return
    }
    const index = Number(event.currentTarget.dataset.index)
    const currentIndex =
      Number.isInteger(index) && index >= 0 && index < car.images.length
        ? index
        : this.data.currentImageIndex
    const current = car.images[currentIndex] || car.images[0]

    const action = beginPageNativeAction(this, { requireCurrent: true })
    wx.previewImage({
      current,
      urls: car.images,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "图片预览失败",
          icon: "none"
        })
      }
    })
  },

  handleFavoriteTap() {
    if (!this.data.carId || this.data.favoriteLoading) {
      return
    }
    if (!wx.cloud || typeof wx.cloud.callFunction !== "function") {
      wx.showToast({
        title: "云能力未初始化",
        icon: "none"
      })
      return
    }

    const nextFavorited = !this.data.favorited
    const vehicleId = String(this.data.carId || "").trim()
    const updateSerial = Number(this._favoriteUpdateSerial || 0) + 1
    this._favoriteUpdateSerial = updateSerial
    this._favoriteStatusRequestId = Number(this._favoriteStatusRequestId || 0) + 1
    this.clearFavoriteStatusTimer()
    this.clearFavoriteUpdateTimer()
    this.setData({ favoriteLoading: true })

    let settled = false
    const finishRequest = () => {
      if (settled || updateSerial !== this._favoriteUpdateSerial) {
        return false
      }
      settled = true
      this.clearFavoriteUpdateTimer()
      return true
    }
    const handleFailure = (message) => {
      if (!finishRequest()) {
        return
      }
      this.setData({ favoriteLoading: false })
      wx.showToast({
        title: formatToastTitle(message, "收藏操作失败"),
        icon: "none"
      })
    }

    this._favoriteUpdateTimer = setTimeout(() => {
      handleFailure("收藏请求超时，请重试")
    }, FAVORITE_UPDATE_TIMEOUT_MS)

    const requestOptions = {
      name: "favoriteSet",
      data: {
        vehicleId,
        favorited: nextFavorited
      },
      success: (res) => {
        if (!finishRequest()) {
          return
        }
        const result = res && res.result ? res.result : null
        if (!result || !result.ok) {
          this.setData({ favoriteLoading: false })
          wx.showToast({
            title: formatToastTitle(result && result.message, "收藏操作失败"),
            icon: "none"
          })
          return
        }
        this.setData({
          favorited: Boolean(result.favorited),
          favoriteLoading: false
        })
        if (result.favorited) {
          trackEvent("favorite_add", vehicleId)
        }
        triggerHapticFeedback("light")
        wx.showToast({
          title: result.favorited ? "已加入收藏" : "已取消收藏",
          icon: "success"
        })
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

  clearFavoriteUpdateTimer() {
    if (!this._favoriteUpdateTimer) {
      return
    }
    clearTimeout(this._favoriteUpdateTimer)
    this._favoriteUpdateTimer = null
  },

  handleBookingTap() {
    if (!this.data.carId) {
      return
    }

    const action = beginPageNativeAction(this)
    const attribution = sanitizeAttribution({ ...this.data.attribution, vehicleId: this.data.carId })
    const city = this._initialCity || (this.data.car && this.data.car.location) || ""
    const query = buildQuery(attribution)
    const cityParam = city ? `${query ? "&" : ""}city=${encodeURIComponent(city)}` : ""
    const fullQuery = [query, cityParam].filter(Boolean).join("")
    wx.navigateTo({
      url: `/pages/booking/booking?${fullQuery}`,
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.showToast({
          title: "预约页面打开失败",
          icon: "none"
        })
      }
    })
  },

  handleTogglePricing() {
    const pricingExpanded = !this.data.pricingExpanded
    this.setData({ pricingExpanded })
    if (pricingExpanded && !this._pricingViewTracked) {
      this._pricingViewTracked = true
      trackEvent("pricing_view", this.data.carId)
    }
  },

  handleToggleRentalRules() {
    const rulesExpanded = !this.data.rulesExpanded
    this.setData({ rulesExpanded })
    if (rulesExpanded && !this._rentalRulesViewTracked) {
      this._rentalRulesViewTracked = true
      trackEvent("rental_rules_view", this.data.carId)
    }
  },

  handleToggleTrustArchive() {
    const trustExpanded = !this.data.trustExpanded
    this.setData({ trustExpanded })
    if (trustExpanded && !this._trustProfileViewTracked) {
      this._trustProfileViewTracked = true
      trackEvent("trusted_profile_view", this.data.carId)
    }
  },

  handleOpenCustomerService() {
    openCustomerService({
      page: this,
      vehicleId: this.data.carId,
      source: "car_detail",
      onLegacyFallback: () => {
        if (this.data.wxKfReady) {
          return
        }
        wx.showActionSheet({
          itemList: ["拨打客服电话", "复制官方微信号"],
          itemColor: "#2a2a33",
          success: (res) => {
            if (!res) return
            if (res.tapIndex === 0) {
              this.handlePhoneCall()
            } else if (res.tapIndex === 1) {
              this.handleWechatConsult()
            }
          }
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

    trackEvent("phone_call", this.data.carId)

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

  handleBackGarage() {
    const action = beginPageNativeAction(this)
    const pages = getCurrentPages()

    if (pages.length > 1) {
      wx.navigateBack({
        delta: 1,
        fail: () => {
          if (!isPageNativeActionActive(this, action)) {
            return
          }
          wx.redirectTo({
            url: "/pages/garage/garage",
            fail: () => {
              if (!isPageNativeActionActive(this, action)) {
                return
              }
              wx.reLaunch({
                url: "/pages/garage/garage",
                fail: () => {
                  if (!isPageNativeActionActive(this, action)) {
                    return
                  }
                  wx.showToast({
                    title: "返回车库失败",
                    icon: "none"
                  })
                }
              })
            }
          })
        }
      })
      return
    }

    wx.redirectTo({
      url: "/pages/garage/garage",
      fail: () => {
        if (!isPageNativeActionActive(this, action)) {
          return
        }
        wx.reLaunch({
          url: "/pages/garage/garage",
          fail: () => {
            if (!isPageNativeActionActive(this, action)) {
              return
            }
            wx.showToast({
              title: "返回车库失败",
              icon: "none"
            })
          }
        })
      }
    })
  },

  handleRetryLoad() {
    if (this.data.loading || this.data.favoriteLoading) {
      return
    }
    this.loadCarDetail(this.data.carId)
  },

  onShareAppMessage() {
    const car = this.data.car

    trackEvent("share", car && car.id)

    if (!car) {
      return {
        title: "极境车库",
        path: "/pages/garage/garage"
      }
    }

    return {
      title: `${car.nickname} ${car.name}`,
      path: `/pages/car-detail/car-detail?${buildQuery({ ...this.data.attribution, channel: "wechat_share", vehicleId: car.id })}`
    }
  },

  handleOpenPosterModal() {
    this.setData({
      posterModalVisible: true,
      posterGenerating: true,
      posterImagePath: ""
    })
    trackEvent("share", this.data.carId)
    if (this._posterTimer) {
      clearTimeout(this._posterTimer)
    }
    this._posterTimer = setTimeout(() => {
      this._posterTimer = null
      this.renderPoster()
    }, 100)
    if (this._posterTimer && typeof this._posterTimer.unref === "function") {
      this._posterTimer.unref()
    }
  },

  handleClosePosterModal() {
    if (this._posterTimer) {
      clearTimeout(this._posterTimer)
      this._posterTimer = null
    }
    this.setData({
      posterModalVisible: false,
      posterGenerating: false
    })
  },

  renderPoster() {
    if (typeof wx === "undefined" || !wx || typeof wx.createSelectorQuery !== "function") {
      this.fallbackRenderPoster()
      return
    }
    const query = wx.createSelectorQuery().in(this)
    query
      .select("#posterCanvas")
      .fields({ node: true, size: true })
      .exec((res) => {
        if (!res || !res[0] || !res[0].node) {
          this.fallbackRenderPoster()
          return
        }
        const canvas = res[0].node
        const ctx = canvas.getContext("2d")
        const dpr = (wx.getSystemInfoSync && wx.getSystemInfoSync().pixelRatio) || 2
        const width = res[0].width || 300
        const height = res[0].height || 480
        canvas.width = width * dpr
        canvas.height = height * dpr
        ctx.scale(dpr, dpr)

        // Draw background
        ctx.fillStyle = "#0D1015"
        ctx.fillRect(0, 0, width, height)

        // Draw header accent
        ctx.fillStyle = "#D09E5A"
        ctx.fillRect(20, 20, 4, 18)

        ctx.fillStyle = "#E8C88B"
        ctx.font = "bold 13px sans-serif"
        ctx.fillText("极境车库 · 尊享甄选", 30, 34)

        // Car Title
        const car = this.data.car || {}
        ctx.fillStyle = "#FFFFFF"
        ctx.font = "bold 18px sans-serif"
        ctx.fillText((car.brand || "") + " " + (car.name || "极境座驾"), 20, 68)

        ctx.fillStyle = "#8D98AA"
        ctx.font = "12px sans-serif"
        ctx.fillText(car.nickname || "车牌尾号保密 · 门店核验", 20, 88)

        const drawFooterAndExport = () => {
          // Price badge
          ctx.fillStyle = "rgba(208, 158, 90, 0.12)"
          ctx.fillRect(20, 290, width - 40, 52)
          ctx.strokeStyle = "rgba(208, 158, 90, 0.35)"
          ctx.lineWidth = 1
          ctx.strokeRect(20, 290, width - 40, 52)

          ctx.fillStyle = "#94A3B8"
          ctx.font = "11px sans-serif"
          ctx.fillText("今日参考日租", 32, 310)

          ctx.fillStyle = "#E8C88B"
          ctx.font = "bold 17px sans-serif"
          ctx.fillText(car.priceText || "价格到店详询", 32, 332)

          // Tags
          ctx.fillStyle = "#9CA3AF"
          ctx.font = "11px sans-serif"
          const tagStr = (car.tags || []).slice(0, 3).join("  ·  ")
          if (tagStr) {
            ctx.fillText(tagStr, 20, 368)
          }

          // Bottom Slogan
          ctx.fillStyle = "#6B7280"
          ctx.font = "10px sans-serif"
          ctx.fillText("甄选座驾 · 为每一次出发预留专属席位", 20, 410)
          ctx.fillText("微信搜索【极境车库】小程序，查看完整档期与报价", 20, 428)

          if (wx.canvasToTempFilePath) {
            wx.canvasToTempFilePath({
              canvas,
              success: (tempRes) => {
                this.setData({
                  posterImagePath: tempRes.tempFilePath,
                  posterGenerating: false
                })
              },
              fail: () => {
                this.setData({ posterGenerating: false })
              }
            })
          } else {
            this.fallbackRenderPoster()
          }
        }

        const coverSrc = (car.imageItems && car.imageItems[0] && (car.imageItems[0].displaySrc || car.imageItems[0].src)) || car.cover
        if (coverSrc && typeof canvas.createImage === "function") {
          const img = canvas.createImage()
          img.onload = () => {
            try {
              ctx.drawImage(img, 20, 106, width - 40, 168)
            } catch (e) {}
            drawFooterAndExport()
          }
          img.onerror = () => {
            ctx.fillStyle = "#161B22"
            ctx.fillRect(20, 106, width - 40, 168)
            ctx.fillStyle = "#8D98AA"
            ctx.font = "13px sans-serif"
            ctx.fillText("极境座驾实拍", width / 2 - 36, 195)
            drawFooterAndExport()
          }
          img.src = coverSrc
        } else {
          ctx.fillStyle = "#161B22"
          ctx.fillRect(20, 106, width - 40, 168)
          drawFooterAndExport()
        }
      })
  },

  fallbackRenderPoster() {
    const car = this.data.car || {}
    const fallbackImage = (car.imageItems && car.imageItems[0] && (car.imageItems[0].displaySrc || car.imageItems[0].src)) || car.cover || "/assets/icons/jijing-garage-emblem.png"
    this.setData({
      posterImagePath: fallbackImage,
      posterGenerating: false
    })
  },

  handleSavePoster() {
    const filePath = this.data.posterImagePath
    if (!filePath) {
      wx.showToast({ title: "海报生成中", icon: "none" })
      return
    }
    const action = beginPageNativeAction(this, { requireCurrent: true })
    if (typeof wx.saveImageToPhotosAlbum === "function") {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          triggerHapticFeedback("medium")
          if (isPageNativeActionActive(this, action)) {
            wx.showToast({ title: "海报已保存相册", icon: "success" })
            this.handleClosePosterModal()
          }
        },
        fail: (err) => {
          if (!isPageNativeActionActive(this, action)) return
          const msg = String((err && (err.errMsg || err.message)) || "").toLowerCase()
          if (msg.includes("cancel")) {
            return
          }
          if (msg.includes("auth") || msg.includes("authorize") || msg.includes("denied")) {
            wx.showToast({ title: "请开启相册权限", icon: "none" })
            return
          }
          wx.showToast({ title: "保存未完成", icon: "none" })
        }
      })
    } else {
      wx.showToast({ title: "系统暂不支持", icon: "none" })
    }
  },

  handleOpenLocation() {
    const car = this.data.car || {}
    const locationName = String(car.location || "极境车库").trim()
    const isShanghai = locationName.includes("上海")
    const latitude = isShanghai ? 31.2304 : 30.2741
    const longitude = isShanghai ? 121.4737 : 120.1551
    const name = `极境车库 · ${isShanghai ? "上海交付中心" : "杭州交付中心"}`

    if (typeof wx.openLocation === "function") {
      wx.openLocation({
        latitude,
        longitude,
        name,
        address: locationName,
        scale: 15,
        fail: () => {
          wx.showToast({ title: "定位打开失败", icon: "none" })
        }
      })
    } else {
      wx.showToast({ title: "系统暂不支持", icon: "none" })
    }
  },

  handleCopyCarId() {
    const carId = this.data.car && this.data.car.id ? String(this.data.car.id) : ""
    if (!carId) {
      wx.showToast({ title: "暂无车辆编号", icon: "none" })
      return
    }
    const action = beginPageNativeAction(this, { requireCurrent: true })
    if (typeof wx.setClipboardData === "function") {
      wx.setClipboardData({
        data: carId,
        success: () => {
          triggerHapticFeedback("light")
          if (isPageNativeActionActive(this, action)) {
            wx.showToast({
              title: "车辆编号已复制",
              icon: "success"
            })
          }
        },
        fail: () => {
          if (isPageNativeActionActive(this, action)) {
            wx.showToast({
              title: "复制失败",
              icon: "none"
            })
          }
        }
      })
    }
  },

  handleWechatConsult() {
    const wechatId = "jijing_garage"
    const action = beginPageNativeAction(this, { requireCurrent: true })
    if (typeof wx.setClipboardData === "function") {
      wx.setClipboardData({
        data: wechatId,
        success: () => {
          triggerHapticFeedback("medium")
          if (isPageNativeActionActive(this, action)) {
            wx.showToast({
              title: "微信号已复制",
              icon: "success"
            })
          }
        },
        fail: () => {
          if (isPageNativeActionActive(this, action)) {
            wx.showToast({
              title: "复制失败",
              icon: "none"
            })
          }
        }
      })
    }
  }
})
