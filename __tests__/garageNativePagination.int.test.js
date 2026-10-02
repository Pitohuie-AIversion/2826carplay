jest.mock("wx-server-sdk")

function vehicle(index, extra = {}) {
  return { _id: `car_${index}`, brandModel: `Car ${index}`, status: "idle", vehicleType: "sedan",
    updatedAt: new Date(2026, 0, 1, 0, 0, index), ...extra }
}

function setup(rows, options = {}) {
  let records = rows
  const reads = []
  function query() {
    let fields = null
    let condition = null
    let ordered = false
    let offset = 0
    let limit = 100
    const selected = () => records.filter((row) => !condition || row.status !== condition.status.ne)
    const ref = {
      field: (value) => { fields = value; return ref },
      where: (value) => { condition = value; return ref },
      orderBy: () => { ordered = true; return ref },
      skip: (value) => { offset = value; return ref },
      limit: (value) => { limit = Math.min(value, 100); return ref },
      count: async () => ({ total: selected().length }),
      get: async () => {
        if (options.failAll || (options.missingIndex && ordered)) throw new Error("database query failed")
        reads.push({ fields, offset, limit })
        const list = selected().slice()
        if (ordered) list.sort((a, b) => b.updatedAt - a.updatedAt)
        return { data: list.slice(offset, offset + limit).map((row) => fields
          ? Object.fromEntries(Object.keys(fields).filter((key) => row[key] !== undefined).map((key) => [key, row[key]]))
          : row) }
      }
    }
    return ref
  }
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockDb({ command: { neq: (value) => ({ ne: value }) }, collection: () => query() })
  return { mod: require("../cloudfunctions/garageVehicleList/index"), replace: (next) => { records = next }, reads }
}

describe("首页真实查询投影与分页", () => {
  let warn
  let error
  beforeEach(() => { warn = jest.spyOn(console, "warn").mockImplementation(() => {}); error = jest.spyOn(console, "error").mockImplementation(() => {}) })
  afterEach(() => { warn.mockRestore(); error.mockRestore() })

  test("筛选车辆仍使用图片列表中的封面，不因统计投影丢图", async () => {
    const { mod } = setup([vehicle(0, { imageList: ["cloud://image1", "cloud://image2"], coverImage: "" })])
    const res = await mod.main({ keyword: "Car", pageSize: 20 })
    expect(res.ok).toBe(true)
    expect(res.list[0]).toMatchObject({ cover: "cloud://image1", images: ["cloud://image1", "cloud://image2"] })
  })

  test("筛选不复用缓存中的旧价格和已停用车辆", async () => {
    const mock = setup([vehicle(0, { priceDay: 100 }), vehicle(1, { priceDay: 200 })])
    await mock.mod.main({ page: 0, pageSize: 20 })
    mock.replace([vehicle(0, { status: "retired" }), vehicle(1, { priceDay: 300 })])
    const res = await mock.mod.main({ keyword: "Car" })
    expect(res.total).toBe(1)
    expect(res.list[0]).toMatchObject({ id: "car_1", priceDay: 300 })
  })

  test("刷新可以使30秒内的旧可预约数量立即失效", async () => {
    const mock = setup([vehicle(0, { status: "active" })])
    expect((await mock.mod.main({})).availableCount).toBe(0)
    mock.replace([vehicle(0)])
    expect((await mock.mod.main({ refreshStats: true })).availableCount).toBe(1)
  })

  test.each([20, 100])("完整%d条末页不再声明有下一页", async (pageSize) => {
    const mock = setup(Array.from({ length: pageSize * 2 }, (_, i) => vehicle(i)))
    const res = await mock.mod.main({ page: 1, pageSize, skipStats: true })
    expect(res.list).toHaveLength(pageSize)
    expect(res.hasMore).toBe(false)
  })

  test("超过统计500条仍可浏览完整车辆，但不返回残缺筛选成功", async () => {
    const mock = setup(Array.from({ length: 501 }, (_, i) => vehicle(i)))
    const first = await mock.mod.main({ page: 0, pageSize: 20 })
    expect(first).toMatchObject({ ok: true, total: 501, truncated: true, hasMore: true })
    const last = await mock.mod.main({ page: 25, pageSize: 20, skipStats: true })
    expect(last.list).toHaveLength(1)
    expect(last.hasMore).toBe(false)
    const filtered = await mock.mod.main({ keyword: "Car 0" })
    expect(filtered).toMatchObject({ ok: false, code: "CATALOG_LIMIT_REACHED" })
  })

  test("缺少排序索引时完整排序后分页，首屏不会漏掉最新车辆", async () => {
    const mock = setup(Array.from({ length: 30 }, (_, i) => vehicle(i)), { missingIndex: true })
    const res = await mock.mod.main({ page: 0, pageSize: 10 })
    expect(res.ok).toBe(true)
    expect(res.list[0].id).toBe("car_29")
    expect(res.list[9].id).toBe("car_20")
    expect(res.hasMore).toBe(true)
  })

  test("原生及降级查询均失败时返回可重试业务错误，不抛出未处理拒绝", async () => {
    const { mod } = setup([], { failAll: true })
    await expect(mod.main({})).resolves.toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
  })
})
