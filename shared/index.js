/**
 * 极境车库小程序 - 共享架构与领域模块总门面 (Shared Architecture Facade)
 *
 * 分层架构说明：
 * ┌─────────────────────────────────────────────────────────────┐
 * │ 1. controllers: 页面级控制器与生命周期守卫 (PageController, definePage)   │
 * ├─────────────────────────────────────────────────────────────┤
 * │ 2. domains: 业务领域模型 (vehicle, booking, auth, operation)          │
 * ├─────────────────────────────────────────────────────────────┤
 * │ 3. services: 云端通信与数据访问 (cloudClient, cloudReadRequest, cache)│
 * ├─────────────────────────────────────────────────────────────┤
 * │ 4. core: 基础架构能力 (performance, imageCache, nativeAction, etc.) │
 * └─────────────────────────────────────────────────────────────┘
 */

// 1. 基础架构能力 (Core Infrastructure)
const performance = require("./performance")
const pageNativeAction = require("./pageNativeAction")
const imageCache = require("./imageCache")
const networkStatus = require("./networkStatus")
const hapticFeedback = require("./hapticFeedback")
const uiFeedback = require("./uiFeedback")
const formatTime = require("./formatTime")
const dateUtils = require("./dateUtils")
const csvFile = require("./csvFile")
const pageCsvFileActions = require("./pageCsvFileActions")
const unsavedChanges = require("./unsavedChanges")

const core = {
  performance,
  pageNativeAction,
  imageCache,
  networkStatus,
  hapticFeedback,
  uiFeedback,
  formatTime,
  dateUtils,
  csvFile,
  pageCsvFileActions,
  unsavedChanges
}

// 2. 云端通信与数据服务 (Services)
const cloudClient = require("./cloudClient")
const cloudReadRequest = require("./cloudReadRequest")
const cloudDataCache = require("./cloudDataCache")
const operationConfigRequest = require("./operationConfigRequest")

const services = {
  cloudClient,
  cloudReadRequest,
  cloudDataCache,
  operationConfigRequest
}

// 3. 业务领域模型 (Domains)
const vehicle = require("./vehicle")
const vehicleLabels = require("./vehicleLabels")
const rentalPricing = require("./rentalPricing")
const vehicleMaintenance = require("./vehicleMaintenance")
const vehicleChecklist = require("./vehicleChecklist")
const vehicleFormProgress = require("./vehicleFormProgress")
const bookingStatus = require("./bookingStatus")
const bookingTags = require("./bookingTags")
const bookingCalendar = require("./bookingCalendar")
const bookingWorkbench = require("./bookingWorkbench")
const handoverReport = require("./handoverReport")
const serviceConfig = require("./serviceConfig")
const customerService = require("./customerService")
const locations = require("./locations")
const operationAlerts = require("./operationAlerts")
const contentAttribution = require("./contentAttribution")
const analytics = require("./analytics")
const auth = require("./pageAuth")
const migration = require("./versionMigration")
const privacy = require("./privacy")

const domains = {
  vehicle,
  vehicleLabels,
  rentalPricing,
  vehicleMaintenance,
  vehicleChecklist,
  vehicleFormProgress,
  bookingStatus,
  bookingTags,
  bookingCalendar,
  bookingWorkbench,
  handoverReport,
  serviceConfig,
  customerService,
  locations,
  operationAlerts,
  contentAttribution,
  analytics,
  auth,
  migration,
  privacy
}

// 4. 控制器与页面增强 (Controllers)
const pageController = require("./pageController")

const controllers = {
  pageController
}

module.exports = {
  // 分层命名空间
  core,
  services,
  domains,
  controllers,

  // 高频核心工具一站式直接导出
  createPerformanceHelpers: performance.createPerformanceHelpers,
  deepMergePatch: performance.deepMergePatch,
  activatePageNativeActions: pageNativeAction.activatePageNativeActions,
  beginPageNativeAction: pageNativeAction.beginPageNativeAction,
  cancelPageNativeActions: pageNativeAction.cancelPageNativeActions,
  isPageNativeActionActive: pageNativeAction.isPageNativeActionActive,
  formatToastTitle: uiFeedback.formatToastTitle,
  triggerHapticFeedback: hapticFeedback.triggerHapticFeedback,
  onNetworkReconnect: networkStatus.onNetworkReconnect,
  offNetworkReconnect: networkStatus.offNetworkReconnect,
  getNetworkState: networkStatus.getNetworkState,
  formatDisplayTime: formatTime.formatDisplayTime,

  // 高频业务与服务工具一站式直接导出
  callCloud: cloudClient.callCloud,
  calculateRentalDays: dateUtils.calculateRentalDays,
  formatDateSpan: dateUtils.formatDateSpan,
  isDateRangeValid: dateUtils.isDateRangeValid,
  isDateOverlap: dateUtils.isDateOverlap,
  addDays: dateUtils.addDays,
  getVehicleTypeLabel: vehicleLabels.getVehicleTypeLabel,
  getVehicleStatusLabel: vehicleLabels.getVehicleStatusLabel,
  getVehicleStatusClass: vehicleLabels.getVehicleStatusClass,
  mapStatusText: bookingStatus.mapStatusText,
  mapStatusClass: bookingStatus.mapStatusClass,
  mapPriorityText: bookingStatus.mapPriorityText,
  mapCoordinationText: bookingStatus.mapCoordinationText,
  getPrivacyTypeLabel: privacy.getPrivacyTypeLabel,
  getPrivacyStatusLabel: privacy.getPrivacyStatusLabel,
  getPrivacyStatusClass: privacy.getPrivacyStatusClass,
  createPageController: pageController.createPageController,
  definePage: pageController.definePage
}
