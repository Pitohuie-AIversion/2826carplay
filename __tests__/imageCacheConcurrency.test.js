function setup(initial = {}) {
  const storage = { ...initial }
  const downloads = []
  const saves = []
  const fs = { accessSync: jest.fn(), saveFile: jest.fn((options) => saves.push(options)) }
  global.wx = {
    getStorageSync: jest.fn((key) => storage[key]),
    setStorageSync: jest.fn((key, value) => { storage[key] = value }),
    getFileSystemManager: jest.fn(() => fs),
    removeSavedFile: jest.fn(),
    downloadFile: jest.fn((options) => downloads.push(options)),
    vibrateShort: jest.fn()
  }
  return { storage, downloads, saves, cache: require("../shared/imageCache") }
}

async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve()
}

describe("图片下载与重试并发", () => {
  beforeEach(() => { jest.resetModules(); jest.useFakeTimers() })
  afterEach(async () => {
    await jest.runAllTimersAsync()
    jest.useRealTimers()
    delete global.wx
    delete global.Page
    delete global.Component
  })

  test("原生下载同步抛错后可重新下载，不保留失败Promise", async () => {
    const { cache, downloads, saves } = setup()
    wx.downloadFile.mockImplementationOnce(() => { throw new Error("not ready") })
    await expect(cache.resolveImage("https://example.com/car.jpg")).rejects.toThrow("not ready")
    const retry = cache.resolveImage("https://example.com/car.jpg")
    expect(wx.downloadFile).toHaveBeenCalledTimes(2)
    downloads[0].success({ statusCode: 200, tempFilePath: "wxfile://temp" })
    saves[0].success({ savedFilePath: "wxfile://retry" })
    await expect(retry).resolves.toMatchObject({ localPath: "wxfile://retry" })
  })

  test("超时保存回调不覆盖重试的新缓存，并移除孤立旧文件", async () => {
    const { cache, downloads, saves } = setup()
    const url = "https://example.com/car.jpg"
    const old = cache.resolveImage(url)
    const rejected = expect(old).rejects.toThrow("timeout")
    downloads[0].success({ statusCode: 200, tempFilePath: "wxfile://old-temp" })
    await jest.advanceTimersByTimeAsync(20000)
    await rejected
    const retry = cache.resolveImage(url)
    downloads[1].success({ statusCode: 200, tempFilePath: "wxfile://new-temp" })
    saves[1].success({ savedFilePath: "wxfile://new" })
    await retry
    saves[0].success({ savedFilePath: "wxfile://old" })
    expect(cache.getCachedPath(url)).toBe("wxfile://new")
    expect(wx.removeSavedFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: "wxfile://old" }))
  })

  test("下载并发上限3，同URL合并请求，超时释放排队任务", async () => {
    const { cache } = setup()
    const first = cache.resolveImage("https://example.com/1.jpg")
    expect(cache.resolveImage("https://example.com/1.jpg")).toBe(first)
    const all = Promise.allSettled([first, ...[2, 3, 4].map((i) => cache.resolveImage(`https://example.com/${i}.jpg`))])
    expect(wx.downloadFile).toHaveBeenCalledTimes(3)
    expect(cache.getCacheStats()).toMatchObject({ activeDownloads: 3, queueLength: 1 })
    await jest.advanceTimersByTimeAsync(20000)
    expect(wx.downloadFile).toHaveBeenCalledTimes(4)
    await jest.advanceTimersByTimeAsync(20000)
    expect((await all).every((item) => item.status === "rejected")).toBe(true)
    expect(cache.getCacheStats()).toMatchObject({ activeDownloads: 0, queueLength: 0 })
  })

  test("清空缓存使待保存结果失效，且旧任务结束不会删除新任务去重记录", async () => {
    const { cache, downloads, saves, storage } = setup({ image_cache_confirmed_v1: ["https://example.com/confirmed.jpg"] })
    const url = "https://example.com/car.jpg"
    const old = cache.resolveImage(url)
    const rejected = expect(old).rejects.toThrow("cleared")
    downloads[0].success({ statusCode: 200, tempFilePath: "wxfile://old-temp" })
    cache.clearAllCache()
    const retry = cache.resolveImage(url)
    saves[0].success({ savedFilePath: "wxfile://old" })
    await rejected
    expect(cache.getCachedPath(url)).toBe(url)
    expect(cache.resolveImage(url)).toBe(retry)
    expect(storage.image_cache_confirmed_v1).toEqual([])
    downloads[1].success({ statusCode: 200, tempFilePath: "wxfile://new-temp" })
    saves[1].success({ savedFilePath: "wxfile://new" })
    await retry
  })

  test("图片解码失败清除仍存在的坏文件，重试重新下载", async () => {
    const url = "https://example.com/corrupt.jpg"
    const { cache, downloads, saves } = setup({ image_cache_url_map_v1: { [url]: "wxfile://corrupt" } })
    expect(cache.isImageLoaded(url)).toBe(true)
    cache.unmarkImageLoaded(url)
    expect(cache.isImageLoaded(url)).toBe(false)
    expect(cache.getCachedPath(url)).toBe(url)
    const retry = cache.resolveImage(url)
    downloads[0].success({ statusCode: 200, tempFilePath: "wxfile://temp" })
    saves[0].success({ savedFilePath: "wxfile://fixed" })
    await expect(retry).resolves.toMatchObject({ localPath: "wxfile://fixed" })
  })

  test("卡片从一辆车换到已缓存的另一辆车时使用新车封面", () => {
    setup({ image_cache_url_map_v1: { "https://example.com/new.jpg": "wxfile://new" } })
    let definition
    global.Component = (value) => { definition = value }
    require("../components/car-card/car-card")
    const card = { ...definition.methods, _lastCover: "https://example.com/old.jpg", _imageLoaded: true,
      data: { displayCover: "wxfile://old" }, setData(patch) { Object.assign(this.data, patch) } }
    definition.observers["car.cover"].call(card, "https://example.com/new.jpg")
    expect(card.data.displayCover).toBe("wxfile://new")
    card.cancelPendingCoverResolve()
  })

  test.each(["success", "failure", "unload"])("详情重试%s：路径正确，失败可再试，卸载后不写页面", async (outcome) => {
    const { downloads, saves } = setup()
    let definition
    global.Page = (value) => { definition = value }
    require("../pages/car-detail/car-detail")
    const page = { ...definition, data: { car: { imageItems: [{ src: "https://example.com/hero.jpg", failed: true }] } }, setData: jest.fn() }
    page.handleRetryHeroImage({ currentTarget: { dataset: { index: 0 } } })
    if (outcome === "unload") { page.cancelImageResolves(); page.setData.mockClear() }
    if (outcome === "failure") downloads[0].fail(new Error("network failed"))
    else {
      downloads[0].success({ statusCode: 200, tempFilePath: "wxfile://temp" })
      saves[0].success({ savedFilePath: "wxfile://hero" })
    }
    await flush()
    if (outcome === "unload") expect(page.setData).not.toHaveBeenCalled()
    else if (outcome === "failure") expect(page.setData).toHaveBeenLastCalledWith({ "car.imageItems[0].failed": true })
    else expect(page.setData).toHaveBeenLastCalledWith({ "car.imageItems[0].displaySrc": "wxfile://hero" })
  })
})
