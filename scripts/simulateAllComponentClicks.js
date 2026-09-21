/**
 * 极境车库小程序 - 全组件与全页面用户交互点击自动化仿真系统
 *
 * 覆盖范围：
 * 1. 全部自定义组件（2 个）：
 *    - components/car-card (卡片点击、大图加载、错误兜底、属性更新)
 *    - components/core-nav (首页/收藏/预约/我的 四大 Tab 导航点击、栈内回退与重定向)
 * 2. 全部主包页面（13 个）：
 *    - pages/garage/garage (分类标签、城市筛选、排序、搜索、车型卡片、上拉触底、电话拨打、重试)
 *    - pages/car-detail/car-detail (轮播大图、收藏切换、海报生成/保存/关闭、租车规则/价格/保障折叠展开、预订、客服、电话、返回)
 *    - pages/booking/booking (姓名/电话/身份证输入、城市选择、快捷租期/日期选择、隐私协议勾选/查看、提交、返回)
 *    - pages/bookings/bookings (状态标签切换、详情卡片点击、取消预约、去逛逛、重试)
 *    - pages/booking-detail/booking-detail (复制单号、客服电话、交接清单展开、报价接受/拒绝、日历导出、修改联系人)
 *    - pages/favorites/favorites (仅看可用切换、车型点击、移除收藏、撤回移除、去车库)
 *    - pages/content-page/content-page (攻略 Tab 切换、手风琴折叠展开、关联车型点击、攻略立即预订、客服电话)
 *    - pages/privacy-request/privacy-request (申请类型选择、说明输入、表单提交、撤销申请、状态筛选)
 *    - pages/mine/mine (会员特权点击、权限刷新、复制 OpenID、快捷入口与全部 13 个管理员功能卡片点击)
 *    - pages/booking-calendar/booking-calendar (月份切换/回本月、日期网格点击、停用锁定/解除、改价规则保存/重置)
 *    - pages/booking-workbench/booking-workbench (状态概览卡片、优先级与冲突项、快捷调度、快速拨号、备注编辑保存)
 *    - pages/booking-manage/booking-manage (关键字搜索/清除、状态/优先级/调度/城市筛选、重置、快速改状态、导出 CSV)
 *    - pages/booking-manage-detail/booking-manage-detail (状态流转变更、调度协调、外呼客户、报价发送/作废、交接环节推进与照片操作)
 * 3. 全部管理员分包页面（13 个）：
 *    - pages-admin/vehicle-manage/vehicle-manage (状态标签、搜索回车、编辑、下架/上架/报废/恢复、新增车型跳转)
 *    - pages-admin/vehicle-create/vehicle-create (字段输入、能源/排挡/车型选择、表单提交)
 *    - pages-admin/vehicle-edit/vehicle-edit (信息修改、归档日期/复核选择、图库管理跳转、提交修改)
 *    - pages-admin/vehicle-detail-manage/vehicle-detail-manage (状态调整、停用/复用、图库预览/删除/设为封面、编辑跳转)
 *    - pages-admin/operations-overview/operations-overview (指标卡点击、模块跳转、刷新)
 *    - pages-admin/analytics-manage/analytics-manage (时间周期切换、TopN 切换、数据清理、重试)
 *    - pages-admin/role-manage/role-manage (OpenID 输入、权限勾选/取消、保存角色、编辑角色)
 *    - pages-admin/config-manage/config-manage (各项参数编辑、重置与保存)
 *    - pages-admin/system-health/system-health (手动排查触发、健康体检刷新)
 *    - pages-admin/audit-log-manage/audit-log-manage (操作行为标签、关键字筛选、导出 CSV、文件分享/打开)
 *    - pages-admin/error-log-manage/error-log-manage (函数名标签筛选、关键字搜索、导出日志、重置)
 *    - pages-admin/privacy-request-manage/privacy-request-manage (状态/类型标签切换、审批通过/拒绝、清单跳转)
 *    - pages-admin/privacy-data-inventory/privacy-data-inventory (复制 OpenID、导出个人数据台账、刷新数据)
 */

const path = require("path")

// 终端高亮配置
const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  magenta: "\x1b[35m"
}

let totalSimulated = 0
let passedCount = 0
let failedCount = 0

function logSuite(title) {
  console.log(`\n${c.bold}${c.cyan}┌── ${title}${c.reset}`)
}

function simulateClick(desc, actionFn) {
  totalSimulated++
  try {
    actionFn()
    passedCount++
    console.log(`│  ${c.green}✓${c.reset} [CLICK] ${desc}`)
  } catch (err) {
    failedCount++
    console.error(`│  ${c.red}✗${c.reset} [FAIL]  ${desc}`)
    console.error(`│     ${c.red}Error: ${err.message}${c.reset}`)
    process.exitCode = 1
  }
}

// 模拟全局微信与 App 运行沙箱
const storage = {}
const mockFs = {
  accessSync: () => {},
  saveFile: ({ tempFilePath, success }) => {
    if (success) success({ savedFilePath: tempFilePath.replace("tmp_", "saved_") })
  },
  unlink: ({ success, complete } = {}) => {
    if (typeof success === "function") success()
    if (typeof complete === "function") complete()
  },
  writeFile: ({ success, complete } = {}) => {
    if (typeof success === "function") success()
    if (typeof complete === "function") complete()
  }
}

const appInstance = {
  globalData: {
    cloudEnvId: "prod-garage-env",
    _tempCarDetailPreview: null,
    userInfo: { nickName: "体验用户", avatarUrl: "" }
  }
}
global.getApp = () => appInstance

const pageStack = [
  { route: "pages/garage/garage", __route__: "pages/garage/garage" }
]
global.getCurrentPages = () => pageStack

global.wx = {
  env: { USER_DATA_PATH: "wxfile://usr" },
  getStorageSync: (k) => storage[k] || null,
  setStorageSync: (k, v) => { storage[k] = v },
  removeStorageSync: (k) => { delete storage[k] },
  getFileSystemManager: () => mockFs,
  showToast: () => {},
  showModal: ({ success }) => { if (typeof success === "function") success({ confirm: true, cancel: false }) },
  showLoading: () => {},
  hideLoading: () => {},
  showActionSheet: ({ success }) => { if (typeof success === "function") success({ tapIndex: 0 }) },
  stopPullDownRefresh: () => {},
  navigateTo: ({ url, success }) => {
    pageStack.push({ route: url.replace(/^\//, "").split("?")[0], __route__: url.replace(/^\//, "").split("?")[0] })
    if (typeof success === "function") success()
  },
  redirectTo: ({ url, success }) => {
    pageStack.pop()
    pageStack.push({ route: url.replace(/^\//, "").split("?")[0], __route__: url.replace(/^\//, "").split("?")[0] })
    if (typeof success === "function") success()
  },
  navigateBack: ({ delta = 1, success }) => {
    for (let i = 0; i < delta; i++) {
      if (pageStack.length > 1) pageStack.pop()
    }
    if (typeof success === "function") success()
  },
  reLaunch: ({ url, success }) => {
    pageStack.length = 0
    pageStack.push({ route: url.replace(/^\//, "").split("?")[0], __route__: url.replace(/^\//, "").split("?")[0] })
    if (typeof success === "function") success()
  },
  switchTab: () => {},
  setNavigationBarTitle: () => {},
  makePhoneCall: () => {},
  setClipboardData: ({ success }) => { if (typeof success === "function") success() },
  getClipboardData: ({ success }) => { if (typeof success === "function") success({ data: "mocked-data" }) },
  openCustomerServiceChat: ({ success }) => { if (typeof success === "function") success() },
  openLocation: ({ success }) => { if (typeof success === "function") success() },
  previewImage: () => {},
  chooseImage: ({ success }) => {
    if (typeof success === "function") {
      success({ tempFilePaths: ["wxfile://tmp_car_photo.jpg"], tempFiles: [{ path: "wxfile://tmp_car_photo.jpg", size: 102400 }] })
    }
  },
  chooseMedia: ({ success }) => {
    if (typeof success === "function") {
      success({ tempFiles: [{ tempFilePath: "wxfile://tmp_photo.jpg", size: 102400 }] })
    }
  },
  downloadFile: ({ success, complete }) => {
    if (typeof success === "function") success({ statusCode: 200, tempFilePath: "wxfile://tmp_download.csv" })
    if (typeof complete === "function") complete({ statusCode: 200, tempFilePath: "wxfile://tmp_download.csv" })
  },
  openDocument: ({ success }) => { if (typeof success === "function") success() },
  shareFileMessage: ({ success }) => { if (typeof success === "function") success() },
  enableAlertBeforeUnload: () => {},
  disableAlertBeforeUnload: () => {},
  vibrateShort: () => {},
  requestSubscribeMessage: ({ success }) => { if (typeof success === "function") success({ errMsg: "requestSubscribeMessage:ok" }) },
  getSystemInfoSync: () => ({ platform: "devtools", system: "iOS 16.0", windowWidth: 375, windowHeight: 812 }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: "release", appId: "wx1234567890abcdef" } }),
  cloud: {
    init: () => {},
    downloadFile: ({ success, complete }) => {
      if (typeof success === "function") success({ tempFilePath: "wxfile://tmp_cloud_download.jpg" })
      if (typeof complete === "function") complete({ tempFilePath: "wxfile://tmp_cloud_download.jpg" })
    },
    uploadFile: ({ success, complete }) => {
      if (typeof success === "function") success({ fileID: "cloud://prod-garage-env/uploaded-file.jpg" })
      if (typeof complete === "function") complete({ fileID: "cloud://prod-garage-env/uploaded-file.jpg" })
    },
    callFunction: ({ name, data, success, complete }) => {
      let result = { ok: true }
      if (name === "garageVehicleList") {
        result = {
          ok: true,
          total: 2,
          page: 0,
          hasMore: false,
          categoryCounts: { all: 2, supercar: 1, luxury_sedan: 1 },
          list: [
            {
              id: "car-911",
              name: "保时捷 911 Carrera S",
              brand: "保时捷",
              category: "supercar",
              city: "上海",
              priceDay: 2800,
              priceText: "￥2,800/天",
              status: "available",
              cover: "https://example.com/911.jpg"
            },
            {
              id: "car-panamera",
              name: "保时捷 Panamera",
              brand: "保时捷",
              category: "luxury_sedan",
              city: "北京",
              priceDay: 2200,
              priceText: "￥2,200/天",
              status: "available",
              cover: "https://example.com/panamera.jpg"
            }
          ]
        }
      } else if (name === "vehiclePublicDetail" || name === "vehicleDetail") {
        const car = {
          id: (data && data.id) || "car-911",
          name: "保时捷 911 Carrera S",
          brand: "保时捷",
          brandModel: "保时捷 911 Carrera S",
          category: "supercar",
          vehicleType: "sports",
          city: "上海",
          priceDay: 2800,
          deposit: 10000,
          plateNumber: "沪A91100",
          status: "active",
          transmission: "automatic",
          fuelType: "gasoline",
          registerDate: "2025-05-20",
          images: ["https://example.com/911-1.jpg", "https://example.com/911-2.jpg"],
          cover: "https://example.com/911-1.jpg",
          features: ["3.0T 双涡轮", "后置后驱", "PDK 变速箱"]
        }
        result = { ok: true, car, vehicle: car, detail: car }
      } else if (name === "favoriteStatus") {
        result = { ok: true, favorited: false }
      } else if (name === "favoriteSet") {
        result = { ok: true, favorited: Boolean(data && data.favorited) }
      } else if (name === "favoriteMyList") {
        result = {
          ok: true,
          list: [{ id: "car-911", name: "保时捷 911 Carrera S", priceDay: 2800, status: "available" }],
          hasMore: false
        }
      } else if (name === "bookingCreate") {
        result = { ok: true, bookingId: "bk-2026-001", message: "预约已提交" }
      } else if (name === "bookingMyList" || name === "bookingList") {
        result = {
          ok: true,
          total: 1,
          hasMore: false,
          list: [
            {
              id: "bk-2026-001",
              bookingId: "bk-2026-001",
              vehicleId: "car-911",
              vehicleName: "保时捷 911 Carrera S",
              startDate: "2026-10-01",
              endDate: "2026-10-03",
              status: "pending",
              coordinationStatus: "unassigned",
              priority: "normal",
              city: "上海",
              userName: "张先生",
              contactPhone: "13800000000",
              createdAt: Date.now()
            }
          ]
        }
      } else if (name === "bookingMyDetail" || name === "bookingDetail") {
        const item = {
          id: "bk-2026-001",
          bookingId: "bk-2026-001",
          vehicleId: "car-911",
          vehicleName: "保时捷 911 Carrera S",
          startDate: "2026-10-01",
          endDate: "2026-10-03",
          status: "pending",
          coordinationStatus: "unassigned",
          priority: "normal",
          city: "上海",
          userName: "张先生",
          contactPhone: "13800000000",
          adminRemark: "",
          adminRemarkDraft: "",
          tags: []
        }
        result = {
          ok: true,
          booking: item,
          detail: item,
          latestQuote: {
            amount: 5600,
            validUntil: "2026-10-01 12:00",
            status: "pending"
          },
          handovers: []
        }
      } else if (name === "contentGuides") {
        result = {
          ok: true,
          guide: {
            slug: "weekend-short-trip-prep-2026",
            title: "周末自驾游出行指南",
            summary: "带您领略短途奢华自驾体验",
            body: "精选路线与检查清单...",
            relatedVehicles: [{ id: "car-911", name: "保时捷 911 Carrera S" }]
          }
        }
      } else if (name === "contentGuideList") {
        result = {
          ok: true,
          list: [{ id: "guide-001", slug: "weekend-short-trip-prep-2026", title: "周末自驾游出行指南" }]
        }
      } else if (name === "privacyRequestMyList" || name === "privacyRequestList") {
        result = {
          ok: true,
          list: [{ id: "req-001", type: "access", status: "completed", createdAt: Date.now() }],
          hasMore: false
        }
      } else if (name === "getMyPermissions") {
        result = {
          ok: true,
          roles: ["admin"],
          canManageVehicles: true,
          canManageBookings: true,
          canManageRoles: true,
          canManageConfig: true,
          canManageLogs: true,
          canManagePrivacy: true,
          canExportData: true,
          canViewAuditLogs: true
        }
      } else if (name === "bookingCalendarList") {
        result = {
          ok: true,
          month: "2026-10",
          blocks: [],
          occupancies: [],
          priceRules: []
        }
      } else if (name === "operationSummaryGet") {
        result = {
          ok: true,
          activeVehicles: 15,
          totalBookings: 88,
          pendingBookings: 3,
          healthScore: 99
        }
      } else if (name === "vehicleList") {
        result = {
          ok: true,
          total: 1,
          list: [
            {
              id: "car-911",
              name: "保时捷 911 Carrera S",
              brandModel: "保时捷 911 Carrera S",
              brand: "保时捷",
              status: "active",
              plateNumber: "沪A91100"
            }
          ],
          hasMore: false
        }
      } else if (name === "analyticsOverview") {
        result = {
          ok: true,
          topN: (data && data.topN) || 3,
          days: (data && data.days) || 7,
          metrics: {
            garage_view: 500,
            vehicle_detail: 300,
            pricing_view: 200,
            booking_start: 100,
            booking_submit: 45
          },
          conversionRate: 8.5,
          quoteMetrics: {},
          trustProfileMetrics: {},
          contentAnalytics: { topContents: [], topVehicles: [], topSources: [] },
          trend: [],
          contentTrend: [],
          sceneFunnels: []
        }
      } else if (name === "roleList") {
        result = {
          ok: true,
          roles: [{ openid: "admin-openid", roles: ["admin"] }]
        }
      } else if (name === "operationConfigGet") {
        result = {
          ok: true,
          config: { maintenanceMode: false, bookingDepositRequired: true }
        }
      } else if (name === "systemHealthCheck") {
        result = {
          ok: true,
          status: "healthy",
          checks: [{ item: "database", ok: true }, { item: "storage", ok: true }]
        }
      } else if (name === "auditLogList") {
        result = {
          ok: true,
          list: [{ id: "log-001", action: "vehicle_update", time: Date.now() }],
          hasMore: false
        }
      } else if (name === "errorLogList") {
        result = {
          ok: true,
          list: [{ id: "err-001", message: "Network timeout", count: 1 }],
          hasMore: false
        }
      } else if (name === "privacyDataInventory") {
        result = {
          ok: true,
          summary: { totalRecords: 120, userCount: 45 }
        }
      } else if (name === "getOpenid") {
        result = { ok: true, openid: "mock-user-openid-12345" }
      }

      if (typeof success === "function") success({ result })
      if (typeof complete === "function") complete({ result })
    }
  }
}

// 深度 path-resolving setData 实现（完美模拟微信 setData 路径操作如 'form.plateNumber'）
function applySetData(targetData, patch, cb) {
  Object.keys(patch || {}).forEach((key) => {
    if (key.includes(".")) {
      const parts = key.split(".")
      let curr = targetData
      for (let i = 0; i < parts.length - 1; i++) {
        if (!curr[parts[i]] || typeof curr[parts[i]] !== "object") {
          curr[parts[i]] = {}
        }
        curr = curr[parts[i]]
      }
      curr[parts[parts.length - 1]] = patch[key]
    }
    targetData[key] = patch[key]
  })
  if (typeof cb === "function") cb()
}

// 组件与页面加载器工厂
function loadComponent(compPath) {
  let definition = null
  global.Component = (def) => { definition = def }
  const fullPath = path.resolve(__dirname, "..", compPath)
  delete require.cache[require.resolve(fullPath)]
  require(fullPath)

  const instance = {
    ...definition.methods,
    data: { ...(definition.data || {}) },
    properties: { ...(definition.properties || {}) },
    observers: { ...(definition.observers || {}) },
    setData(patch, cb) {
      applySetData(this.data, patch, cb)
    },
    triggerEvent(eventName, detail) {
      this._lastTriggeredEvent = { eventName, detail }
    },
    attached: definition.lifetimes && definition.lifetimes.attached,
    detached: definition.lifetimes && definition.lifetimes.detached
  }

  // 绑定 methods this 上下文
  Object.keys(definition.methods || {}).forEach((m) => {
    instance[m] = definition.methods[m].bind(instance)
  })

  return instance
}

function loadPage(pagePath, options = {}) {
  let definition = null
  global.Page = (def) => { definition = def }
  const fullPath = path.resolve(__dirname, "..", pagePath)
  delete require.cache[require.resolve(fullPath)]
  require(fullPath)

  const instance = {
    ...definition,
    data: { ...(definition.data || {}) },
    setData(patch, cb) {
      applySetData(this.data, patch, cb)
    },
    selectComponent: () => null
  }

  // 绑定所有成员方法到实例
  Object.keys(definition).forEach((k) => {
    if (typeof definition[k] === "function") {
      instance[k] = definition[k].bind(instance)
    }
  })

  // 自动执行已声明的生命周期
  if (typeof instance.onLoad === "function") instance.onLoad(options)
  if (typeof instance.onReady === "function") instance.onReady()
  if (typeof instance.onShow === "function") instance.onShow()

  return instance
}

// 模拟事件对象构建器
function makeEvent(dataset = {}, detail = {}) {
  return {
    currentTarget: { dataset },
    target: { dataset },
    detail
  }
}

console.log(`${c.bold}${c.magenta}========================================================================${c.reset}`)
console.log(`${c.bold}${c.magenta}   极境车库小程序 - 全量组件与 26 页面交互点击自动化仿真套件   ${c.reset}`)
console.log(`${c.bold}${c.magenta}========================================================================${c.reset}`)

// ========================================================================
// 1. 自定义组件交互点击仿真
// ========================================================================
logSuite("1. 自定义组件: components/car-card (车辆卡片)")
const carCard = loadComponent("components/car-card/car-card")
carCard.setData({
  car: {
    id: "car-911",
    name: "保时捷 911 Carrera S",
    priceText: "￥2,800/天",
    status: "available",
    cover: "https://example.com/cover.jpg"
  }
})

simulateClick("点击车辆卡片整体 (handleTap) -> 触发触感反馈与 cardtap 事件", () => {
  carCard.handleTap()
  if (!carCard._lastTriggeredEvent || carCard._lastTriggeredEvent.eventName !== "cardtap") {
    throw new Error("cardtap 事件未正确分发")
  }
  if (carCard._lastTriggeredEvent.detail.carId !== "car-911") {
    throw new Error("cardtap 分发的 carId 不匹配")
  }
})

simulateClick("车辆大图加载成功事件 (handleImageLoad) -> 状态标记成功", () => {
  carCard.handleImageLoad()
  if (carCard.data.imageLoading || carCard.data.imageFailed) {
    throw new Error("图片加载后 loading/failed 状态未恢复")
  }
})

simulateClick("车辆大图加载失败事件 (handleImageError) -> 错误兜底生效", () => {
  carCard.handleImageError()
  if (carCard.data.imageLoading) {
    throw new Error("图片异常后 loading 未结束")
  }
})

logSuite("2. 自定义组件: components/core-nav (全景底部导航栏)")
const coreNav = loadComponent("components/core-nav/core-nav")
if (typeof coreNav.attached === "function") coreNav.attached()

simulateClick("点击导航 Tab:「我的」页面 (handleNavigate: mine)", () => {
  coreNav.setData({ activeKey: "garage" })
  coreNav.handleNavigate(makeEvent({ key: "mine" }))
  const currentPage = pageStack[pageStack.length - 1]
  if (currentPage.route !== "pages/mine/mine") {
    throw new Error(`导航未能成功切换至 pages/mine/mine，当前为: ${currentPage.route}`)
  }
})

simulateClick("点击导航 Tab:「预约」页面 (handleNavigate: bookings)", () => {
  coreNav.setData({ activeKey: "mine" })
  coreNav.handleNavigate(makeEvent({ key: "bookings" }))
  const currentPage = pageStack[pageStack.length - 1]
  if (currentPage.route !== "pages/bookings/bookings") {
    throw new Error(`导航未能成功切换至 pages/bookings/bookings`)
  }
})

simulateClick("点击导航 Tab:「收藏」页面 (handleNavigate: favorites)", () => {
  coreNav.setData({ activeKey: "bookings" })
  coreNav.handleNavigate(makeEvent({ key: "favorites" }))
  const currentPage = pageStack[pageStack.length - 1]
  if (currentPage.route !== "pages/favorites/favorites") {
    throw new Error(`导航未能成功切换至 pages/favorites/favorites`)
  }
})

simulateClick("点击导航 Tab: 回到「车库」首页 (handleNavigate: garage)", () => {
  coreNav.setData({ activeKey: "favorites" })
  coreNav.handleNavigate(makeEvent({ key: "garage" }))
  const currentPage = pageStack[pageStack.length - 1]
  if (currentPage.route !== "pages/garage/garage") {
    throw new Error(`导航未能成功切换至 pages/garage/garage`)
  }
})

simulateClick("点击当前激活的导航 Tab -> 自动拦截无需重复跳转", () => {
  const stackLenBefore = pageStack.length
  coreNav.setData({ activeKey: "garage" })
  coreNav.handleNavigate(makeEvent({ key: "garage" }))
  if (pageStack.length !== stackLenBefore) {
    throw new Error("点击当前激活 Tab 时发生多余的入栈")
  }
})

// ========================================================================
// 2. 主包页面交互点击仿真 (13 个页面)
// ========================================================================
logSuite("3. 主包页面: pages/garage/garage (车库首页)")
const garagePage = loadPage("pages/garage/garage")

simulateClick("点击分类 Tab:「超级跑车」(handleCategoryTap)", () => {
  garagePage.handleCategoryTap(makeEvent({ categoryId: "supercar" }))
  if (garagePage.data.currentCategory !== "supercar") throw new Error("选中分类状态不匹配")
})

simulateClick("点击城市筛选:「上海」(handleCityFilterTap)", () => {
  garagePage.handleCityFilterTap(makeEvent({ city: "上海" }))
  if (garagePage.data.selectedCity !== "上海") throw new Error("选中城市状态不匹配")
})

simulateClick("点击可用性状态筛选:「可预约」(handleAvailabilityFilterTap)", () => {
  garagePage.handleAvailabilityFilterTap(makeEvent({ mode: "available" }))
  if (!garagePage.data.availableOnly) throw new Error("可用性筛选未开启")
})

simulateClick("点击「查看全部状态」重置筛选 (handleShowAllStatuses)", () => {
  garagePage.handleShowAllStatuses()
  if (garagePage.data.availableOnly) throw new Error("可用性筛选未关闭")
})

simulateClick("点击排序切换:「价格从低到高」(handleSortChange)", () => {
  garagePage.handleSortChange(makeEvent({ sort: "price_asc" }))
  if (garagePage.data.sortBy !== "price_asc") throw new Error("排序未切换为 price_asc")
})

simulateClick("在车型搜索框中输入关键字并实时过滤 (handleSearchInput)", () => {
  garagePage.handleSearchInput(makeEvent({}, { value: "保时捷" }))
  if (garagePage.data.searchKeyword !== "保时捷") throw new Error("搜索关键字未保存")
})

simulateClick("点击搜索框清空按钮 (handleClearSearch)", () => {
  garagePage.handleClearSearch()
  if (garagePage.data.searchKeyword !== "") throw new Error("搜索关键字未清空")
})

simulateClick("点击推荐场景指南入口 (handleContentGuideTap)", () => {
  garagePage.handleContentGuideTap(makeEvent({ slug: "weekend-short-trip-prep-2026" }))
})

simulateClick("点击拨打客服电话 (handlePhoneCall)", () => {
  garagePage.handlePhoneCall()
})

simulateClick("点击页面上拉触底加载更多 (handleLoadMore)", () => {
  garagePage.handleLoadMore()
})

simulateClick("点击网络异常或重试按钮 (handleRetryLoad)", () => {
  garagePage.handleRetryLoad()
})

simulateClick("点击车辆卡片进入详情 (handleCarTap)", () => {
  garagePage.handleCarTap(makeEvent({ carId: "car-911" }))
})

logSuite("4. 主包页面: pages/car-detail/car-detail (车辆详情)")
const carDetailPage = loadPage("pages/car-detail/car-detail", { carId: "car-911" })

simulateClick("滑动切换车辆头图轮播 (handleHeroSwiperChange)", () => {
  carDetailPage.handleHeroSwiperChange(makeEvent({}, { current: 1 }))
  if (carDetailPage.data.currentImageIndex !== 1) throw new Error("轮播当前索引未更新")
})

simulateClick("点击车辆头图预览全屏大图 (handleHeroImageTap)", () => {
  carDetailPage.handleHeroImageTap(makeEvent({ index: 0 }))
})

simulateClick("头图加载异常重试点击 (handleRetryHeroImage)", () => {
  carDetailPage.handleRetryHeroImage(makeEvent({ index: 0 }))
})

simulateClick("点击收藏/取消收藏按钮 (handleFavoriteTap)", () => {
  carDetailPage.handleFavoriteTap()
})

simulateClick("点击展开/折叠价格说明手风琴 (handleTogglePricing)", () => {
  const prev = carDetailPage.data.pricingExpanded
  carDetailPage.handleTogglePricing()
  if (carDetailPage.data.pricingExpanded === prev) throw new Error("价格折叠状态未反转")
})

simulateClick("点击展开/折叠用车规则手风琴 (handleToggleRentalRules)", () => {
  const prev = carDetailPage.data.rulesExpanded
  carDetailPage.handleToggleRentalRules()
  if (carDetailPage.data.rulesExpanded === prev) throw new Error("规则折叠状态未反转")
})

simulateClick("点击展开/折叠安心保障档案手风琴 (handleToggleTrustArchive)", () => {
  const prev = carDetailPage.data.trustExpanded
  carDetailPage.handleToggleTrustArchive()
  if (carDetailPage.data.trustExpanded === prev) throw new Error("档案折叠状态未反转")
})

simulateClick("点击生成专属分享海报 (handleOpenPosterModal)", () => {
  carDetailPage.handleOpenPosterModal()
  if (!carDetailPage.data.posterModalVisible) throw new Error("海报弹窗未开启")
})

simulateClick("点击保存分享海报图片 (handleSavePoster)", () => {
  carDetailPage.handleSavePoster()
})

simulateClick("点击关闭海报弹窗 (handleClosePosterModal)", () => {
  carDetailPage.handleClosePosterModal()
  if (carDetailPage.data.posterModalVisible) throw new Error("海报弹窗未关闭")
})

simulateClick("点击门店位置导航 (handleOpenLocation)", () => {
  carDetailPage.handleOpenLocation()
})

simulateClick("点击一键复制车辆专属编号 (handleCopyCarId)", () => {
  carDetailPage.handleCopyCarId()
})

simulateClick("点击微信专属管家咨询 (handleWechatConsult)", () => {
  carDetailPage.handleWechatConsult()
})

simulateClick("点击在线客服咨询 (handleOpenCustomerService)", () => {
  carDetailPage.handleOpenCustomerService()
})

simulateClick("点击拨打车库咨询电话 (handlePhoneCall)", () => {
  carDetailPage.handlePhoneCall()
})

simulateClick("点击关联场景指南推荐标签 (handleRelatedGuideTap)", () => {
  carDetailPage.handleRelatedGuideTap(makeEvent({ id: "guide-001", scene: "detail-recommend" }))
})

simulateClick("点击详情重试加载按钮 (handleRetryLoad)", () => {
  carDetailPage.handleRetryLoad()
})

simulateClick("点击「立即预订」跳转预约单 (handleBookingTap)", () => {
  carDetailPage.handleBookingTap()
})

simulateClick("点击返回车库首页 (handleBackGarage)", () => {
  carDetailPage.handleBackGarage()
})

logSuite("5. 主包页面: pages/booking/booking (预约提交)")
const bookingPage = loadPage("pages/booking/booking", { vehicleId: "car-911" })

simulateClick("输入联系人姓名 (handleInput: userName)", () => {
  bookingPage.handleInput(makeEvent({ field: "userName" }, { value: "李先生" }))
  if (bookingPage.data.form.userName !== "李先生") throw new Error("姓名录入失败")
})

simulateClick("输入联系电话 (handleInput: phone)", () => {
  bookingPage.handleInput(makeEvent({ field: "phone" }, { value: "13812345678" }))
  if (bookingPage.data.form.phone !== "13812345678") throw new Error("电话录入失败")
})

simulateClick("输入身份证件号码 (handleInput: idCard)", () => {
  bookingPage.handleInput(makeEvent({ field: "idCard" }, { value: "310101199001011234" }))
  if (bookingPage.data.form.idCard !== "310101199001011234") throw new Error("身份证录入失败")
})

simulateClick("输入特殊用车备注 (handleInput: remark)", () => {
  bookingPage.handleInput(makeEvent({ field: "remark" }, { value: "需要提前加满油" }))
  if (bookingPage.data.form.remark !== "需要提前加满油") throw new Error("备注录入失败")
})

simulateClick("快捷点击租期天数: 3天 (handleDateShortcut: three-days)", () => {
  bookingPage.handleDateShortcut(makeEvent({ action: "three-days" }))
})

simulateClick("选择取车/还车日期 (handleDateChange: startDate)", () => {
  bookingPage.handleDateChange(makeEvent({ field: "startDate" }, { value: "2026-10-01" }))
})

simulateClick("切换提车服务城市 (handleCityChange)", () => {
  bookingPage.handleCityChange(makeEvent({}, { value: 0 }))
})

simulateClick("切换接送网点/服务枢纽 (handlePickupHubChange)", () => {
  bookingPage.handlePickupHubChange(makeEvent({}, { value: 0 }))
})

simulateClick("主动勾选隐私与租车服务协议 (handlePrivacyAgreementChange)", () => {
  bookingPage.handlePrivacyAgreementChange(makeEvent({}, { value: ["agreed"] }))
  if (!bookingPage.data.privacyAgreed) throw new Error("隐私协议勾选未生效")
})

simulateClick("点击查看隐私与数据安全政策详情 (handleOpenPrivacyPolicy)", () => {
  bookingPage.handleOpenPrivacyPolicy()
})

simulateClick("点击提交预约订单 (handleSubmit)", () => {
  bookingPage.handleSubmit()
})

simulateClick("预约成功后点击查看预约详情 (handleViewSubmittedBooking)", () => {
  bookingPage.setData({ submittedBookingId: "bk-2026-001" })
  bookingPage.handleViewSubmittedBooking()
})

simulateClick("点击继续探索车库其他座驾 (handleContinueBrowse)", () => {
  bookingPage.handleContinueBrowse()
})

simulateClick("点击返回车库主页 (handleBackGarage)", () => {
  bookingPage.handleBackGarage()
})

logSuite("6. 主包页面: pages/bookings/bookings (我的预约列表)")
const bookingsPage = loadPage("pages/bookings/bookings")

simulateClick("点击切换预约状态筛选:「全部」(handleFilterTap: all)", () => {
  bookingsPage.handleFilterTap(makeEvent({ filter: "all" }))
  if (bookingsPage.data.currentFilter !== "all") throw new Error("状态筛选未切换为 all")
})

simulateClick("点击切换预约状态筛选:「进行中」(handleFilterTap: ongoing)", () => {
  bookingsPage.handleFilterTap(makeEvent({ filter: "ongoing" }))
  if (bookingsPage.data.currentFilter !== "ongoing") throw new Error("状态筛选未切换为 ongoing")
})

simulateClick("点击预约卡片查看单据详情 (handleViewDetail)", () => {
  bookingsPage.handleViewDetail(makeEvent({ id: "bk-2026-001" }))
})

simulateClick("点击取消预约单据 (handleCancel)", () => {
  bookingsPage.handleCancel(makeEvent({ id: "bk-2026-001" }))
})

simulateClick("点击重置展示全部预约 (handleShowAllBookings)", () => {
  bookingsPage.handleShowAllBookings()
})

simulateClick("点击上拉触底加载下一页预约 (handleLoadMore)", () => {
  bookingsPage.handleLoadMore()
})

simulateClick("点击网络重试加载预约 (handleRetryLoad)", () => {
  bookingsPage.handleRetryLoad()
})

logSuite("7. 主包页面: pages/booking-detail/booking-detail (预约详情与行程进度)")
const bookingDetailPage = loadPage("pages/booking-detail/booking-detail", { id: "bk-2026-001" })

simulateClick("点击一键复制预约单号 (handleCopyBookingId)", () => {
  bookingDetailPage.handleCopyBookingId()
})

simulateClick("点击紧急服务热线拨号 (handleEmergencyCall)", () => {
  bookingDetailPage.handleEmergencyCall()
})

simulateClick("点击取车门店位置导航 (handleOpenLocation)", () => {
  bookingDetailPage.handleOpenLocation()
})

simulateClick("点击关联车辆信息卡片查看车型 (handleViewVehicle)", () => {
  bookingDetailPage.handleViewVehicle()
})

simulateClick("点击开启/订阅服务状态变动通知 (handleRequestStatusSubscription)", () => {
  bookingDetailPage.handleRequestStatusSubscription()
})

simulateClick("点击展开/收起验车交接检查清单 (handleToggleChecklist)", () => {
  bookingDetailPage.handleToggleChecklist()
})

simulateClick("点击展开/收起座驾驾享安全指南 (handleToggleReadiness)", () => {
  bookingDetailPage.handleToggleReadiness()
})

simulateClick("点击查看尊享出行凭证 (handleViewVoucherCard)", () => {
  bookingDetailPage.handleViewVoucherCard()
  if (!bookingDetailPage.data.showVoucherModal) throw new Error("出行凭证弹窗未打开")
})

simulateClick("点击一键复制尊享出行凭证信息 (handleCopyBookingId: voucher)", () => {
  bookingDetailPage.handleCopyBookingId(makeEvent({ type: "voucher" }))
})

simulateClick("点击关闭尊享出行凭证弹窗 (handleCloseVoucherCard)", () => {
  bookingDetailPage.handleCloseVoucherCard()
  if (bookingDetailPage.data.showVoucherModal) throw new Error("出行凭证弹窗未关闭")
})

simulateClick("点击查看交接单验车照片大图 (handlePreviewHandoverPhoto)", () => {
  bookingDetailPage.handlePreviewHandoverPhoto(makeEvent({ url: "https://example.com/handover.jpg" }))
})

simulateClick("点击接受最新报价明细 (handleConfirmQuote)", () => {
  bookingDetailPage.handleConfirmQuote()
})

simulateClick("输入议价/需求调整意见 (handleAdjustmentInput)", () => {
  bookingDetailPage.handleAdjustmentInput(makeEvent({}, { value: "希望包含尊享保险" }))
  if (bookingDetailPage.data.adjustmentNote !== "希望包含尊享保险") throw new Error("议价输入未保存")
})

simulateClick("点击申请重新议价调整 (handleRequestQuoteAdjustment)", () => {
  bookingDetailPage.handleRequestQuoteAdjustment()
})

simulateClick("点击进入联系人修改模式 (handleStartEdit)", () => {
  bookingDetailPage.setData({ canEdit: true, loading: false })
  bookingDetailPage.handleStartEdit()
  if (!bookingDetailPage.data.editing) throw new Error("编辑状态未开启")
})

simulateClick("输入修改后的手机号 (handleEditInput)", () => {
  bookingDetailPage.handleEditInput(makeEvent({ field: "phone" }, { value: "13988887777" }))
})

simulateClick("点击保存联系人修改 (handleSaveEdit)", () => {
  bookingDetailPage.handleSaveEdit()
})

simulateClick("点击取消编辑模式 (handleCancelEdit)", () => {
  bookingDetailPage.handleCancelEdit()
  if (bookingDetailPage.data.isEditing) throw new Error("编辑状态未退出")
})

simulateClick("点击同步预约行程至系统日历 (handleAddToCalendar)", () => {
  bookingDetailPage.handleAddToCalendar()
})

simulateClick("点击取消该预约行程 (handleCancel)", () => {
  bookingDetailPage.handleCancel()
})

simulateClick("点击返回预约列表 (handleBackBookings)", () => {
  bookingDetailPage.handleBackBookings()
})

simulateClick("点击网络重试加载单据 (handleRetryLoad)", () => {
  bookingDetailPage.handleRetryLoad()
})

logSuite("8. 主包页面: pages/favorites/favorites (我的收藏)")
const favoritesPage = loadPage("pages/favorites/favorites")

simulateClick("点击筛选: 仅看可预约车型 (handleFilterTap: available)", () => {
  favoritesPage.setData({ availableOnly: false })
  favoritesPage.handleFilterTap(makeEvent({ mode: "available" }))
  if (!favoritesPage.data.availableOnly) throw new Error("仅看可用筛选未生效")
})

simulateClick("点击重置查看全部收藏 (handleShowAll)", () => {
  favoritesPage.handleShowAll()
  if (favoritesPage.data.availableOnly) throw new Error("筛选未重置")
})

simulateClick("点击移除收藏项 (handleRemove)", () => {
  favoritesPage.handleRemove(makeEvent({ carId: "car-911" }))
})

simulateClick("点击撤销刚刚的移除收藏操作 (handleUndoRemove)", () => {
  favoritesPage.handleUndoRemove()
})

simulateClick("点击「去车库逛逛」入口 (handleBrowseGarage)", () => {
  favoritesPage.handleBrowseGarage()
})

simulateClick("点击触底加载更多收藏 (handleLoadMore)", () => {
  favoritesPage.handleLoadMore()
})

simulateClick("点击重试加载收藏 (handleRetry)", () => {
  favoritesPage.handleRetry()
})

logSuite("9. 主包页面: pages/content-page/content-page (场景指南/攻略与规则)")
const contentPage = loadPage("pages/content-page/content-page", { type: "guide", slug: "weekend-short-trip-prep-2026" })

simulateClick("点击指南分类 Tab (handleContentTabTap)", () => {
  contentPage.handleContentTabTap(makeEvent({ slug: "weekend-short-trip-prep-2026" }))
})

simulateClick("点击手风琴段落展开/折叠 (handleSectionTap)", () => {
  contentPage.handleSectionTap(makeEvent({ index: 0 }))
})

simulateClick("点击攻略推荐关联车型 (handleGuideVehicleTap)", () => {
  contentPage.handleGuideVehicleTap(makeEvent({ carId: "car-911" }))
})

simulateClick("点击攻略底部立即预订专属座驾 (handleGuideBookingTap)", () => {
  contentPage.handleGuideBookingTap(makeEvent({ carId: "car-911" }))
})

simulateClick("点击在线客服咨询指南 (handleOpenCustomerService)", () => {
  contentPage.handleOpenCustomerService()
})

simulateClick("点击电话咨询路线管家 (handlePhoneCall)", () => {
  contentPage.handlePhoneCall()
})

simulateClick("点击行使隐私数据权利入口 (handlePrivacyRequest)", () => {
  contentPage.handlePrivacyRequest()
})

simulateClick("点击指南加载重试 (handleGuideRetry)", () => {
  contentPage.handleGuideRetry()
})

logSuite("10. 主包页面: pages/privacy-request/privacy-request (个人信息与隐私权申请)")
const privacyReqPage = loadPage("pages/privacy-request/privacy-request")

simulateClick("点击选择权利类型:「删除信息」(handleTypeTap: deletion)", () => {
  privacyReqPage.handleTypeTap(makeEvent({ value: "deletion" }))
  if (privacyReqPage.data.currentType !== "deletion") throw new Error("权利类型未选中 deletion")
})

simulateClick("输入申请补充说明 (handleDescriptionInput)", () => {
  privacyReqPage.handleDescriptionInput(makeEvent({}, { value: "申请调阅近三个月租车合同与发票流水" }))
  if (privacyReqPage.data.description !== "申请调阅近三个月租车合同与发票流水") throw new Error("申请说明未保存")
})

simulateClick("点击提交隐私申请 (handleSubmit)", () => {
  privacyReqPage.handleSubmit()
})

simulateClick("点击撤销已提交申请 (handleCancelRequest)", () => {
  privacyReqPage.handleCancelRequest(makeEvent({ id: "req-001" }))
})

simulateClick("点击申请记录状态过滤:「已完成」(handleRecordFilterTap: completed)", () => {
  privacyReqPage.handleRecordFilterTap(makeEvent({ filter: "completed" }))
})

simulateClick("点击展示全部申请历史 (handleShowAllRecords)", () => {
  privacyReqPage.handleShowAllRecords()
})

simulateClick("点击加载更多申请记录 (handleLoadMore)", () => {
  privacyReqPage.handleLoadMore()
})

simulateClick("点击重试拉取记录 (handleRetry)", () => {
  privacyReqPage.handleRetry()
})

logSuite("11. 主包页面: pages/mine/mine (个人中心与运维入口)")
const minePage = loadPage("pages/mine/mine")

simulateClick("点击个人中心权限刷新 (handlePermissionRetry)", () => {
  minePage.handlePermissionRetry()
})

simulateClick("点击运营脉搏指标卡 (handleOperationPulseTap)", () => {
  minePage.handleOperationPulseTap()
})

simulateClick("点击版本更新说明 (handleShowReleaseNotes)", () => {
  minePage.handleShowReleaseNotes()
})

simulateClick("点击客服中心 (handleOpenCustomerService)", () => {
  minePage.handleOpenCustomerService()
})

simulateClick("点击咨询热线 (handlePhoneCall)", () => {
  minePage.handlePhoneCall()
})

// 仿真点击全部功能与管理菜单入口
const menuKeys = [
  "favorites", "bookings", "privacyRequest", "privacy", "rules", "faq",
  "vehicleManage", "vehicleCreate", "bookingManage", "bookingWorkbench",
  "bookingCalendar", "operationsOverview", "analyticsManage", "roleManage",
  "configManage", "systemHealth", "auditLogManage", "errorLogManage",
  "privacyRequestManage", "storageCleanup"
]

menuKeys.forEach((key) => {
  simulateClick(`点击功能菜单项: ${key} (handleMenuTap)`, () => {
    minePage.handleMenuTap(makeEvent({ key, title: key }))
  })
})

logSuite("12. 主包页面: pages/booking-calendar/booking-calendar (预约档期日历)")
const calendarPage = loadPage("pages/booking-calendar/booking-calendar")
calendarPage.setData({
  vehicles: [{ id: "car-911", name: "保时捷 911 Carrera S" }],
  allBlocks: [{ id: "blk-001", vehicleId: "car-911", kind: "maintenance", startDate: "2026-10-15", endDate: "2026-10-16" }],
  allPriceRules: [{ id: "rule-001", vehicleId: "car-911", label: "国庆上浮", startDate: "2026-10-01", endDate: "2026-10-07", dailyPrice: 3500 }]
})

simulateClick("点击切换上一月 (handlePreviousMonth)", () => {
  calendarPage.handlePreviousMonth()
})

simulateClick("点击切换下一月 (handleNextMonth)", () => {
  calendarPage.handleNextMonth()
})

simulateClick("点击快速回到本月 (handleCurrentMonth)", () => {
  calendarPage.handleCurrentMonth()
})

simulateClick("点击日历网格日期单元格 (handleDateTap)", () => {
  const targetDate = `${calendarPage.data.monthKey}-15`
  calendarPage.handleDateTap(makeEvent({ date: targetDate }))
  if (calendarPage.data.selectedDate !== targetDate) throw new Error("选中日期不匹配")
})

simulateClick("输入停用锁档原因 (handleCalendarFormInput: reason)", () => {
  calendarPage.handleCalendarFormInput(makeEvent({ form: "blockForm", field: "reason" }, { value: "全车深度养护" }))
  if (calendarPage.data.blockForm.reason !== "全车深度养护") throw new Error("锁档原因未保存")
})

simulateClick("选择锁档适用车型 (handleBlockVehicleChange)", () => {
  calendarPage.handleBlockVehicleChange(makeEvent({}, { value: 0 }))
})

simulateClick("选择锁档类型 (handleBlockKindChange)", () => {
  calendarPage.handleBlockKindChange(makeEvent({}, { value: 0 }))
})

simulateClick("点击保存锁档规则 (handleSaveBlock)", () => {
  calendarPage.handleSaveBlock()
})

simulateClick("点击编辑已有锁档规则 (handleEditBlock)", () => {
  calendarPage.handleEditBlock(makeEvent({ id: "blk-001" }))
})

simulateClick("点击释放锁档占用 (handleReleaseBlock)", () => {
  calendarPage.handleReleaseBlock(makeEvent({ id: "blk-001" }))
})

simulateClick("点击重置锁档表单 (handleResetBlockForm)", () => {
  calendarPage.handleResetBlockForm()
})

simulateClick("选择改价适用车型 (handlePriceVehicleChange)", () => {
  calendarPage.handlePriceVehicleChange(makeEvent({}, { value: 0 }))
})

simulateClick("输入浮动价格调整比例 (handleCalendarFormInput: dailyPrice)", () => {
  calendarPage.handleCalendarFormInput(makeEvent({ form: "priceForm", field: "dailyPrice" }, { value: "3200" }))
})

simulateClick("点击保存价格规则 (handleSavePriceRule)", () => {
  calendarPage.handleSavePriceRule()
})

simulateClick("点击编辑已有价格规则 (handleEditPriceRule)", () => {
  calendarPage.handleEditPriceRule(makeEvent({ id: "rule-001" }))
})

simulateClick("点击停用已有价格规则 (handleReleasePriceRule)", () => {
  calendarPage.handleReleasePriceRule(makeEvent({ id: "rule-001" }))
})

simulateClick("点击重置价格规则表单 (handleResetPriceForm)", () => {
  calendarPage.handleResetPriceForm()
})

simulateClick("点击一键同步占用排期 (handleSyncBookingOccupancy)", () => {
  calendarPage.handleSyncBookingOccupancy(makeEvent({ id: "blk-001" }))
})

simulateClick("点击重试日历加载 (handleRetry)", () => {
  calendarPage.handleRetry()
})

logSuite("13. 主包页面: pages/booking-workbench/booking-workbench (预约运营工作台)")
const wbPage = loadPage("pages/booking-workbench/booking-workbench")

simulateClick("点击状态概览指标卡:「待确认」(handleSummaryTap: pending)", () => {
  wbPage.handleSummaryTap(makeEvent({ key: "pending" }))
})

simulateClick("点击优先级标签:「紧急加急」(handleFilterTap: urgent)", () => {
  wbPage.handleFilterTap(makeEvent({ filter: "urgent" }))
})

simulateClick("点击工作台列表排序:「创建时间倒序」(handleSortTap: created_desc)", () => {
  wbPage.handleSortTap(makeEvent({ sort: "created_desc" }))
})

simulateClick("在工作台搜索框输入客户/单号并查询 (handleKeywordInput)", () => {
  wbPage.handleKeywordInput(makeEvent({}, { value: "张先生" }))
  if (wbPage.data.keyword !== "张先生") throw new Error("搜索关键字未保存")
})

simulateClick("点击清空工作台搜索关键词 (handleClearKeyword)", () => {
  wbPage.handleClearKeyword()
  if (wbPage.data.keyword !== "") throw new Error("搜索关键字未清空")
})

simulateClick("点击预约卡片快速呼叫客户 (handleCallPhone)", () => {
  wbPage.handleCallPhone(makeEvent({ phone: "13800000000" }))
})

simulateClick("点击一键复制客户电话 (handleCopyPhone)", () => {
  wbPage.handleCopyPhone(makeEvent({ phone: "13800000000" }))
})

simulateClick("点击调整单据优先级 (handlePriorityTap: high)", () => {
  wbPage.handlePriorityTap(makeEvent({ id: "bk-2026-001", priority: "high" }))
})

simulateClick("点击一键快捷调度确认 (handleQuickCoordination: confirm)", () => {
  wbPage.handleQuickCoordination(makeEvent({ id: "bk-2026-001", action: "confirm" }))
})

simulateClick("点击标记客户已电联对接 (handleMarkContacted)", () => {
  wbPage.handleMarkContacted(makeEvent({ id: "bk-2026-001" }))
})

simulateClick("点击打开工作台备注弹窗 (handleOpenRemark)", () => {
  wbPage.handleOpenRemark(makeEvent({ id: "bk-2026-001" }))
  if (wbPage.data.editingRemarkId !== "bk-2026-001") throw new Error("备注弹窗未打开")
})

simulateClick("在弹窗中输入内部跟进批注 (handleRemarkInput)", () => {
  wbPage.handleRemarkInput(makeEvent({}, { value: "已确认客户需要专人送车至虹桥机场" }))
  if (wbPage.data.remarkDraft !== "已确认客户需要专人送车至虹桥机场") throw new Error("批注未保存")
})

simulateClick("点击保存跟进批注 (handleSaveRemark)", () => {
  wbPage.handleSaveRemark()
})

simulateClick("点击取消备注弹窗 (handleCancelRemark)", () => {
  wbPage.handleCancelRemark()
  if (wbPage.data.editingRemarkId) throw new Error("备注弹窗未关闭")
})

simulateClick("点击跳转全量预约管理台 (handleOpenBookingManage)", () => {
  wbPage.handleOpenBookingManage()
})

simulateClick("点击手动全量刷新工作台数据 (handleManualRefresh)", () => {
  wbPage.handleManualRefresh()
})

simulateClick("点击重置工作台视图 (handleResetView)", () => {
  wbPage.handleResetView()
})

simulateClick("点击重试加载工作台 (handleRetry)", () => {
  wbPage.handleRetry()
})

simulateClick("点击按客户标签快速筛选待办 (handleTagFilter: 需要送车)", () => {
  wbPage.handleTagFilter(makeEvent({ tag: "需要送车" }))
  if (wbPage.data.selectedTag !== "需要送车") throw new Error("标签筛选未生效")
  wbPage.handleTagFilter(makeEvent({ tag: "需要送车" }))
  if (wbPage.data.selectedTag !== "") throw new Error("取消标签筛选未生效")
})

logSuite("14. 主包页面: pages/booking-manage/booking-manage (预约管理列表)")
const bmPage = loadPage("pages/booking-manage/booking-manage")

simulateClick("输入管理台过滤关键词 (handleKeywordInput)", () => {
  bmPage.handleKeywordInput(makeEvent({}, { value: "bk-2026-001" }))
  if (bmPage.data.keyword !== "bk-2026-001") throw new Error("关键词未保存")
})

simulateClick("回车确认关键词搜索 (handleKeywordConfirm)", () => {
  bmPage.handleKeywordConfirm()
})

simulateClick("点击搜索放大镜按钮 (handleSearch)", () => {
  bmPage.handleSearch()
})

simulateClick("点击清空关键词 (handleClearKeyword)", () => {
  bmPage.handleClearKeyword()
  if (bmPage.data.keyword !== "") throw new Error("关键词未清空")
})

simulateClick("点击状态过滤标签:「全部」(handleStatusTap: all)", () => {
  bmPage.handleStatusTap(makeEvent({ status: "all" }))
})

simulateClick("点击优先级过滤标签:「普通」(handlePriorityTap: normal)", () => {
  bmPage.handlePriorityTap(makeEvent({ priority: "normal" }))
})

simulateClick("点击调度过滤标签:「全部」(handleCoordinationTap: all)", () => {
  bmPage.handleCoordinationTap(makeEvent({ coordination: "all" }))
})

simulateClick("点击城市过滤标签:「全部」(handleCityTap: all)", () => {
  bmPage.handleCityTap(makeEvent({ city: "all" }))
})

simulateClick("点击重置全部筛选条件 (handleReset)", () => {
  bmPage.handleReset()
})

simulateClick("点击预约项进入管理详情 (handleViewDetail)", () => {
  bmPage.handleViewDetail(makeEvent({ id: "bk-2026-001" }))
})

simulateClick("快速变更预约单状态:「已确认」(handleUpdateStatus: confirmed)", () => {
  bmPage.handleUpdateStatus(makeEvent({ id: "bk-2026-001", status: "confirmed" }))
})

simulateClick("输入管理台行内备注 (handleRemarkInput)", () => {
  bmPage.handleRemarkInput(makeEvent({}, { value: "已安排值班专员" }))
})

simulateClick("保存管理台行内备注 (handleSaveRemark)", () => {
  bmPage.handleSaveRemark(makeEvent({ id: "bk-2026-001" }))
})

simulateClick("点击直接外呼客户电话 (handleCallPhone)", () => {
  bmPage.handleCallPhone(makeEvent({ phone: "13800000000" }))
})

simulateClick("点击导出预约台账 CSV (handleExport)", () => {
  bmPage.handleExport()
})

simulateClick("点击打开导出的 CSV 报表 (handleOpenExportedFile)", () => {
  bmPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  bmPage.handleOpenExportedFile()
})

simulateClick("点击分享导出的 CSV 文件 (handleShareExportedFile)", () => {
  bmPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  bmPage.handleShareExportedFile()
})

simulateClick("点击清理已导出的本地文件缓存 (handleDeleteExportedFile)", () => {
  bmPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  bmPage.handleDeleteExportedFile()
})

simulateClick("点击上拉触底翻页 (handleLoadMore)", () => {
  bmPage.handleLoadMore()
})

logSuite("15. 主包页面: pages/booking-manage-detail/booking-manage-detail (预约管理单据详情)")
const bmdPage = loadPage("pages/booking-manage-detail/booking-manage-detail", { id: "bk-2026-001" })

simulateClick("流转更新单据状态 (handleUpdateStatus: in_progress)", () => {
  bmdPage.handleUpdateStatus(makeEvent({ status: "in_progress" }))
})

simulateClick("流转更新车辆调度状态 (handleUpdateCoordination: coordinating)", () => {
  bmdPage.handleUpdateCoordination(makeEvent({ field: "coordinationStatus", value: "coordinating" }))
})

simulateClick("外呼客户联系电话 (handleCallPhone)", () => {
  bmdPage.handleCallPhone()
})

simulateClick("一键复制客户完整联络资料 (handleCopyContact)", () => {
  bmdPage.handleCopyContact(makeEvent({ field: "phone" }))
})

simulateClick("输入管理员内部批注 (handleRemarkInput)", () => {
  bmdPage.handleRemarkInput(makeEvent({}, { value: "客户要求准时送达" }))
  if (bmdPage.data.booking.adminRemarkDraft !== "客户要求准时送达") throw new Error("批注未录入")
})

simulateClick("点击保存管理员内部批注 (handleSaveRemark)", () => {
  bmdPage.handleSaveRemark()
})

simulateClick("输入报价调整金额 (handleQuoteInput: baseRentalAmount)", () => {
  bmdPage.handleQuoteInput(makeEvent({ field: "baseRentalAmount" }, { value: "5800" }))
  if (bmdPage.data.quoteForm.baseRentalAmount !== "5800") throw new Error("报价金额未录入")
})

simulateClick("选择报价截止有效时间 (handleQuoteValidUntilChange)", () => {
  bmdPage.handleQuoteValidUntilChange(makeEvent({}, { value: "2026-10-01 18:00" }))
})

simulateClick("点击保存报价草稿 (handleSaveQuoteDraft)", () => {
  bmdPage.handleSaveQuoteDraft()
})

simulateClick("点击正式下发报价单给客户 (handleSendQuote)", () => {
  bmdPage.handleSendQuote()
})

simulateClick("点击作废当前报价单 (handleExpireQuote)", () => {
  bmdPage.handleExpireQuote(makeEvent({ id: "quote-001" }))
})

simulateClick("切换验车交接流程环节:「取车交验」(handleHandoverStageChange: pickup)", () => {
  bmdPage.handleHandoverStageChange(makeEvent({ stage: "pickup" }))
})

simulateClick("选择车辆交接当前能源类型 (handleHandoverEnergyType)", () => {
  bmdPage.handleHandoverEnergyType(makeEvent({}, { value: 0 }))
})

simulateClick("录入交接表单当前里程数 (handleHandoverInput: mileageKm)", () => {
  bmdPage.handleHandoverInput(makeEvent({ field: "mileageKm" }, { value: "18500" }))
  if (bmdPage.data.handoverForm.mileageKm !== "18500") throw new Error("里程数未保存")
})

simulateClick("点击拍照/上传验车照片 (handleChooseHandoverPhoto)", () => {
  bmdPage.handleChooseHandoverPhoto(makeEvent({ angle: "front" }))
})

simulateClick("点击全屏预览验车照片 (handlePreviewHandoverPhoto)", () => {
  bmdPage.handlePreviewHandoverPhoto(makeEvent({ url: "wxfile://tmp_photo.jpg" }))
})

simulateClick("点击提交本次验车记录 (handleSubmitHandover)", () => {
  bmdPage.handleSubmitHandover()
})

simulateClick("点击归档交接档案 (handleArchiveHandover)", () => {
  bmdPage.handleArchiveHandover(makeEvent({ id: "ho-001", stage: "pickup" }))
})

simulateClick("点击导出交接验车留证单 (handleExportHandoverReport)", () => {
  bmdPage.handleExportHandoverReport(makeEvent({ id: "ho-001" }))
})

simulateClick("点击打开导出的验车留证单 (handleOpenExportedHandover)", () => {
  bmdPage.setData({ exportedHandoverPath: "wxfile://tmp_handover.csv" })
  bmdPage.handleOpenExportedHandover()
})

simulateClick("点击转发分享导出的验车留证单 (handleShareExportedHandover)", () => {
  bmdPage.setData({ exportedHandoverPath: "wxfile://tmp_handover.csv" })
  bmdPage.handleShareExportedHandover()
})

simulateClick("点击清理本地验车留证单缓存 (handleDeleteExportedHandover)", () => {
  bmdPage.setData({ exportedHandoverPath: "wxfile://tmp_handover.csv" })
  bmdPage.handleDeleteExportedHandover()
  if (bmdPage.data.exportedHandoverPath) throw new Error("留证单缓存未清除")
})

simulateClick("点击为客户打上跟进标签 (handleToggleCustomerTag: 高意向)", () => {
  if (!bmdPage.data.booking) bmdPage.setData({ booking: { tags: [] } })
  else if (!Array.isArray(bmdPage.data.booking.tags)) bmdPage.setData({ "booking.tags": [] })
  bmdPage.handleToggleCustomerTag(makeEvent({ tag: "高意向" }))
  if (!bmdPage.data.booking.tags.includes("高意向")) throw new Error("客户标签添加未生效")
  bmdPage.handleToggleCustomerTag(makeEvent({ tag: "高意向" }))
  if (bmdPage.data.booking.tags.includes("高意向")) throw new Error("客户标签取消未生效")
})

simulateClick("点击返回管理列表 (handleBackManage)", () => {
  bmdPage.handleBackManage()
})

simulateClick("点击重试拉取单据详情 (handleRetryLoad)", () => {
  bmdPage.handleRetryLoad()
})

// ========================================================================
// 3. 管理员分包页面交互点击仿真 (13 个页面)
// ========================================================================
logSuite("16. 分包页面: pages-admin/vehicle-manage/vehicle-manage (车队管理列表)")
const vmPage = loadPage("pages-admin/vehicle-manage/vehicle-manage")

simulateClick("输入车辆搜索关键字 (handleKeywordInput)", () => {
  vmPage.handleKeywordInput(makeEvent({}, { value: "保时捷" }))
  if (vmPage.data.keyword !== "保时捷") throw new Error("车辆关键字未保存")
})

simulateClick("回车确认车辆搜索 (handleKeywordConfirm)", () => {
  vmPage.handleKeywordConfirm()
})

simulateClick("点击清空车辆搜索关键字 (handleClearKeyword)", () => {
  vmPage.handleClearKeyword()
  if (vmPage.data.keyword !== "") throw new Error("车辆关键字未清空")
})

simulateClick("切换车队状态标签:「在用」(handleStatusTap: active)", () => {
  vmPage.handleStatusTap(makeEvent({ status: "active" }))
})

simulateClick("点击重置车队筛选 (handleReset)", () => {
  vmPage.handleReset()
})

simulateClick("点击车辆卡片进入详情管理 (handleViewDetail)", () => {
  vmPage.handleViewDetail(makeEvent({ id: "car-911" }))
})

simulateClick("点击快速调整车辆运营状态 (handleUpdateStatus)", () => {
  vmPage.handleUpdateStatus(makeEvent({ id: "car-911", status: "idle" }))
})

simulateClick("点击编辑车辆信息 (handleEdit)", () => {
  vmPage.handleEdit(makeEvent({ id: "car-911" }))
})

simulateClick("点击临时停用车队座驾 (handleRetire)", () => {
  vmPage.handleRetire(makeEvent({ id: "car-911" }))
})

simulateClick("点击恢复停用车队座驾 (handleRestore)", () => {
  vmPage.handleRestore(makeEvent({ id: "car-911" }))
})

simulateClick("点击删除车辆记录 (handleDelete)", () => {
  vmPage.handleDelete(makeEvent({ id: "car-911" }))
})

simulateClick("点击右上角「新增车辆」入口 (handleGoCreate)", () => {
  vmPage.handleGoCreate()
})

simulateClick("点击切换维保预警过滤 (handleToggleMaintenanceFilter)", () => {
  vmPage.handleToggleMaintenanceFilter()
  if (!vmPage.data.filterMaintenanceOnly) throw new Error("维保过滤开启失败")
  vmPage.handleToggleMaintenanceFilter()
  if (vmPage.data.filterMaintenanceOnly) throw new Error("维保过滤关闭失败")
})

simulateClick("点击车辆快捷排期维保 (handleScheduleMaintenance)", () => {
  vmPage.handleScheduleMaintenance(makeEvent({ id: "car-911" }))
})

simulateClick("点击车队列表触底翻页 (handleLoadMore)", () => {
  vmPage.handleLoadMore()
})

logSuite("17. 分包页面: pages-admin/vehicle-create/vehicle-create (录入新座驾)")
const vcPage = loadPage("pages-admin/vehicle-create/vehicle-create")
vcPage.setData({ isSubmitting: false, pageAuthorized: true })

simulateClick("输入车辆品牌与型号 (handleTextInput: brandModel)", () => {
  vcPage.handleTextInput(makeEvent({ field: "brandModel" }, { value: "法拉利 SF90 Stradale" }))
  if (vcPage.data.form.brandModel !== "法拉利 SF90 Stradale") throw new Error("品牌型号录入失败")
})

simulateClick("输入车牌号码 (handlePlateInput)", () => {
  vcPage.handlePlateInput(makeEvent({}, { value: "沪A99999" }))
  if (vcPage.data.form.plateNumber !== "沪A99999") throw new Error("车牌录入失败")
})

simulateClick("选择车辆类型: 跑车 (handleVehicleTypeChange: sports)", () => {
  vcPage.handleVehicleTypeChange(makeEvent({}, { value: 3 }))
})

simulateClick("选择变速箱形式: 自动挡 (handleTransmissionChange: automatic)", () => {
  vcPage.handleTransmissionChange(makeEvent({}, { value: 1 }))
})

simulateClick("选择动力形式: 混动 (handleFuelTypeChange: hybrid)", () => {
  vcPage.handleFuelTypeChange(makeEvent({}, { value: 2 }))
})

simulateClick("选择初始运营状态: 闲置可用 (handleStatusChange: idle)", () => {
  vcPage.handleStatusChange(makeEvent({}, { value: 0 }))
})

simulateClick("选择上牌登记日期 (handleDateChange: registrationDate)", () => {
  vcPage.handleDateChange(makeEvent({ field: "registrationDate" }, { value: "2026-06-01" }))
})

simulateClick("点击确认提交录入车辆 (handleSubmit)", () => {
  vcPage.handleSubmit()
})

logSuite("18. 分包页面: pages-admin/vehicle-edit/vehicle-edit (编辑车辆资料)")
const vePage = loadPage("pages-admin/vehicle-edit/vehicle-edit", { id: "car-911" })
vePage.setData({ isSubmitting: false, loading: false, pageAuthorized: true })

simulateClick("修改车辆品牌型号 (handleTextInput: brandModel)", () => {
  vePage.handleTextInput(makeEvent({ field: "brandModel" }, { value: "保时捷 911 Carrera S (2026款)" }))
  if (vePage.data.form.brandModel !== "保时捷 911 Carrera S (2026款)") throw new Error("品牌型号未更新")
})

simulateClick("修改车辆车牌 (handlePlateInput)", () => {
  vePage.handlePlateInput(makeEvent({}, { value: "沪A91188" }))
})

simulateClick("修改车型分类 (handleVehicleTypeChange)", () => {
  vePage.handleVehicleTypeChange(makeEvent({}, { value: 3 }))
})

simulateClick("修改变速箱类型 (handleTransmissionChange)", () => {
  vePage.handleTransmissionChange(makeEvent({}, { value: 1 }))
})

simulateClick("修改能源类型 (handleFuelTypeChange)", () => {
  vePage.handleFuelTypeChange(makeEvent({}, { value: 0 }))
})

simulateClick("修改运营状态 (handleStatusChange)", () => {
  vePage.handleStatusChange(makeEvent({}, { value: 0 }))
})

simulateClick("修改上牌日期 (handleDateChange)", () => {
  vePage.handleDateChange(makeEvent({}, { value: "2025-05-20" }))
})

simulateClick("修改保养归档日期 (handleArchiveDateChange)", () => {
  vePage.handleArchiveDateChange(makeEvent({}, { value: "2026-09-01" }))
})

simulateClick("修改年检复核日期 (handleArchiveReviewChange)", () => {
  vePage.handleArchiveReviewChange(makeEvent({}, { value: "2027-05-01" }))
})

simulateClick("点击跳转相册图集维护 (handleManageImages)", () => {
  vePage.handleManageImages()
})

simulateClick("点击保存车辆修改 (handleSubmit)", () => {
  vePage.handleSubmit()
})

simulateClick("点击返回车队列表 (handleBackList)", () => {
  vePage.handleBackList()
})

simulateClick("点击重试加载车辆资料 (handleRetryLoad)", () => {
  vePage.handleRetryLoad()
})

logSuite("19. 分包页面: pages-admin/vehicle-detail-manage/vehicle-detail-manage (车辆详情与相册管理)")
const vdmPage = loadPage("pages-admin/vehicle-detail-manage/vehicle-detail-manage", { id: "car-911" })

simulateClick("修改车辆运营状态 (handleUpdateStatus: maintenance)", () => {
  vdmPage.handleUpdateStatus(makeEvent({ status: "maintenance" }))
})

simulateClick("停用该车辆 (handleRetire)", () => {
  vdmPage.handleRetire()
})

simulateClick("恢复该车辆 (handleRestore)", () => {
  vdmPage.handleRestore()
})

simulateClick("点击跳转编辑车辆 (handleEdit)", () => {
  vdmPage.handleEdit()
})

simulateClick("点击批量上传车辆新照片 (handleUploadImages)", () => {
  vdmPage.handleUploadImages()
})

simulateClick("点击取消正在进行的文件上传 (handleCancelUpload)", () => {
  vdmPage.handleCancelUpload()
})

simulateClick("点击重试上传失败的图片 (handleRetryFailedUploads)", () => {
  vdmPage.handleRetryFailedUploads()
})

simulateClick("点击设为车辆主封面图 (handleSetCover)", () => {
  vdmPage.handleSetCover(makeEvent({ url: "https://example.com/911-1.jpg" }))
})

simulateClick("点击删除图库中冗余照片 (handleRemoveImage)", () => {
  vdmPage.handleRemoveImage(makeEvent({ url: "https://example.com/911-2.jpg" }))
})

simulateClick("点击大图预览车辆照片 (handlePreviewImage)", () => {
  vdmPage.handlePreviewImage(makeEvent({ url: "https://example.com/911-1.jpg" }))
})

simulateClick("点击返回车队列表 (handleBackList)", () => {
  vdmPage.handleBackList()
})

logSuite("20. 分包页面: pages-admin/operations-overview/operations-overview (运营概览大盘)")
const ooPage = loadPage("pages-admin/operations-overview/operations-overview")

simulateClick("点击刷新大盘数据 (handleRefresh)", () => {
  ooPage.handleRefresh()
})

simulateClick("点击快速跳转车队管理模块 (handleRouteTap: vehicleManage)", () => {
  ooPage.handleRouteTap(makeEvent({ url: "/pages-admin/vehicle-manage/vehicle-manage" }))
})

simulateClick("点击快速跳转预约工作台模块 (handleRouteTap: bookingWorkbench)", () => {
  ooPage.handleRouteTap(makeEvent({ url: "/pages/booking-workbench/booking-workbench" }))
})

logSuite("21. 分包页面: pages-admin/analytics-manage/analytics-manage (数据分析与指标统计)")
const amPage = loadPage("pages-admin/analytics-manage/analytics-manage")
amPage.setData({ loading: false, cleanupLoading: false, pageAuthorized: true })

simulateClick("点击切换时间周期:「近 30 天」(handlePeriodTap: 30)", () => {
  amPage.handlePeriodTap(makeEvent({ days: 30 }))
  if (amPage.data.days !== 30) throw new Error("周期未切换为 30")
})

simulateClick("点击切换热度排行:「Top 10」(handleTopNTap: 10)", () => {
  amPage.handleTopNTap(makeEvent({ topn: 10 }))
  if (amPage.data.topN !== 10) throw new Error("TopN 未切换为 10")
})

simulateClick("点击清理超期历史埋点日志 (handleCleanup)", () => {
  amPage.handleCleanup()
})

simulateClick("点击重试拉取统计图表 (handleRetry)", () => {
  amPage.handleRetry()
})

logSuite("22. 分包页面: pages-admin/role-manage/role-manage (管理员权限管理)")
const rmPage = loadPage("pages-admin/role-manage/role-manage")
rmPage.setData({ loading: false, saving: false, pageAuthorized: true })

simulateClick("输入目标用户的微信 OpenID (handleOpenidInput)", () => {
  rmPage.handleOpenidInput(makeEvent({}, { value: "user-openid-target-99" }))
  if (rmPage.data.formOpenid !== "user-openid-target-99") throw new Error("OpenID 未录入")
})

simulateClick("勾选/取消车辆管理权限 (handleTogglePermission: canManageVehicles)", () => {
  rmPage.handleTogglePermission(makeEvent({ value: "canManageVehicles" }))
})

simulateClick("点击保存并下发权限配置 (handleSubmit)", () => {
  rmPage.handleSubmit()
})

simulateClick("点击已有管理员行编辑角色 (handleEditRole)", () => {
  rmPage.handleEditRole(makeEvent({ openid: "oTestUser1234567890abcdef", permissions: ["canManageVehicles"] }))
})

simulateClick("点击清空/重置表单 (handleResetForm)", () => {
  rmPage.handleResetForm()
  if (rmPage.data.formOpenid !== "") throw new Error("OpenID 未清空")
})

simulateClick("点击加载更多管理员列表 (handleLoadMore)", () => {
  rmPage.handleLoadMore()
})

logSuite("23. 分包页面: pages-admin/config-manage/config-manage (系统参数配置)")
const cmPage = loadPage("pages-admin/config-manage/config-manage")

simulateClick("修改系统配置参数项 (handleInput: bookingDepositRequired)", () => {
  cmPage.handleInput(makeEvent({ key: "bookingDepositRequired" }, { value: "0" }))
})

simulateClick("点击提交保存全局参数 (handleSubmit)", () => {
  cmPage.handleSubmit()
})

simulateClick("点击重置还原参数表单 (handleReset)", () => {
  cmPage.handleReset()
})

simulateClick("点击重新拉取云端参数 (handleRetryLoad)", () => {
  cmPage.handleRetryLoad()
})

logSuite("24. 分包页面: pages-admin/system-health/system-health (系统健康度巡检)")
const shPage = loadPage("pages-admin/system-health/system-health")

simulateClick("点击执行一键健康度体检 (handleRefresh)", () => {
  shPage.handleRefresh()
})

simulateClick("点击展开/折叠手动排查详情视图 (handleManualToggle)", () => {
  shPage.handleManualToggle(makeEvent({ key: "backup" }))
})

logSuite("25. 分包页面: pages-admin/audit-log-manage/audit-log-manage (安全审计日志)")
const almPage = loadPage("pages-admin/audit-log-manage/audit-log-manage")

simulateClick("点击操作行为分类标签:「全部」(handleActionTap: all)", () => {
  almPage.handleActionTap(makeEvent({ action: "all" }))
})

simulateClick("输入审计检索关键词 (handleKeywordInput)", () => {
  almPage.handleKeywordInput(makeEvent({}, { value: "vehicle" }))
  if (almPage.data.keyword !== "vehicle") throw new Error("检索词未保存")
})

simulateClick("点击执行审计搜索 (handleSearch)", () => {
  almPage.handleSearch()
})

simulateClick("点击清空检索关键词 (handleClearKeyword)", () => {
  almPage.handleClearKeyword()
  if (almPage.data.keyword !== "") throw new Error("检索词未清空")
})

simulateClick("点击重置全部审计筛选条件 (handleResetFilters)", () => {
  almPage.handleResetFilters()
})

simulateClick("点击导出安全审计台账 CSV (handleExport)", () => {
  almPage.handleExport()
})

simulateClick("点击打开导出的审计报表 (handleOpenExportedFile)", () => {
  almPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  almPage.handleOpenExportedFile()
})

simulateClick("点击转发分享审计报表 (handleShareExportedFile)", () => {
  almPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  almPage.handleShareExportedFile()
})

simulateClick("点击清理已导出审计报表缓存 (handleDeleteExportedFile)", () => {
  almPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  almPage.handleDeleteExportedFile()
})

simulateClick("点击上拉触底加载下一页审计记录 (handleLoadMore)", () => {
  almPage.handleLoadMore()
})

logSuite("26. 分包页面: pages-admin/error-log-manage/error-log-manage (系统异常错误日志)")
const elmPage = loadPage("pages-admin/error-log-manage/error-log-manage")

simulateClick("点击云函数名称分类筛选:「全部」(handleFuncTap: all)", () => {
  elmPage.handleFuncTap(makeEvent({ func: "all" }))
})

simulateClick("输入错误日志检索关键词 (handleKeywordInput)", () => {
  elmPage.handleKeywordInput(makeEvent({}, { value: "timeout" }))
  if (elmPage.data.keyword !== "timeout") throw new Error("错误检索词未保存")
})

simulateClick("点击执行错误日志搜索 (handleSearch)", () => {
  elmPage.handleSearch()
})

simulateClick("点击清空检索关键词 (handleClearKeyword)", () => {
  elmPage.handleClearKeyword()
  if (elmPage.data.keyword !== "") throw new Error("错误检索词未清空")
})

simulateClick("点击重置错误日志筛选条件 (handleResetFilters)", () => {
  elmPage.handleResetFilters()
})

simulateClick("点击导出错误排查台账 CSV (handleExport)", () => {
  elmPage.handleExport()
})

simulateClick("点击打开导出的错误排查文件 (handleOpenExportedFile)", () => {
  elmPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  elmPage.handleOpenExportedFile()
})

simulateClick("点击分享错误排查文件 (handleShareExportedFile)", () => {
  elmPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  elmPage.handleShareExportedFile()
})

simulateClick("点击清理导出的本地错误文件缓存 (handleDeleteExportedFile)", () => {
  elmPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  elmPage.handleDeleteExportedFile()
})

simulateClick("点击上拉触底加载更多错误日志 (handleLoadMore)", () => {
  elmPage.handleLoadMore()
})

logSuite("27. 分包页面: pages-admin/privacy-request-manage/privacy-request-manage (用户隐私申请审批)")
const prmPage = loadPage("pages-admin/privacy-request-manage/privacy-request-manage")
prmPage.setData({
  list: [{ id: "req-001", canHandle: true, status: "pending", type: "delete" }]
})

simulateClick("点击状态过滤标签:「全部」(handleStatusTap: all)", () => {
  prmPage.handleStatusTap(makeEvent({ status: "all" }))
})

simulateClick("点击类型过滤标签:「全部」(handleTypeTap: all)", () => {
  prmPage.handleTypeTap(makeEvent({ type: "all" }))
})

simulateClick("输入申请人检索关键字 (handleKeywordInput)", () => {
  prmPage.handleKeywordInput(makeEvent({}, { value: "req-001" }))
  if (prmPage.data.keyword !== "req-001") throw new Error("申请检索词未保存")
})

simulateClick("点击执行隐私申请检索 (handleSearch)", () => {
  prmPage.handleSearch()
})

simulateClick("点击清空申请检索关键词 (handleClearKeyword)", () => {
  prmPage.handleClearKeyword()
  if (prmPage.data.keyword !== "") throw new Error("申请检索词未清空")
})

simulateClick("点击重置全部隐私审批筛选 (handleResetFilters)", () => {
  prmPage.handleResetFilters()
})

simulateClick("点击审批通过隐私请求 (handleRequestAction: approve)", () => {
  prmPage.handleRequestAction(makeEvent({ id: "req-001" }))
})

simulateClick("点击一键复制申请人 OpenID (handleCopyOpenid)", () => {
  prmPage.handleCopyOpenid(makeEvent({ openid: "user-openid-123" }))
})

simulateClick("点击跳转查看个人数据台账 (handleInventoryTap)", () => {
  prmPage.handleInventoryTap(makeEvent({ id: "req-001" }))
})

simulateClick("点击触底加载更多申请记录 (handleLoadMore)", () => {
  prmPage.handleLoadMore()
})

logSuite("28. 分包页面: pages-admin/privacy-data-inventory/privacy-data-inventory (个人数据台账)")
const pdiPage = loadPage("pages-admin/privacy-data-inventory/privacy-data-inventory")

simulateClick("点击刷新个人数据台账 (handleRefresh)", () => {
  pdiPage.handleRefresh()
})

simulateClick("点击复制当前用户专属数据凭证 (handleCopyOpenid)", () => {
  pdiPage.handleCopyOpenid()
})

simulateClick("点击导出个人数据资产清单 (handleExport)", () => {
  pdiPage.handleExport()
})

simulateClick("点击打开导出的台账报表 (handleOpenExportedFile)", () => {
  pdiPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  pdiPage.handleOpenExportedFile()
})

simulateClick("点击分享导出的台账报表 (handleShareExportedFile)", () => {
  pdiPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  pdiPage.handleShareExportedFile()
})

simulateClick("点击删除台账报表缓存 (handleDeleteExportedFile)", () => {
  pdiPage.setData({ exportedFilePath: "wxfile://tmp_download.csv" })
  pdiPage.handleDeleteExportedFile()
})

simulateClick("点击台账中关联预约单跳转详情 (handleBookingTap)", () => {
  pdiPage.handleBookingTap(makeEvent({ id: "bk-2026-001" }))
})

// ========================================================================
// 4. 汇总报告与通过率断言
// ========================================================================
console.log(`\n${c.bold}${c.magenta}========================================================================${c.reset}`)
console.log(`${c.bold}   自动化全组件与全页面点击测试执行完成   ${c.reset}`)
console.log(`${c.bold}${c.magenta}========================================================================${c.reset}`)
console.log(`  总模拟交互点击项 : ${c.bold}${totalSimulated}${c.reset}`)
console.log(`  成功通过 (PASS)  : ${c.green}${c.bold}${passedCount}${c.reset}`)
console.log(`  异常失败 (FAIL)  : ${failedCount === 0 ? c.green : c.red}${c.bold}${failedCount}${c.reset}`)
console.log(`  通过率           : ${c.bold}${failedCount === 0 ? "100%" : Math.round((passedCount / totalSimulated) * 100) + "%"}${c.reset}`)

if (failedCount > 0) {
  console.error(`\n${c.red}${c.bold}存在未通过项，请排查以上错误日志。${c.reset}`)
  process.exit(1)
} else {
  console.log(`\n${c.green}${c.bold}✓ 极境车库小程序所有自定义组件及 26 个页面全量交互点击均正常工作！${c.reset}\n`)
}
