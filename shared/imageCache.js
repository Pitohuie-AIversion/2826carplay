const STORAGE_KEY_MAP = "image_cache_url_map_v1"
const STORAGE_KEY_META = "image_cache_meta_v1"
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
    keys() {
      return Array.from(map.keys())
    },
    size() {
      return map.size
    },
    oldestKey() {
      return map.keys().next().value
    }
  }
}

const memoryCache = createLRU(MAX_MEMORY_CACHE)

let urlMap = null
let cacheMeta = null
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

function loadCacheMeta() {
  if (cacheMeta !== null) return cacheMeta
  try {
    const raw = wx.getStorageSync(STORAGE_KEY_META)
    cacheMeta = raw && typeof raw === "object" ? raw : {}
  } catch (e) {
    cacheMeta = {}
  }
  return cacheMeta
}

function saveCacheMeta() {
  try {
    wx.setStorageSync(STORAGE_KEY_META, cacheMeta || {})
  } catch (e) {}
}

function touchMeta(url) {
  loadCacheMeta()
  const entry = cacheMeta[url] || { createdAt: Date.now(), hits: 0 }
  entry.lastAccessedAt = Date.now()
  entry.hits = Number(entry.hits || 0) + 1
  cacheMeta[url] = entry
  saveCacheMeta()
}

function removeCacheEntry(url) {
  loadUrlMap()
  loadCacheMeta()
  const localPath = urlMap[url]
  delete urlMap[url]
  delete cacheMeta[url]
  saveUrlMap()
  saveCacheMeta()
  memoryCache.delete(url)
  if (localPath) {
    try {
      const fs = wx.getFileSystemManager()
      fs.removeSavedFile({
        filePath: localPath,
        fail: () => {}
      })
    } catch (e) {}
  }
}

function evictIfNeeded() {
  loadUrlMap()
  loadCacheMeta()
  const urls = Object.keys(urlMap || {})
  if (urls.length <= MAX_LOCAL_CACHE) return
  const sorted = urls
    .map((url) => ({
      url,
      lastAccessedAt: Number((cacheMeta[url] && cacheMeta[url].lastAccessedAt) || 0)
    }))
    .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt)
  const toRemove = sorted.slice(0, urls.length - MAX_LOCAL_CACHE)
  toRemove.forEach((item) => removeCacheEntry(item.url))
}

function isCloudUrl(url) {
  return typeof url === "string" && url.indexOf("cloud://") === 0
}

function isRemoteUrl(url) {
  return typeof url === "string" && (url.indexOf("http://") === 0 || url.indexOf("https://") === 0)
}

function shouldCache(url) {
  return isCloudUrl(url) || isRemoteUrl(url)
}

function processDownloadQueue() {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS || downloadQueue.length === 0) {
    return
  }
  const next = downloadQueue.shift()
  if (!next) return
  activeDownloads++
  executeDownload(next.url, next.options)
    .then((result) => {
      activeDownloads--
      next.resolve(result)
      processDownloadQueue()
    })
    .catch((err) => {
      activeDownloads--
      next.reject(err)
      processDownloadQueue()
    })
}

function enqueueDownload(url, options) {
  const priority = Number(options && options.priority) || 0
  return new Promise((resolve, reject) => {
    downloadQueue.push({ url, options: options || {}, resolve, reject, priority })
    downloadQueue.sort((a, b) => b.priority - a.priority)
    processDownloadQueue()
  })
}

function executeDownload(url, options) {
  return new Promise((resolve, reject) => {
    let settled = false
    let timer = null

    const finish = (ok, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      pendingDownloads.delete(url)
      if (ok) resolve(value)
      else reject(value)
    }

    timer = setTimeout(() => {
      finish(false, new Error("image download timeout"))
    }, DOWNLOAD_TIMEOUT_MS)

    const handleSuccess = (tempFilePath) => {
      if (settled) return
      try {
        const fs = wx.getFileSystemManager()
        fs.saveFile({
          tempFilePath,
          success: (saveRes) => {
            const savedPath = saveRes.savedFilePath
            loadUrlMap()
            loadCacheMeta()
            urlMap[url] = savedPath
            cacheMeta[url] = {
              createdAt: Date.now(),
              lastAccessedAt: Date.now(),
              hits: 1
            }
            saveUrlMap()
            saveCacheMeta()
            memoryCache.set(url, savedPath)
            evictIfNeeded()
            finish(true, { localPath: savedPath, cached: false })
          },
          fail: (err) => {
            finish(true, { localPath: tempFilePath, cached: false, temp: true })
          }
        })
      } catch (e) {
        finish(true, { localPath: tempFilePath, cached: false, temp: true })
      }
    }

    if (isCloudUrl(url) && wx.cloud && typeof wx.cloud.downloadFile === "function") {
      try {
        wx.cloud.downloadFile({
          fileID: url,
          success: (res) => {
            if (res && res.tempFilePath) {
              handleSuccess(res.tempFilePath)
            } else {
              finish(false, new Error("cloud download missing tempFilePath"))
            }
          },
          fail: (err) => finish(false, err || new Error("cloud download failed"))
        })
      } catch (e) {
        finish(false, e)
      }
      return
    }

    if (isRemoteUrl(url)) {
      try {
        wx.downloadFile({
          url,
          success: (res) => {
            if (res && res.statusCode === 200 && res.tempFilePath) {
              handleSuccess(res.tempFilePath)
            } else {
              finish(false, new Error("download failed: " + (res && res.statusCode)))
            }
          },
          fail: (err) => finish(false, err || new Error("download failed"))
        })
      } catch (e) {
        finish(false, e)
      }
      return
    }

    finish(false, new Error("unsupported url type"))
  })
}

function resolveImage(url, options) {
  if (!shouldCache(url)) {
    return Promise.resolve({ localPath: url, cached: false, local: true })
  }

  if (memoryCache.has(url)) {
    const localPath = memoryCache.get(url)
    touchMeta(url)
    return Promise.resolve({ localPath, cached: true, local: true })
  }

  loadUrlMap()
  const savedPath = urlMap[url]
  if (savedPath) {
    memoryCache.set(url, savedPath)
    touchMeta(url)
    return Promise.resolve({ localPath: savedPath, cached: true, local: true })
  }

  if (pendingDownloads.has(url)) {
    return pendingDownloads.get(url)
  }

  const priority = Number(options && options.priority) || 0
  const promise = enqueueDownload(url, { priority })
  pendingDownloads.set(url, promise)
  promise.catch(() => {})
  return promise
}

function preloadImages(urls, options) {
  const priority = Number(options && options.priority) || 0
  const list = Array.isArray(urls) ? urls : []
  const promises = list
    .filter((url) => shouldCache(url))
    .map((url) => {
      if (memoryCache.has(url)) {
        touchMeta(url)
        return Promise.resolve({ localPath: memoryCache.get(url), cached: true })
      }
      loadUrlMap()
      if (urlMap[url]) {
        memoryCache.set(url, urlMap[url])
        touchMeta(url)
        return Promise.resolve({ localPath: urlMap[url], cached: true })
      }
      return resolveImage(url, { priority }).catch(() => null)
    })
  return Promise.all(promises)
}

function getCachedPath(url) {
  if (!url) return url
  if (memoryCache.has(url)) return memoryCache.get(url)
  loadUrlMap()
  const saved = urlMap[url]
  if (saved) {
    memoryCache.set(url, saved)
    touchMeta(url)
    return saved
  }
  return url
}

function clearExpiredCache(maxAgeMs) {
  loadCacheMeta()
  loadUrlMap()
  const now = Date.now()
  const maxAge = Number(maxAgeMs) || 7 * 24 * 60 * 60 * 1000
  const urls = Object.keys(urlMap || {})
  urls.forEach((url) => {
    const meta = cacheMeta[url] || {}
    const last = Number(meta.lastAccessedAt || meta.createdAt || 0)
    if (last && now - last > maxAge) {
      removeCacheEntry(url)
    }
  })
}

function clearAllCache() {
  loadUrlMap()
  const urls = Object.keys(urlMap || {})
  urls.forEach((url) => removeCacheEntry(url))
  memoryCache.keys().forEach((key) => memoryCache.delete(key))
}

function getCacheStats() {
  loadUrlMap()
  loadCacheMeta()
  return {
    memoryCount: memoryCache.size(),
    localCount: Object.keys(urlMap || {}).length,
    queueLength: downloadQueue.length,
    activeDownloads
  }
}

module.exports = {
  resolveImage,
  preloadImages,
  getCachedPath,
  clearExpiredCache,
  clearAllCache,
  getCacheStats
}
