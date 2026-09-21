/**
 * 微信小程序双层图片缓存与预载管理器 (Two-Tier Image Cache)
 * 
 * 核心特性：
 * 1. 内存层：LRU Map 高频访问瞬时返回
 * 2. 磁盘层：wx.env.USER_DATA_PATH 持久化保存，防二次下载
 * 3. 自愈机制：系统临时文件被清理时自动识别并优雅降级为原网络地址
 * 4. 并发控制：最大并发下载 3，防止网络拥塞
 */

const STORAGE_KEY_MAP = "image_cache_url_map_v1"
const STORAGE_KEY_META = "image_cache_meta_v1"
const STORAGE_KEY_CONFIRMED = "image_cache_confirmed_v1"
const MAX_MEMORY_CACHE = 80
const MAX_LOCAL_CACHE = 120
const MAX_CONCURRENT_DOWNLOADS = 3
const DOWNLOAD_TIMEOUT_MS = 20 * 1000

function createLRU(max) {
  const map = new Map()
  return {
    get(key) {
      if (!map.has(key)) return undefined
      const value = map.get(key)
      map.delete(key)
      map.set(key, value)
      return value
    },
    set(key, value) {
      if (map.has(key)) map.delete(key)
      map.set(key, value)
      while (map.size > max) {
        const firstKey = map.keys().next().value
        map.delete(firstKey)
      }
    },
    has(key) {
      return map.has(key)
    },
    delete(key) {
      return map.delete(key)
    },
    size() {
      return map.size
    }
  }
}

const memoryCache = createLRU(MAX_MEMORY_CACHE)
let urlMap = null
let cacheMeta = null
let confirmedUrls = null
let pendingDownloads = new Map()
let downloadQueue = []
let activeDownloads = 0

function loadUrlMap() {
  if (urlMap !== null) return urlMap
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_MAP)
    urlMap = raw && typeof raw === "object" ? raw : {}
  } catch (e) {
    urlMap = {}
  }
  return urlMap
}

function saveUrlMap() {
  try {
    wx.setStorageSync(STORAGE_KEY_MAP, urlMap || {})
  } catch (e) {}
}

function getCachedImagePath(url) {
  if (!url || typeof url !== "string") return url
  const trimmed = url.trim()
  if (!trimmed || !trimmed.startsWith("http")) return trimmed

  // 1. 检查内存缓存
  const mem = memoryCache.get(trimmed)
  if (mem) return mem

  // 2. 检查本地磁盘映射
  const map = loadUrlMap()
  const localPath = map[trimmed]
  if (!localPath) return trimmed

  // 3. 校验本地文件是否存在（自愈降级保护）
  if (typeof wx !== "undefined" && typeof wx.getFileSystemManager === "function") {
    try {
      const fs = wx.getFileSystemManager()
      fs.accessSync(localPath)
      memoryCache.set(trimmed, localPath)
      return localPath
    } catch (e) {
      // 文件已被系统回收清理，移除死链记录并降级返回原地址
      delete map[trimmed]
      saveUrlMap()
      return trimmed
    }
  }

  return trimmed
}

function preloadImage(url) {
  if (!url || typeof url !== "string" || !url.startsWith("http")) {
    return Promise.resolve(url)
  }
  const targetUrl = url.trim()
  const cached = getCachedImagePath(targetUrl)
  if (cached !== targetUrl) {
    return Promise.resolve(cached)
  }

  if (pendingDownloads.has(targetUrl)) {
    return pendingDownloads.get(targetUrl)
  }

  const promise = new Promise((resolve) => {
    downloadQueue.push({ url: targetUrl, resolve })
    processQueue()
  })

  pendingDownloads.set(targetUrl, promise)
  return promise
}

function processQueue() {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS || downloadQueue.length === 0) {
    return
  }
  const task = downloadQueue.shift()
  activeDownloads++

  wx.downloadFile({
    url: task.url,
    timeout: DOWNLOAD_TIMEOUT_MS,
    success: (res) => {
      if (res.statusCode === 200 && res.tempFilePath) {
        const fs = wx.getFileSystemManager()
        const ext = task.url.split(".").pop().split("?")[0] || "jpg"
        const savedPath = `${wx.env.USER_DATA_PATH}/image_cache_${Date.now()}.${ext}`
        try {
          fs.saveFileSync(res.tempFilePath, savedPath)
          const map = loadUrlMap()
          map[task.url] = savedPath
          saveUrlMap()
          memoryCache.set(task.url, savedPath)
          task.resolve(savedPath)
          return
        } catch (e) {}
      }
      task.resolve(task.url)
    },
    fail: () => {
      task.resolve(task.url)
    },
    complete: () => {
      activeDownloads--
      pendingDownloads.delete(task.url)
      processQueue()
    }
  })
}

module.exports = {
  getCachedImagePath,
  preloadImage
}
