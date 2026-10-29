function loadPage(name) {
  jest.resetModules()
  let definition
  global.Page = (input) => { definition = input }
  global.getApp = () => ({ globalData: {} })
  global.wx = { cloud: { callFunction: jest.fn() } }
  require(`../pages/${name}/${name}`)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = (patch) => Object.assign(page.data, patch)
  global.getCurrentPages = () => [page]
  return page
}

describe("page disposal diagnostics", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    jest.restoreAllMocks()
    delete global.Page
    delete global.getApp
    delete global.getCurrentPages
    delete global.wx
  })

  test.each(["booking", "booking-detail", "booking-manage-detail"])("%s logs only a fixed disposal label", (name) => {
    const sink = jest.spyOn(console, "error").mockImplementation(() => {})
    const page = loadPage(name)
    const failure = Object.assign(new Error("private error detail"), { phone: "13800000000", token: "secret-token" })
    page._perf = { dispose: jest.fn(() => { throw failure }) }
    expect(() => page.onUnload()).not.toThrow()
    expect(page._perf.dispose).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith(`[${name}] perf dispose failed`)
    expect(sink).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["booking", "booking-detail", "booking-manage-detail"])("%s still unloads when both disposal and logging fail", (name) => {
    jest.spyOn(console, "error").mockImplementation(() => { throw new Error("logging unavailable") })
    const page = loadPage(name)
    page._perf = { dispose: jest.fn(() => { throw new Error("dispose failed") }) }
    expect(() => page.onUnload()).not.toThrow()
    expect(page._perf.dispose).toHaveBeenCalledTimes(1)
    expect(page._nativeActionsUnloaded).toBe(true)
    expect(jest.getTimerCount()).toBe(0)
  })
})
