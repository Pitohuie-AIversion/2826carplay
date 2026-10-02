const pages = []

function setup(initialStorage = {}) {
  jest.resetModules()
  const requests = []
  const storage = { ...initialStorage }
  global.wx = {
    cloud: { callFunction: jest.fn((options) => requests.push(options)) },
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value },
    showToast: jest.fn()
  }
  let definition
  global.Page = (value) => { definition = value }
  require("../pages/garage/garage")
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)),
    setData(patch) { Object.assign(this.data, patch) } }
  pages.push(page)
  return { page, requests, storage }
}

const filters = { category: "all", city: "", keyword: "", availableOnly: false, sortBy: "default" }
const car = { id: "car", category: "supercar", name: "Porsche", status: "available" }

describe("首页查询与缓存一致性", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    pages.splice(0).forEach((page) => page.onUnload())
    jest.useRealTimers()
    delete global.wx
    delete global.Page
  })

  test("清空已配置城市时移除旧选项和隐藏筛选，并重新读取全部城市", () => {
    const { page, requests } = setup()
    page.data.cityOptions = ["杭州", "上海"]
    page.data.selectedCity = "杭州"
    page.loadOperationConfig({ force: true })
    requests[0].success({ result: { ok: true, config: { cityOptions: [] } } })
    expect(page.data.cityOptions).toEqual([])
    expect(page.data.selectedCity).toBe("")
    expect(requests[1].name).toBe("garageVehicleList")
    expect(requests[1].data.city).toBe("")
  })

  test.each(["success", "fail"])("搜索输入后防抖期间的旧%s回调不覆盖新输入", (outcome) => {
    const { page, requests } = setup()
    page.loadCars()
    const old = requests[0]
    page.handleSearchInput({ detail: { value: "Porsche" } })
    if (outcome === "success") old.success({ result: { ok: true, list: [{ id: "old" }], page: 3 } })
    else old.fail({ errMsg: "old request failed" })
    expect(page.data.searchKeyword).toBe("Porsche")
    expect(page.data.page).toBe(0)
    expect(page.data.loadError).toBe(false)
    expect(page.data.cars).toEqual([])
    jest.advanceTimersByTime(250)
    expect(requests[1].data).toMatchObject({ keyword: "Porsche", page: 0 })
  })

  test("清空输入的防抖窗口不能继续加载旧筛选的下一页", () => {
    const { page, requests } = setup()
    page.data.searchKeyword = "Porsche"
    page.data.hasMore = true
    page.data.page = 2
    page.handleSearchInput({ detail: { value: "" } })
    page.handleLoadMore()
    expect(requests).toEqual([])
    page.handleSearchConfirm({ detail: { value: "" } })
    expect(requests[0].data).toMatchObject({ keyword: "", page: 0 })
    jest.advanceTimersByTime(250)
    expect(requests).toHaveLength(1)
  })

  test.each(["expired", "different_query", "legacy"])("%s 快照不能用作当前查询结果", (kind) => {
    const snapshot = { cars: [car], pagination: { total: 99 }, filters: { ...filters }, savedAt: Date.now() }
    if (kind === "expired") snapshot.savedAt -= 60001
    if (kind === "different_query") snapshot.filters.city = "上海"
    if (kind === "legacy") delete snapshot.savedAt
    const { page } = setup({ garage_last_snapshot: snapshot })
    page.onLoad()
    expect(page.data.cars).toEqual([])
    expect(page.data.total).toBe(0)
  })

  test("成功读取空列表替换旧快照，恢复不会续期缓存", () => {
    const { page, requests, storage } = setup()
    page.applyCars([car], { total: 1 }, filters)
    page.loadCars({ force: true })
    expect(requests[0].data.refreshStats).toBe(true)
    requests[0].success({ result: { ok: true, list: [], total: 0, hasMore: false } })
    expect(storage.garage_last_snapshot.cars).toEqual([])
    const snapshot = storage.garage_last_snapshot
    jest.advanceTimersByTime(500)
    const second = setup({ garage_last_snapshot: snapshot })
    second.page.onLoad()
    expect(second.page.data.initialLoading).toBe(false)
    expect(second.storage.garage_last_snapshot.savedAt).toBe(snapshot.savedAt)
  })

  test("加载更多只返回车辆时保留首屏统计和分类数量", () => {
    const { page, requests } = setup()
    page.applyCars([car], { page: 0, hasMore: true, total: 120, categoryTotal: 120, availableCount: 90, categoryCounts: { all: 120, supercar: 100 }, truncated: true })
    page.loadCars({ append: true })
    requests[0].success({ result: { ok: true, page: 1, hasMore: true, list: [{ ...car, id: "car2" }] } })
    expect(page.data.total).toBe(120)
    expect(page.data.categorySummary).toMatchObject({ total: 120, available: 90 })
    expect(page.data.categories.find((item) => item.id === "supercar").count).toBe(100)
    expect(page.data.truncated).toBe(true)
    expect(page.data.cars).toHaveLength(2)
  })

  test("追加新分页不会给旧首屏和整份快照续期，超过60秒回到页面应刷新", () => {
    const { page, requests, storage } = setup()
    page.loadCars()
    requests[0].success({ result: { ok: true, page: 0, hasMore: true, total: 2, list: [car] } })
    const initialLoadedAt = Date.now()
    jest.advanceTimersByTime(70000)
    page.loadCars({ append: true })
    requests[1].success({ result: { ok: true, page: 1, hasMore: false, list: [{ ...car, id: "car2" }] } })
    expect(storage.garage_last_snapshot.savedAt).toBe(initialLoadedAt)
    expect(page._lastCarsLoadedAt).toBe(initialLoadedAt)
    jest.advanceTimersByTime(10000)
    page.onShow()
    const vehicleRequests = requests.filter((request) => request.name === "garageVehicleList")
    expect(vehicleRequests).toHaveLength(3)
    expect(vehicleRequests[2].data.page).toBe(0)
  })

  test("加载更多业务失败保留已有列表与页码，允许重试", () => {
    const { page, requests } = setup()
    page.applyCars([car], { page: 2, total: 80, hasMore: true })
    page.loadCars({ append: true })
    requests[0].success({ result: { ok: false, code: "INTERNAL_ERROR" } })
    expect(page.data.cars[0].id).toBe("car")
    expect(page.data.page).toBe(2)
    expect(page.data.hasMore).toBe(true)
    expect(page.data.loadingCars).toBe(false)
    expect(page.data.loadError).toBe(false)
    page.handleLoadMore()
    expect(requests[1].data.page).toBe(3)
  })
})
