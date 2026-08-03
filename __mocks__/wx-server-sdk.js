function createCloud() {
  let mockContext = { OPENID: "" }
  let mockDb = null

  function wrapQueryValue(value, cache = new WeakMap()) {
    if (!value || (typeof value !== "object" && typeof value !== "function")) {
      return value
    }
    if (typeof value.then === "function") {
      return value
    }
    if (cache.has(value)) {
      return cache.get(value)
    }

    let passthroughField = null
    const proxy = new Proxy(value, {
      get(target, property, receiver) {
        if (property === "field" && !(property in target)) {
          if (!passthroughField) {
            passthroughField = jest.fn(() => proxy)
          }
          return passthroughField
        }
        return wrapQueryValue(Reflect.get(target, property, receiver), cache)
      },
      apply(target, thisArg, args) {
        return wrapQueryValue(Reflect.apply(target, thisArg, args), cache)
      }
    })
    cache.set(value, proxy)
    return proxy
  }

  const cloud = {
    DYNAMIC_CURRENT_ENV: "mock",
    init: jest.fn(),
    database: jest.fn(() => mockDb),
    getWXContext: jest.fn(() => mockContext),
    deleteFile: jest.fn().mockResolvedValue({ fileList: [] }),
    openapi: {
      subscribeMessage: {
        send: jest.fn().mockResolvedValue({})
      }
    },
    __setMockContext: (ctx) => {
      mockContext = ctx
    },
    __setMockDb: (db) => {
      mockDb = wrapQueryValue(db)
    },
    __reset: () => {
      mockContext = { OPENID: "" }
      mockDb = null
      cloud.init.mockClear()
      cloud.database.mockClear()
      cloud.getWXContext.mockClear()
      cloud.deleteFile.mockClear()
      cloud.openapi.subscribeMessage.send.mockReset()
      cloud.openapi.subscribeMessage.send.mockResolvedValue({})
    }
  }

  return cloud
}

module.exports = createCloud()
