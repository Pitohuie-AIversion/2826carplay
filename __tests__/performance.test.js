const { createPerformanceHelpers } = require("../shared/performance")

describe("batched state matches setData semantics", () => {
  let ticks, page, perf
  beforeEach(() => {
    jest.useFakeTimers()
    ticks = []
    global.wx = { nextTick: (callback) => ticks.push(callback) }
    page = { data: { booking: { id: "old", quote: { amount: 100 } }, form: { city: "杭州" }, rows: [{ selected: false }] }, setData: jest.fn() }
    perf = createPerformanceHelpers(page)
  })
  afterEach(() => { perf.dispose(); delete global.wx; jest.useRealTimers() })

  test("replaces object snapshots and clears deleted fields in the same tick", () => {
    perf.applyState({ booking: { id: "new" } })
    expect(page.data.booking).toEqual({ id: "new" })
    perf.applyState({ booking: {} })
    expect(page.data.booking).toEqual({})
    expect(page.setData).not.toHaveBeenCalled()
    ticks[0]()
    expect(page.setData).toHaveBeenCalledWith({ booking: {} })
  })

  test("synchronously applies nested paths and sends one ordered batch", () => {
    perf.applyState({ "form.city": "上海", "rows[0].selected": true })
    expect(page.data.form.city).toBe("上海")
    expect(page.data.rows[0].selected).toBe(true)
    perf.applyState({ form: { city: "北京", keyword: "" } })
    perf.applyState({ "form.keyword": "商务" })
    ticks[0]()
    expect(page.setData).toHaveBeenCalledTimes(1)
    expect(page.setData).toHaveBeenCalledWith({ form: { city: "北京", keyword: "商务" }, "rows[0].selected": true })
  })

  test("an old nextTick cannot flush a newer batch after flushStateNow", () => {
    perf.applyState({ loading: true })
    perf.flushStateNow()
    perf.applyState({ loading: false })
    ticks[0]()
    expect(page.setData).toHaveBeenCalledTimes(1)
    ticks[1]()
    expect(page.setData).toHaveBeenLastCalledWith({ loading: false })
  })

  test("does not overwrite newer direct logical updates at render time", () => {
    perf.applyState({ booking: { id: "queued" } })
    page.data.booking = { id: "latest" }
    ticks[0]()
    expect(page.setData).toHaveBeenCalledWith({ booking: { id: "latest" } })
  })

  test("leading debounce runs once per quiet interval and cannot restart after dispose", () => {
    const fn = jest.fn()
    const debounced = perf.debounce(fn, 250, true)
    debounced("first")
    debounced("second")
    jest.advanceTimersByTime(200)
    debounced("third")
    expect(fn).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(250)
    debounced("next")
    expect(fn).toHaveBeenCalledTimes(2)
    perf.dispose()
    debounced("after unload")
    jest.runOnlyPendingTimers()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  test("dispose cancels fallback rendering and trailing debounce", () => {
    const fn = jest.fn()
    perf.debounce(fn, 250)("value")
    perf.applyState({ loading: true })
    perf.dispose()
    ticks.forEach((callback) => callback())
    jest.runOnlyPendingTimers()
    expect(page.setData).not.toHaveBeenCalled()
    expect(fn).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })
})
