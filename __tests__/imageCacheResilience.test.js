describe("shared/imageCache 图片缓存健壮性与防失效机制", () => {
  beforeEach(() => {
    jest.resetModules()
  })

  afterEach(() => {
    delete global.wx
  })

  test("当本地缓存文件已被系统回收删除时，getCachedPath 安全降级返回原网络链接并清理失效记录", () => {
    const STORAGE_KEY_MAP = "image_cache_url_map_v1"
    const storage = {
      [STORAGE_KEY_MAP]: {
        "https://example.com/car.jpg": "wxfile://tmp_deleted_car.jpg"
      }
    }
    const mockFs = {
      accessSync: jest.fn((filePath) => {
        if (filePath.includes("deleted")) {
          throw new Error("fail no such file or directory")
        }
      })
    }

    global.wx = {
      getStorageSync: jest.fn((key) => storage[key]),
      setStorageSync: jest.fn((key, val) => {
        storage[key] = val
      }),
      getFileSystemManager: jest.fn(() => mockFs)
    }

    const { getCachedPath } = require("../shared/imageCache")
    const result = getCachedPath("https://example.com/car.jpg")

    // 应安全降级为原始 URL，而不是返回不存在的本地死链
    expect(result).toBe("https://example.com/car.jpg")
    expect(mockFs.accessSync).toHaveBeenCalledWith("wxfile://tmp_deleted_car.jpg")
    // 失效记录应已从存储映射中清理
    expect(storage[STORAGE_KEY_MAP]["https://example.com/car.jpg"]).toBeUndefined()
  })

  test("当本地缓存文件有效时，getCachedPath 正常返回本地路径", () => {
    const STORAGE_KEY_MAP = "image_cache_url_map_v1"
    const storage = {
      [STORAGE_KEY_MAP]: {
        "https://example.com/valid.jpg": "wxfile://valid_car.jpg"
      }
    }
    const mockFs = {
      accessSync: jest.fn(() => true)
    }

    global.wx = {
      getStorageSync: jest.fn((key) => storage[key]),
      setStorageSync: jest.fn((key, val) => {
        storage[key] = val
      }),
      getFileSystemManager: jest.fn(() => mockFs)
    }

    const { getCachedPath } = require("../shared/imageCache")
    const result = getCachedPath("https://example.com/valid.jpg")
    expect(result).toBe("wxfile://valid_car.jpg")
  })

  test("resolveImage 遇到失效本地文件时自动清理并重新执行下载", async () => {
    const STORAGE_KEY_MAP = "image_cache_url_map_v1"
    const storage = {
      [STORAGE_KEY_MAP]: {
        "https://example.com/stale.jpg": "wxfile://stale.jpg"
      }
    }
    const mockFs = {
      accessSync: jest.fn((path) => {
        if (path === "wxfile://stale.jpg") {
          throw new Error("file missing")
        }
      }),
      saveFile: jest.fn(({ success }) => {
        success({ savedFilePath: "wxfile://new_fresh.jpg" })
      })
    }

    global.wx = {
      getStorageSync: jest.fn((key) => storage[key]),
      setStorageSync: jest.fn((key, val) => {
        storage[key] = val
      }),
      getFileSystemManager: jest.fn(() => mockFs),
      downloadFile: jest.fn(({ success }) => {
        success({ statusCode: 200, tempFilePath: "wxfile://tmp_fresh.jpg" })
      })
    }

    const { resolveImage } = require("../shared/imageCache")
    const result = await resolveImage("https://example.com/stale.jpg")
    expect(result.localPath).toBe("wxfile://new_fresh.jpg")
    expect(wx.downloadFile).toHaveBeenCalled()
  })

  test("car-card 组件在同一封面已加载后重新触发 observer 时，不重置 imageLoading: true", () => {
    let componentDefinition = null
    global.Component = jest.fn((options) => {
      componentDefinition = options
    })
    global.wx = {
      getStorageSync: jest.fn(() => ({})),
      setStorageSync: jest.fn()
    }

    require("../components/car-card/car-card")
    expect(componentDefinition).toBeDefined()

    const instance = {
      ...componentDefinition,
      ...componentDefinition.methods,
      data: { ...componentDefinition.data },
      setData: jest.fn(function (patch) {
        Object.assign(this.data, patch)
      })
    }

    // 第一次触发 observer
    componentDefinition.observers["car.cover"].call(instance, "https://example.com/cover1.jpg")
    expect(instance.data.imageLoading).toBe(true)

    // 触发图片加载成功回调
    instance.handleImageLoad()
    expect(instance.data.imageLoading).toBe(false)

    // 页面更新，重新给 car.cover 传入相同封面（模拟列表刷新或返回首页）
    componentDefinition.observers["car.cover"].call(instance, "https://example.com/cover1.jpg")
    // 不应重新进入加载中状态（避免遮罩闪烁）
    expect(instance.data.imageLoading).toBe(false)
  })

  test("car-detail 页面对已加载过的图片，再次渲染时不重置 loaded: false", () => {
    let pageDefinition = null
    global.Page = jest.fn((options) => {
      pageDefinition = options
    })
    global.wx = {
      getStorageSync: jest.fn(() => ({})),
      setStorageSync: jest.fn(),
      setNavigationBarTitle: jest.fn(),
      cloud: { callFunction: jest.fn() }
    }

    require("../pages/car-detail/car-detail")
    expect(pageDefinition).toBeDefined()

    const page = {
      ...pageDefinition,
      data: { ...pageDefinition.data },
      setData: jest.fn(function (patch) {
        Object.assign(this.data, patch)
      })
    }

    page.applyCar({
      id: "car-persistent",
      name: "超跑",
      status: "available",
      images: ["https://example.com/hero1.jpg"]
    })

    // 首次应用车辆，图片待加载
    expect(page.data.car.imageItems[0].loaded).toBe(false)

    // 模拟图片加载完成
    page.handleHeroImageLoad({ currentTarget: { dataset: { index: 0 } } })

    // 重新进入或再次应用相同车辆
    page.applyCar({
      id: "car-persistent",
      name: "超跑",
      status: "available",
      images: ["https://example.com/hero1.jpg"]
    })

    // 第二次进入应直接识别为已加载，不显示加载中遮罩
    expect(page.data.car.imageItems[0].loaded).toBe(true)
  })
})
