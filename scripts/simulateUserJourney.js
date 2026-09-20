/**
 * 极境车库小程序 - 真实普通用户端全链路交互仿真
 * 
 * 模拟用户行为链路：
 * 1. 启动并进入车库首页：首屏加载、分类切换、城市选择、车型搜索与触底分页
 * 2. 进入车辆详情：预览透传瞬开、收藏状态切换、日历可用性与图库切换
 * 3. 预约提交流程：进入预约表单、输入防丢失守卫触发、提交成功与状态重置
 * 4. 我的预约与详情：列表瞬开、触底分页、点击进入详情查看旅程进度
 * 5. 我的收藏管理：收藏清单瞬开与取消收藏
 * 6. 场景指南/攻略阅读：文章内容与关联车型 0ms SWR 瞬开
 * 7. 个人信息与隐私权申请：表单防误触离开拦截与历史记录查看
 * 8. 个人中心体验：用户信息、SWR 权限呈现、无布局跳动
 */

const path = require("path")

const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  yellow: "\x1b[33m"
}

let passed = 0
let failed = 0

function step(title, fn) {
  try {
    fn()
    passed++
    console.log(`  ${c.green}✓${c.reset} [PASS] ${title}`)
  } catch (err) {
    failed++
    console.error(`  ${c.red}✗${c.reset} [FAIL] ${title}`)
    console.error(`     ${c.red}Error: ${err.message}${c.reset}`)
    process.exitCode = 1
  }
}

// 模拟全局环境
const storage = {}
const appInstance = {
  globalData: {
    cloudEnvId: "prod-garage-env",
    _tempCarDetailPreview: null
  }
}
global.getApp = () => appInstance

global.wx = {
  getStorageSync: (k) => storage[k] || null,
  setStorageSync: (k, v) => { storage[k] = v },
  removeStorageSync: (k) => { delete storage[k] },
  showToast: () => {},
  showModal: ({ success }) => { if (success) success({ confirm: true }) },
  showLoading: () => {},
  hideLoading: () => {},
  stopPullDownRefresh: () => {},
  navigateTo: () => {},
  redirectTo: () => {},
  navigateBack: () => {},
  setNavigationBarTitle: () => {},
  enableAlertBeforeUnload: () => {},
  disableAlertBeforeUnload: () => {},
  vibrateShort: () => {},
  getSystemInfoSync: () => ({ platform: "devtools", system: "iOS 16.0" }),
  getAccountInfoSync: () => ({ miniProgram: { envVersion: "release" } }),
  cloud: {
    init: () => {},
    callFunction: ({ name, data, success }) => {
      if (name === "garageVehicleList") {
        success({
          result: {
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
                status: "available",
                cover: "https://example.com/panamera.jpg"
              }
            ]
          }
        })
      } else if (name === "vehiclePublicDetail") {
        const carData = {
          id: (data && data.id) || "car-911",
          name: "保时捷 911 Carrera S",
          brand: "保时捷",
          category: "supercar",
          city: "上海",
          priceDay: 2800,
          images: ["https://example.com/911-1.jpg", "https://example.com/911-2.jpg"],
          features: ["3.0T 双涡轮", "后置后驱", "PDK 变速箱"],
          status: "available"
        }
        success({
          result: {
            ok: true,
            car: carData,
            vehicle: carData
          }
        })
      } else if (name === "favoriteStatus") {
        success({ result: { ok: true, favorited: false } })
      } else if (name === "favoriteSet") {
        success({ result: { ok: true, favorited: data && data.favorited } })
      } else if (name === "favoriteMyList") {
        success({
          result: {
            ok: true,
            list: [
              { id: "car-911", name: "保时捷 911 Carrera S", priceDay: 2800, status: "available" }
            ],
            hasMore: false
          }
        })
      } else if (name === "bookingCreate") {
        success({ result: { ok: true, bookingId: "bk-2026-001", message: "预约已提交" } })
      } else if (name === "bookingMyList") {
        success({
          result: {
            ok: true,
            list: [
              {
                id: "bk-2026-001",
                vehicleId: "car-911",
                vehicleName: "保时捷 911 Carrera S",
                startDate: "2026-10-01",
                endDate: "2026-10-03",
                status: "pending",
                createdAt: Date.now()
              }
            ],
            hasMore: false
          }
        })
      } else if (name === "bookingMyDetail") {
        success({
          result: {
            ok: true,
            booking: {
              id: "bk-2026-001",
              vehicleId: "car-911",
              vehicleName: "保时捷 911 Carrera S",
              startDate: "2026-10-01",
              endDate: "2026-10-03",
              status: "pending",
              userName: "张先生",
              contactPhone: "13800000000"
            },
            latestQuote: null,
            handovers: []
          }
        })
      } else if (name === "contentGuides") {
        success({
          result: {
            ok: true,
            guide: {
              slug: "weekend-short-trip-prep-2026",
              title: "周末自驾游出行指南",
              summary: "带您领略短途奢华自驾体验",
              body: "精选路线与检查清单...",
              relatedVehicles: [{ id: "car-911", name: "保时捷 911 Carrera S" }]
            }
          }
        })
      } else if (name === "privacyRequestMyList") {
        success({
          result: {
            ok: true,
            list: [
              { id: "req-001", type: "access", status: "completed", createdAt: Date.now() }
            ],
            hasMore: false
          }
        })
      } else if (name === "getMyPermissions") {
        success({
          result: {
            ok: true,
            roles: ["user"],
            canManageVehicles: false,
            canManageBookings: false
          }
        })
      }
    }
  }
}

function loadPage(pagePath) {
  let def = null
  global.Page = (d) => { def = d }
  const fullPath = path.resolve(__dirname, "..", pagePath)
  delete require.cache[require.resolve(fullPath)]
  require(fullPath)
  const instance = {
    ...def,
    data: { ...def.data },
    setData(patch, cb) {
      Object.assign(this.data, patch)
      if (typeof cb === "function") cb()
    }
  }
  return instance
}

console.log(`${c.bold}${c.cyan}======================================================${c.reset}`)
console.log(`${c.bold}${c.cyan}   极境车库小程序 - 真实普通用户端全链路交互验证   ${c.reset}`)
console.log(`${c.bold}${c.cyan}======================================================${c.reset}\n`)

console.log(`${c.bold}【阶段 1】进入车库首页（Garage）${c.reset}`)
const garage = loadPage("pages/garage/garage")

step("1.1 首次进入车库页面生命周期执行", () => {
  garage.onLoad({})
  if (garage.data.initialLoading === undefined) throw new Error("缺少 initialLoading 状态")
})

step("1.2 车库云端车辆数据拉取完成并解析分类", () => {
  garage.loadCars()
  if (!garage.data.cars || garage.data.cars.length !== 2) throw new Error("车辆列表未成功解析")
  const allCategoryTabs = garage.data.categories.filter((c) => c.id === "all")
  if (allCategoryTabs.length !== 1) throw new Error(`分类栏出现重复全部项: ${allCategoryTabs.length}`)
})

step("1.3 用户切换分类至「超级跑车」", () => {
  garage.handleCategoryTap({ currentTarget: { dataset: { categoryId: "supercar" } } })
  if (garage.data.currentCategory !== "supercar") throw new Error("当前分类未切换")
  if (garage.data.filteredCars.length !== 1) throw new Error("超级跑车筛选结果不正确")
  if (garage.data.filteredCars[0].id !== "car-911") throw new Error("匹配车辆不正确")
})

step("1.4 用户输入搜索关键词「保时捷」", () => {
  garage.handleSearchInput({ detail: { value: "保时捷" } })
  if (garage.data.searchKeyword !== "保时捷") throw new Error("搜索关键词未同步")
})

step("1.5 用户滑动触底触发分页加载更多", () => {
  let loadMoreCalled = false
  garage.handleLoadMore = () => { loadMoreCalled = true }
  garage.onReachBottom()
  if (!loadMoreCalled) throw new Error("触底未触发 handleLoadMore")
})

console.log(`\n${c.bold}【阶段 2】进入车辆详情（Car Detail）${c.reset}`)
const carDetail = loadPage("pages/car-detail/car-detail")

step("2.1 用户点击保时捷 911 携带 previewCar 打开详情", () => {
  appInstance.globalData._tempCarDetailPreview = garage.data.cars[0]
  carDetail.onLoad({ carId: "car-911" })
  if (carDetail.data.loading !== false) throw new Error("有 previewCar 时首屏不应出现 loading 遮罩")
  if (!carDetail.data.car || carDetail.data.car.name !== "保时捷 911 Carrera S") throw new Error("车辆详情未呈现")
})

step("2.2 用户点击「收藏」按钮进行收藏与取消操作", () => {
  carDetail.handleFavoriteTap()
  if (!carDetail.data.favorited) throw new Error("收藏状态未置为 true")
  carDetail.handleFavoriteTap()
  if (carDetail.data.favorited) throw new Error("取消收藏未置为 false")
})

step("2.3 弱网环境下主图加载失败支持轻触重试", () => {
  carDetail.handleRetryHeroImage({ currentTarget: { dataset: { index: 0 } } })
  if (!carDetail.data.car || !carDetail.data.car.imageItems[0] || carDetail.data.car.imageItems[0].failed !== false) {
    throw new Error("重试未重置错误状态")
  }
})

console.log(`\n${c.bold}【阶段 3】发起预约填报流程（Booking）${c.reset}`)
const booking = loadPage("pages/booking/booking")

step("3.1 用户点击「立即预约」进入预订表单", () => {
  booking.onLoad({ carId: "car-911" })
  if (booking.data.carId !== "car-911") throw new Error("预订车辆未绑定")
})

step("3.2 用户在表单中输入姓名与联系方式，自动激活防误触离开守卫", () => {
  booking.handleInput({
    currentTarget: { dataset: { field: "userName" } },
    detail: { value: "张先生" }
  })
  if (!booking._hasUnsavedChanges) throw new Error("输入姓名后未激活防误触保护")
})

step("3.3 用户勾选隐私协议并提交预约单，防误触守卫安全解除并清空状态", () => {
  booking.handlePrivacyAgreementChange({ detail: { value: ["agreed"] } })
  booking.setData({
    form: {
      userName: "张先生",
      phone: "13800000000",
      city: "上海",
      startDate: "2026-10-01",
      endDate: "2026-10-03"
    }
  })
  booking.handleSubmit()
  if (booking._hasUnsavedChanges) throw new Error("提交预约后未清除未保存标记")
})

console.log(`\n${c.bold}【阶段 4】查看我的预约与订单详情（Bookings & Booking Detail）${c.reset}`)
const bookings = loadPage("pages/bookings/bookings")

step("4.1 打开「我的预约」列表，0ms 呈现预约进度", () => {
  bookings.onLoad()
  bookings.loadList()
  if (!bookings.data.list || bookings.data.list.length !== 1) throw new Error("预约列表未渲染")
  if (bookings.data.list[0].statusText !== "待联系") throw new Error("预约状态未格式化")
})

step("4.2 我的预约列表滑动到底部触发原生触底无感翻页", () => {
  let appendCalled = false
  bookings.loadList = (opts) => { if (opts && opts.append) appendCalled = true }
  bookings.data.loading = false
  bookings.data.hasMore = true
  bookings.onReachBottom()
  if (!appendCalled) throw new Error("触底未触发 append 翻页")
})

const bookingDetail = loadPage("pages/booking-detail/booking-detail")
step("4.3 点击查看预约详情，SWR 快照直出并展示跟进状态", () => {
  storage["booking_detail_bk-2026-001"] = {
    booking: {
      id: "bk-2026-001",
      vehicleId: "car-911",
      vehicleName: "保时捷 911 Carrera S",
      startDate: "2026-10-01",
      endDate: "2026-10-03",
      status: "pending"
    }
  }
  bookingDetail.onLoad({ id: "bk-2026-001" })
  if (!bookingDetail.data.booking || bookingDetail.data.booking.id !== "bk-2026-001") throw new Error("预约详情未成功加载")
})

console.log(`\n${c.bold}【阶段 5】我的收藏管理（Favorites）${c.reset}`)
const favorites = loadPage("pages/favorites/favorites")

step("5.1 进入收藏夹，SWR 快照瞬间恢复已收藏心愿车型", () => {
  storage["favorites_last_snapshot"] = [
    { id: "car-911", name: "保时捷 911 Carrera S", priceDay: 2800, status: "available" }
  ]
  favorites.onLoad()
  if (!favorites.data.list || favorites.data.list.length !== 1) throw new Error("收藏列表未加载")
  if (favorites.data.list[0].name !== "保时捷 911 Carrera S") throw new Error("收藏车辆名称不匹配")
})

step("5.2 收藏长列表触底自动翻页", () => {
  let favAppendCalled = false
  favorites.fetchList = (opts) => { if (opts && opts.append) favAppendCalled = true }
  favorites.data.loading = false
  favorites.data.hasMore = true
  favorites.onReachBottom()
  if (!favAppendCalled) throw new Error("收藏夹触底未触发翻页")
})

console.log(`\n${c.bold}【阶段 6】场景攻略与指南阅读（Content Page）${c.reset}`)
const contentPage = loadPage("pages/content-page/content-page")

step("6.1 用户在车库底部点击「周末自驾游指南」，0ms SWR 瞬开正文与关联车型", () => {
  storage["guide_weekend-short-trip-prep-2026"] = {
    guide: {
      slug: "weekend-short-trip-prep-2026",
      title: "周末自驾游出行指南",
      summary: "带您领略短途奢华自驾体验",
      body: "精选路线与检查清单..."
    },
    vehicles: [{ id: "car-911", name: "保时捷 911 Carrera S" }]
  }
  contentPage.onLoad({ contentId: "weekend-short-trip-prep-2026" })
  if (!contentPage.data.guide || contentPage.data.guide.title !== "周末自驾游出行指南") throw new Error("攻略正文未渲染")
  if (!contentPage.data.relatedVehicles || contentPage.data.relatedVehicles.length !== 1) throw new Error("关联推荐车型未渲染")
})

console.log(`\n${c.bold}【阶段 7】个人信息与隐私申请（Privacy Request）${c.reset}`)
const privacyRequest = loadPage("pages/privacy-request/privacy-request")

step("7.1 打开隐私申请，历史记录 0ms 直出且支持触底翻页", () => {
  storage["privacy_requests_snapshot"] = [
    { id: "req-001", type: "access", status: "completed", createdAt: Date.now() }
  ]
  privacyRequest.onLoad()
  if (!privacyRequest.data.list || privacyRequest.data.list.length !== 1) throw new Error("隐私申请历史未恢复")
  let privAppendCalled = false
  privacyRequest.fetchList = (opts) => { if (opts && opts.append) privAppendCalled = true }
  privacyRequest.data.hasMore = true
  privacyRequest.onReachBottom()
  if (!privAppendCalled) throw new Error("隐私列表触底未触发翻页")
})

step("7.2 填写诉求描述触发防误触保护，清空后自动解除", () => {
  privacyRequest.handleDescriptionInput({ detail: { value: "请协助导出我过去 1 年的预约记录" } })
  if (!privacyRequest._hasUnsavedChanges) throw new Error("填写说明后未激活未保存防护")
  privacyRequest.handleDescriptionInput({ detail: { value: "" } })
  if (privacyRequest._hasUnsavedChanges) throw new Error("清空说明后未解除防护")
})

console.log(`\n${c.bold}【阶段 8】个人中心体验（Mine）${c.reset}`)
const mine = loadPage("pages/mine/mine")

step("8.1 进入「我的」个人中心，0ms 权限快照直出，无 CLS 布局跳动", () => {
  storage["mine_permissions_snapshot"] = {
    roles: ["user"],
    isManager: false,
    canManageVehicles: false,
    canManageBookings: false
  }
  mine.onLoad()
  if (mine.data.permissionsLoading !== false) throw new Error("命中快照时 permissionsLoading 应为 false")
  if (mine.data.permissionsReady !== true) throw new Error("命中快照时 permissionsReady 应为 true")
})

console.log(`\n${c.bold}${c.cyan}======================================================${c.reset}`)
console.log(`${c.bold}${c.cyan}   全链路用户真实操作仿真验证完成: ${passed} 通过, ${failed} 失败   ${c.reset}`)
console.log(`${c.bold}${c.cyan}======================================================${c.reset}\n`)

if (failed > 0) {
  process.exit(1)
}
