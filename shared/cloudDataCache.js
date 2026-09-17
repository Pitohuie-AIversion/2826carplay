const memoryCache = new Map()
const pendingPromises = new Map()

function getCached(key, ttlMs) {
  if (!memoryCache.has(key)) {
    return undefined
  }
  const entry = memoryCache.get(key)
  const now = Date.now()
  const ttl = Number(ttlMs) > 0 ? Number(ttlMs) : 0
  if (ttl > 0 && now - entry.timestamp > ttl) {
    memoryCache.delete(key)
    return undefined
  }
  return entry.data
}

function setCache(key, data) {
  memoryCache.set(key, {
    data,
    timestamp: Date.now()
  })
}

function invalidateCache(key) {
  if (typeof key === "string") {
    memoryCache.delete(key)
    pendingPromises.delete(key)
  } else {
    memoryCache.clear()
    pendingPromises.clear()
  }
}

function fetchWithCache(key, fetcher, ttlMs = 5 * 60 * 1000) {
  const cached = getCached(key, ttlMs)
  if (cached !== undefined) {
    return Promise.resolve(cached)
  }

  if (pendingPromises.has(key)) {
    return pendingPromises.get(key)
  }

  const promise = Promise.resolve()
    .then(() => fetcher())
    .then((data) => {
      setCache(key, data)
      return data
    })
    .finally(() => {
      pendingPromises.delete(key)
    })

  pendingPromises.set(key, promise)
  return promise
}

module.exports = {
  fetchWithCache,
  getCached,
  setCache,
  invalidateCache
}
