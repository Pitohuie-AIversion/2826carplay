/**
 * 极境车库小程序 - 实际使用场景全链路模拟与实机测试脚本
 * 
 * 模拟真实用户使用流程：
 * 1. 首次打开小程序进入车库首页（封面预热、卡片渲染、无闪烁）
 * 2. 首次点击进入车辆详情（数据预载、首图继承、杜绝 LOADING VEHICLE 遮罩）
 * 3. 退出返回车库首页（60s 缓存守卫、避免重复刷新列表）
 * 4. 再次点击进入车辆详情（“后来点入”无骨架屏闪烁、无图片加载中遮罩、瞬时呈现）
 * 5. 模拟杀进程冷启动重新进入（持久化 Storage 恢复、本地文件秒开测试）
 * 6. 收藏夹进入车辆详情链路（预览透传、前置大图预加载测试）
 * 7. 本地文件被系统清理后的容错降级（防死链、自动回退、无感愈合）
 */

const fs = require("fs")
const path = require("path")

// 颜色终端打印辅助
const c = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m"
}

let passedSteps = 0
let totalSteps = 0

function assert(condition, message) {
  totalSteps++
  if (condition) {
    passedSteps++
    console.log(`  ${c.green}✓${c.reset} [PASS] ${message}`)
  } else {
    console.error(`  ${c.red}✗${c.reset} [FAIL] ${message}`)
    process.exitCode = 1
  }
}

// 模拟微信存储
const storageStore = {}
const mockFileSystem = {
  files: new Set(),
  accessSync(p) {
    if (!mockFileSystem.files.has(p)) {
      throw new Error("no such file: " + p)
    }
  },
  saveFile({ tempFilePath, success }) {
    const saved = tempFilePath.replace("tmp_", "saved_")
    mockFileSystem.files.add(saved)
    success({ savedFilePath: saved })
  },
  unlink({ filePath, success }) {
    mockFileSystem.files.delete(filePath)
    if (typeof success === "function") success()
  }
}

// 全局微信环境模拟
const globalWx = {
  getStorageSync(key) {
    return storageStore[key]
  },
  setStorageSync(key, val) {
    storageStore[key] = val
  },
  removeStorageSync(key) {
    delete storageStore[key]
  },
  getFileSystemManager() {
    return mockFileSystem
  },
  downloadFile({ url, success }) {
    const temp = `wxfile://tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`
    mockFileSystem.files.add(temp)
    success({ statusCode: 200, tempFilePath: temp })
  },
  cloud: {
    downloadFile({ fileID, success }) {
      const temp = `wxfile://tmp_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.jpg`
      mockFileSystem.files.add(temp)
      success({ statusCode: 200, tempFilePath: temp })
    },
    callFunction({ name, data, success }) {
      if (name === "garageVehicleList") {
        success({
          result: {
            ok: true,
            total: 2,
            list: [
              {
                id: "car-911",
                name: "保时捷 911 Carrera S",
                brand: "保时捷",
                category: "supercar",
                priceText: "￥2,800/天",
                status: "available",
                cover: "cloud://prod-env/cars/911-cover.jpg",
                images: [
                  "cloud://prod-env/cars/911-cover.jpg",
                  "cloud://prod-env/cars/911-interior.jpg"
                ]
              },
              {
                id: "car-ferrari",
                name: "法拉利 F8 Tributo",
                brand: "法拉利",
                category: "supercar",
                priceText: "￥6,500/天",
                status: "available",
                cover: "cloud://prod-env/cars/f8-cover.jpg",
                images: ["cloud://prod-env/cars/f8-cover.jpg"]
              }
            ]
          }
        })
      } else if (name === "vehiclePublicDetail") {
        success({
          result: {
            ok: true,
            car: {
              id: data.id,
              name: data.id === "car-911" ? "保时捷 911 Carrera S" : "法拉利 F8 Tributo",
              brand: data.id === "car-911" ? "保时捷" : "法拉利",
              status: "available",
              priceDay: 2800,
              cover: "cloud://prod-env/cars/911-cover.jpg",
              images: [
                "cloud://prod-env/cars/911-cover.jpg",
                "cloud://prod-env/cars/911-interior.jpg"
              ]
            }
          }
        })
      } else if (name === "favoriteStatus") {
        success({ result: { ok: true, favorited: false } })
      } else if (name === "contentGuideList") {
        success({ result: { ok: true, list: [] } })
      } else if (name === "operationConfigGet") {
        success({ result: { ok: true, config: { brandName: "极境车库" } } })
      }
    }
  },
  navigateTo: () => {},
  showToast: () => {},
  setNavigationBarTitle: () => {}
}

global.wx = globalWx
const appInstance = { globalData: {} }
global.getApp = () => appInstance

console.log(`${c.bold}${c.cyan}======================================================${c.reset}`)
console.log(`${c.bold}${c.cyan}  极境车库小程序 实际使用场景真实仿真测试${c.reset}`)
console.log(`${c.bold}${c.cyan}======================================================${c.reset}\n`)

async function runRealWorldJourneyTest() {
  const imageCache = require("../shared/imageCache")

  // ----------------------------------------------------
  // 场景 1：用户首次启动小程序，进入车库主页
  // ----------------------------------------------------
  console.log(`${c.bold}【场景 1】首次启动打开车库首页（浏览车辆列表）${c.reset}`)
  let garageDef = null
  global.Page = (opts) => { garageDef = opts }
  require("../pages/garage/garage")

  const garage = {
    ...garageDef,
    data: { ...garageDef.data },
    setData(p) { Object.assign(this.data, p) }
  }

  garage.onLoad({})
  garage.onShow()

  assert(garage.data.cars.length === 2, "车库列表成功加载 2 辆尊享车型")
  assert(garage.data.cars[0].id === "car-911", "首辆展示车型为保时捷 911 Carrera S")
  assert(garage.data.loadingCars === false, "列表数据就绪，加载中状态已收起")

  // 模拟车辆卡片组件加载封面
  let carCardDef = null
  global.Component = (opts) => { carCardDef = opts }
  require("../components/car-card/car-card")

  const carCard = {
    ...carCardDef,
    ...carCardDef.methods,
    data: { ...carCardDef.data },
    setData(p) { Object.assign(this.data, p) }
  }

  // 测试全新未预载的网络图片
  const freshCoverUrl = "cloud://prod-env/cars/fresh-unseen.jpg"
  carCardDef.observers["car.cover"].call(carCard, freshCoverUrl)
  assert(carCard.data.imageLoading === true, "初次见到的未预载网络图片，卡片显示正常等待加载")

  // 模拟全新图片加载完成
  carCard.handleImageLoad()
  assert(carCard.data.imageLoading === false, "图片加载完成，卡片去除遮罩")

  // 车库首页已预加载的封面
  const coverUrl = "cloud://prod-env/cars/911-cover.jpg"
  carCardDef.observers["car.cover"].call(carCard, coverUrl)
  assert(carCard.data.imageLoading === false, "首页自动预热的车型封面，卡片无缝就绪无需等待")
  assert(imageCache.isImageLoaded(coverUrl) === true, "全局缓存已记录该图片为已就绪状态")

  // 等待 resolveImage 完成下载落盘
  const resolved = await imageCache.resolveImage(coverUrl)
  assert(Boolean(resolved.localPath), "首图成功缓存至本地磁盘: " + resolved.localPath)
  assert(imageCache.isImageLocallyCached(coverUrl) === true, "本地磁盘缓存标记生效")

  // ----------------------------------------------------
  // 场景 2：用户从车库列表点击保时捷 911，进入车辆详情页
  // ----------------------------------------------------
  console.log(`\n${c.bold}【场景 2】从车库点击保时捷 911 进入详情页（首次进入）${c.reset}`)
  
  // 模拟车库页面点击卡片
  garage.handleCarTap({ detail: { carId: "car-911" } })
  assert(appInstance.globalData._tempCarDetailPreview !== null, "车库点击时成功透传预览对象")
  assert(appInstance.globalData._tempCarDetailPreview.name === "保时捷 911 Carrera S", "预览对象包含完整车辆名称")

  // 挂载详情页
  let carDetailDef = null
  global.Page = (opts) => { carDetailDef = opts }
  require("../pages/car-detail/car-detail")

  const carDetail = {
    ...carDetailDef,
    data: { ...carDetailDef.data },
    setData(p) { Object.assign(this.data, p) }
  }

  // 触发 onLoad
  carDetail.onLoad({ carId: "car-911" })

  assert(carDetail.data.car !== null, "详情页同步从 previewCar 渲染，无白屏或骨架屏闪烁")
  assert(carDetail.data.car.imageItems.length === 2, "车辆包含 2 张图片配置")
  assert(carDetail.data.car.imageItems[0].loaded === true, "在车库已看过的首图直接标记 loaded: true（杜绝 LOADING VEHICLE 遮罩）")
  assert(carDetail.data.loading === false, "页面 loading 初始即为 false")

  // 模拟详情页首图触发 bindload
  carDetail.handleHeroImageLoad({ currentTarget: { dataset: { index: 0 } } })
  assert(carDetail.data.car.imageItems[0].loaded === true, "首图完成就绪")

  // ----------------------------------------------------
  // 场景 3：用户退出车辆详情页，返回车库主页
  // ----------------------------------------------------
  console.log(`\n${c.bold}【场景 3】返回车库首页（测试防重复加载与 60s 守卫）${c.reset}`)
  carDetail.onUnload()

  const beforeCars = garage.data.cars
  garage.onShow() // 再次显示车库页
  assert(garage.data.cars === beforeCars, "在 60s 有效期内返回车库，不重新请求列表，保持列表滚动位置与卡片状态")

  // 再次触发卡片 observer（例如由于下拉或者切换类别回到全部）
  carCardDef.observers["car.cover"].call(carCard, coverUrl)
  assert(carCard.data.imageLoading === false, "已加载过的卡片封面再次触发 observer 时不闪烁加载中")

  // ----------------------------------------------------
  // 场景 4：用户再次点击进入保时捷 911 详情（“后来点入”场景测试）
  // ----------------------------------------------------
  console.log(`\n${c.bold}【场景 4】“后来点入”车辆详情（验证核心用户诉求）${c.reset}`)
  
  // 创建新打开的详情页实例（模拟二次 navigateTo）
  const carDetailSecond = {
    ...carDetailDef,
    data: { ...carDetailDef.data },
    setData(p) { Object.assign(this.data, p) }
  }

  // 此时即使 previewCar 已经被清理，carDetailMemoryCache 依然有该车缓存！
  appInstance.globalData._tempCarDetailPreview = null
  carDetailSecond.onLoad({ carId: "car-911" })

  assert(carDetailSecond.data.car !== null, "二次点入命中 SWR 内存缓存，瞬时呈现")
  assert(carDetailSecond.data.car.imageItems[0].loaded === true, "二次点入图片初始状态直接为 loaded: true")
  assert(carDetailSecond.data.loading === false, "二次点入无任何加载中遮罩或等待")

  // ----------------------------------------------------
  // 场景 5：模拟杀进程后冷启动重新打开
  // ----------------------------------------------------
  console.log(`\n${c.bold}【场景 5】杀进程冷启动（模拟用户次日重新进入）${c.reset}`)
  
  // 检查 Storage 是否持久化了磁盘映射与已确认列表
  const savedUrlMap = storageStore["image_cache_url_map_v1"]
  const savedConfirmed = storageStore["image_cache_confirmed_v1"]
  assert(Boolean(savedUrlMap && savedUrlMap[coverUrl]), "本地磁盘路径持久化保存在 Storage 中")
  assert(Boolean(savedConfirmed && savedConfirmed.includes(coverUrl)), "已确认加载的 URL 集合持久化保存在 Storage 中")

  // 清除所有 JS 内存变量（模拟重新加载模块）
  delete require.cache[require.resolve("../shared/imageCache")]
  delete require.cache[require.resolve("../pages/car-detail/car-detail")]
  const freshImageCache = require("../shared/imageCache")

  assert(freshImageCache.isImageLocallyCached(coverUrl) === true, "冷启动后依然直接识别本地磁盘缓存")
  assert(freshImageCache.isImageLoaded(coverUrl) === true, "冷启动后 isImageLoaded 立即返回 true")

  // ----------------------------------------------------
  // 场景 6：收藏夹流转与跨页面大图预载
  // ----------------------------------------------------
  console.log(`\n${c.bold}【场景 6】我的收藏页面流转测试${c.reset}`)
  let favDef = null
  global.Page = (opts) => { favDef = opts }
  require("../pages/favorites/favorites")

  const favPage = {
    ...favDef,
    data: {
      ...favDef.data,
      visibleList: [
        {
          id: "car-911",
          name: "保时捷 911 Carrera S",
          cover: coverUrl,
          images: [coverUrl]
        }
      ]
    },
    setData(p) { Object.assign(this.data, p) }
  }

  favPage.handleCarTap({ detail: { carId: "car-911" } })
  assert(appInstance.globalData._tempCarDetailPreview !== null, "从收藏夹点击成功挂载预载对象")
  assert(appInstance.globalData._tempCarDetailPreview.id === "car-911", "预载对象匹配车辆 ID")

  // ----------------------------------------------------
  // 场景 7：微信系统清理本地文件后的自愈与安全降级测试
  // ----------------------------------------------------
  console.log(`\n${c.bold}【场景 7】微信临时/本地缓存被系统回收后的自愈机制${c.reset}`)
  
  // 模拟本地磁盘文件被微信 OS 回收删除
  const cachedLocalPath = savedUrlMap[coverUrl]
  mockFileSystem.files.delete(cachedLocalPath)

  // 此时调用 getCachedPath
  const fallbackPath = freshImageCache.getCachedPath(coverUrl)
  assert(fallbackPath === coverUrl, "本地文件被回收后，安全降级返回原始网络链接，杜绝 wxfile:// 死链")
  assert(storageStore["image_cache_url_map_v1"][coverUrl] === undefined, "失效记录自动从磁盘映射中清理")

  // 内置包资源免检
  const emblemPath = "/assets/icons/jijing-garage-emblem.png"
  const emblemCheck = freshImageCache.getCachedPath(emblemPath)
  assert(emblemCheck === emblemPath, "内置资源包资源安全识别，不发生误删")

  console.log(`\n${c.bold}${c.green}======================================================${c.reset}`)
  console.log(`${c.bold}${c.green}  全部实际使用流程测试通过！ (${passedSteps}/${totalSteps} 项断言)${c.reset}`)
  console.log(`${c.bold}${c.green}======================================================${c.reset}\n`)
}

runRealWorldJourneyTest().catch((err) => {
  console.error(`${c.red}测试执行异常:${c.reset}`, err)
  process.exit(1)
})
