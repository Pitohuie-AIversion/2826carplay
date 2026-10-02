jest.mock("../shared/analytics", () => ({ trackEvent: jest.fn() }))

async function flushPromises() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve()
}

describe("car detail authoritative state and poster lifecycle", () => {
  let page
  let requests
  let currentPages

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    requests = []
    global.wx = {
      cloud: { callFunction: jest.fn((options) => requests.push(options)) },
      setNavigationBarTitle: jest.fn(), showToast: jest.fn(), navigateTo: jest.fn(), openLocation: jest.fn(),
      getStorageSync: jest.fn(), setStorageSync: jest.fn(), removeStorageSync: jest.fn(),
      showLoading: jest.fn(), hideLoading: jest.fn(), saveImageToPhotosAlbum: jest.fn(),
      canvasToTempFilePath: jest.fn(), vibrateShort: jest.fn()
    }
    global.Page = (definition) => {
      page = { ...definition, data: { ...definition.data } }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require("../pages/car-detail/car-detail")
    currentPages = [page]
    global.getCurrentPages = () => currentPages
  })

  afterEach(() => {
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  const car = (id) => ({ id, name: id, status: "available", images: [], priceDay: 500 })

  const hubs = [
    { id: "hz-store", city: "杭州", type: "store", name: "杭州门店", address: "杭州已保存地址", latitude: 30.2, longitude: 120.1 },
    { id: "sh-store", city: "上海", type: "store", name: "上海门店", address: "上海已保存地址", latitude: 31.2, longitude: 121.4 }
  ]

  test.each(["config-first", "detail-first"])("%s resolves the current saved city instead of the stale entry city", (order) => {
    page._initialCity = "杭州"
    page.loadOperationConfig({ force: true })
    page.loadCarDetail("a")
    const config = requests.find((request) => request.name === "operationConfigGet")
    const detail = requests.find((request) => request.name === "vehiclePublicDetail")
    const completeConfig = () => config.success({ result: { ok: true, config: { serviceHubs: hubs } } })
    const completeDetail = () => detail.success({ result: { ok: true, car: { ...car("a"), location: "上海市" } } })
    if (order === "config-first") {
      completeConfig()
      expect(page.data.serviceHub).toBeNull()
      completeDetail()
    } else {
      completeDetail()
      expect(page.data.serviceHub).toBeNull()
      completeConfig()
    }
    expect(page.data.serviceHub).toEqual(hubs[1])
    expect(page.data.canNavigate).toBe(true)
    page.handleOpenLocation()
    expect(wx.openLocation).toHaveBeenCalledWith(expect.objectContaining({ name: hubs[1].name, address: hubs[1].address, latitude: hubs[1].latitude, longitude: hubs[1].longitude }))
    page.handleBookingTap()
    expect(new URL(wx.navigateTo.mock.calls[0][0].url, "https://local.test").searchParams.get("city")).toBe("上海")
  })

  test("a refreshed vehicle city and an explicitly cleared city replace the previous navigation and booking city", () => {
    page._initialCity = "杭州"
    page.data.serviceHubs = hubs
    for (const location of ["杭州", "上海", ""]) {
      page.loadCarDetail("a")
      requests[requests.length - 1].success({ result: { ok: true, car: { ...car("a"), location } } })
      expect(page.data.serviceHub).toEqual(hubs.find((hub) => hub.city === location) || null)
      expect(page.data.canNavigate).toBe(Boolean(location))
      wx.navigateTo.mockClear()
      page.handleBookingTap()
      expect(new URL(wx.navigateTo.mock.calls[0][0].url, "https://local.test").searchParams.get("city")).toBe(location || null)
    }
    page.handleOpenLocation()
    expect(wx.openLocation).not.toHaveBeenCalled()
  })

  test("switching vehicles while configuration is pending resolves the latest vehicle only", () => {
    page._initialCity = "杭州"
    page.loadOperationConfig({ force: true })
    const config = requests[0]
    page.loadCarDetail("a")
    const oldDetail = requests[1]
    page.loadCarDetail("b")
    requests[2].success({ result: { ok: true, car: { ...car("b"), location: "sh-store" } } })
    config.success({ result: { ok: true, config: { serviceHubs: hubs } } })
    oldDetail.success({ result: { ok: true, car: { ...car("a"), location: "杭州" } } })
    expect(page.data.car.id).toBe("b")
    expect(page.data.serviceHub).toEqual(hubs[1])
    page.handleBookingTap()
    const query = new URL(wx.navigateTo.mock.calls[0][0].url, "https://local.test").searchParams
    expect(query.get("vehicleId")).toBe("b")
    expect(query.get("city")).toBe("上海")
  })

  test("updated or removed stores replace the visible address and navigation without falling back to another city", () => {
    page.applyCar({ ...car("a"), location: "上海" })
    const updated = { ...hubs[1], address: "上海新地址", latitude: 31.3, longitude: 121.5 }
    for (const serviceHubs of [hubs, [hubs[0], updated], [hubs[0]], []]) {
      page.loadOperationConfig({ force: true })
      requests[requests.length - 1].success({ result: { ok: true, config: { serviceHubs } } })
      const expected = serviceHubs.find((hub) => hub.city === "上海") || null
      expect(page.data.serviceHub).toEqual(expected)
      expect(page.data.canNavigate).toBe(Boolean(expected))
      wx.openLocation.mockClear()
      page.handleOpenLocation()
      if (expected) expect(wx.openLocation).toHaveBeenCalledWith(expect.objectContaining({ address: expected.address, latitude: expected.latitude, longitude: expected.longitude }))
      else expect(wx.openLocation).not.toHaveBeenCalled()
    }
  })

  test("a stale route city cannot disambiguate a saved store name shared by different cities", () => {
    page._initialCity = "杭州"
    page.data.serviceHubs = hubs.map((hub) => ({ ...hub, name: "中心门店" }))
    page.applyCar({ ...car("a"), location: "中心门店" })
    expect(page.data.serviceHub).toBeNull()
    expect(page.data.canNavigate).toBe(false)
    page.handleOpenLocation()
    expect(wx.openLocation).not.toHaveBeenCalled()
  })

  test("cached preview waits for the requested authoritative detail before booking and loses access on refresh failure", () => {
    wx.getStorageSync.mockReturnValueOnce(car("a"))
    page.loadCarDetail("a")
    expect(page.data.car.id).toBe("a")
    expect(page.data.detailVerified).toBe(false)
    page.handleBookingTap()
    expect(wx.navigateTo).not.toHaveBeenCalled()
    requests[0].success({ result: { ok: true, car: car("a") } })
    expect(page.data.detailVerified).toBe(true)
    page.handleBookingTap()
    expect(wx.navigateTo).toHaveBeenCalledTimes(1)
    page.loadCarDetail("a")
    page.handleBookingTap()
    expect(wx.navigateTo).toHaveBeenCalledTimes(1)
    requests[1].fail({ errMsg: "network failed" })
    expect(page.data).toMatchObject({ car: null, detailVerified: false, canNavigate: false, serviceHub: null })
    page.handleBookingTap()
    expect(wx.navigateTo).toHaveBeenCalledTimes(1)
  })

  test("cached data cannot bypass missing cloud access and another car's cache is ignored", () => {
    wx.getStorageSync.mockReturnValueOnce(car("a"))
    wx.cloud = null
    page.loadCarDetail("a")
    expect(page.data).toMatchObject({ car: null, detailVerified: false, loadError: true })
    wx.cloud = { callFunction: jest.fn((options) => requests.push(options)) }
    wx.getStorageSync.mockReturnValueOnce(car("wrong"))
    page.loadCarDetail("b")
    expect(page.data.car).toBeNull()
    requests[0].success({ result: { ok: true, car: car("wrong") } })
    expect(page.data).toMatchObject({ car: null, detailVerified: false, loadError: true })
    expect(wx.setStorageSync).not.toHaveBeenCalled()
  })

  test("switching cars invalidates old detail and favorite callbacks", () => {
    page.loadCarDetail("a")
    page.loadFavoriteStatus("a")
    page.handleFavoriteTap()
    const first = requests.slice()
    page.loadCarDetail("b")
    expect(page.data).toMatchObject({ carId: "b", car: null, detailVerified: false, favoriteLoading: false, favorited: false })
    first[0].success({ result: { ok: true, car: car("a") } })
    first[1].success({ result: { ok: true, favorited: true } })
    first[2].success({ result: { ok: true, favorited: true } })
    expect(page.data.car).toBeNull()
    expect(page.data.favorited).toBe(false)
    expect(wx.showToast).not.toHaveBeenCalled()
    requests[3].success({ result: { ok: true, car: car("b") } })
    expect(page.data).toMatchObject({ carId: "b", detailVerified: true })
    expect(page.data.car.id).toBe("b")
  })

  test("authoritative unavailability evicts the preview cache", () => {
    page.loadCarDetail("a")
    requests[0].success({ result: { ok: true, car: car("a") } })
    page.loadCarDetail("a")
    requests[1].success({ result: { ok: false, code: "NOT_AVAILABLE" } })
    expect(wx.removeStorageSync).toHaveBeenCalledWith("car_detail_a")
    page.loadCarDetail("a")
    expect(page.data.car).toBeNull()
    expect(page.data.detailVerified).toBe(false)
  })

  function prepareCanvas() {
    const queries = []
    const images = []
    const context = new Proxy({
      createLinearGradient: () => ({ addColorStop: jest.fn() }),
      measureText: () => ({ width: 20 })
    }, { get: (target, key) => key in target ? target[key] : (target[key] = jest.fn()) })
    const canvas = { getContext: () => context, createImage: () => { const image = {}; images.push(image); return image } }
    const query = { in: () => query, select: () => query, fields: () => query, exec: (callback) => queries.push(callback) }
    wx.createSelectorQuery = () => query
    return { queries, images, canvas }
  }

  test.each(["selector", "cover", "image", "export"])("a closed/reopened poster ignores the previous %s callback", async (stage) => {
    page.applyCar({ ...car("a"), cover: "cloud://a.jpg" })
    const { queries, images, canvas } = prepareCanvas()
    let resolveCover
    page.resolvePosterCover = jest.fn(() => new Promise((resolve) => { resolveCover = resolve }))
    page.handleOpenPosterModal()
    jest.advanceTimersByTime(60)
    if (stage !== "selector") queries[0]([{ node: canvas }])
    if (["image", "export"].includes(stage)) {
      resolveCover("wxfile://a.jpg")
      await flushPromises()
    }
    if (stage === "export") images[0].onload()
    const previousExport = wx.canvasToTempFilePath.mock.calls[0] && wx.canvasToTempFilePath.mock.calls[0][0]
    page.handleClosePosterModal()
    page.handleOpenPosterModal()
    page.setData.mockClear()
    if (stage === "selector") await queries[0]([{ node: canvas }])
    if (stage === "cover") { resolveCover("wxfile://a.jpg"); await flushPromises() }
    if (stage === "image") images[0].onload()
    if (stage === "export") previousExport.success({ tempFilePath: "wxfile://old-poster.png" })
    expect(page.setData).not.toHaveBeenCalled()
    expect(page.data.posterImagePath).toBe("")
    expect(page.data.posterGenerating).toBe(true)
  })

  test("switching cars cancels the poster while cover resolution is pending", async () => {
    page.applyCar({ ...car("a"), cover: "cloud://a.jpg" })
    const { queries, canvas } = prepareCanvas()
    let resolveCover
    page.resolvePosterCover = () => new Promise((resolve) => { resolveCover = resolve })
    page.handleOpenPosterModal()
    jest.advanceTimersByTime(60)
    queries[0]([{ node: canvas }])
    page.applyCar(car("b"))
    resolveCover("wxfile://a.jpg")
    await flushPromises()
    expect(wx.canvasToTempFilePath).not.toHaveBeenCalled()
    expect(page.data.posterModalVisible).toBe(false)
    expect(page.data.car.id).toBe("b")
  })

  test("leaving during poster download cannot open album saving and returning allows retry", async () => {
    page.applyCar(car("a"))
    page.setData({ posterModalVisible: true, posterImagePath: "cloud://poster.png", posterGenerating: true })
    let resolveCover
    page.resolvePosterCover = () => new Promise((resolve) => { resolveCover = resolve })
    const saving = page.handleSavePoster()
    page.onHide()
    currentPages = [page, {}]
    resolveCover("wxfile://poster.png")
    await saving
    expect(wx.saveImageToPhotosAlbum).not.toHaveBeenCalled()
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    currentPages = [page]
    page.onShow()
    expect(page.data.posterGenerating).toBe(false)
    page.handleOpenPosterModal()
    expect(page.data.posterModalVisible).toBe(true)
  })

  test("late save success cannot close a newly opened poster", async () => {
    page.applyCar(car("a"))
    page.setData({ posterModalVisible: true, posterImagePath: "wxfile://old.png" })
    await page.handleSavePoster()
    const save = wx.saveImageToPhotosAlbum.mock.calls[0][0]
    page.handleClosePosterModal()
    page.handleOpenPosterModal()
    save.success()
    expect(page.data.posterModalVisible).toBe(true)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.vibrateShort).not.toHaveBeenCalled()
  })
})
