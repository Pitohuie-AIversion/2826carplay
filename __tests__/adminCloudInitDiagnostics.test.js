const fs = require("fs")
const path = require("path")
const vm = require("vm")

function loadPage(name) {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  global.getApp = () => ({ globalData: { cloudEnvId: "test-env" } })
  const failure = Object.assign(new Error("private SDK error"), { phone: "13800000000", token: "secret-token" })
  global.wx = {
    cloud: { init: jest.fn(() => { throw failure }), callFunction: jest.fn() },
    showToast: jest.fn(), redirectTo: jest.fn()
  }
  require(`../pages-admin/${name}/${name}`)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = (patch) => Object.assign(page.data, patch)
  global.getCurrentPages = () => [page]
  return page
}

describe("admin cloud initialization diagnostics", () => {
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

  test.each(["vehicle-create", "vehicle-edit", "vehicle-detail-manage"])("%s reports the operation without exposing the SDK error", (name) => {
    const sink = jest.spyOn(console, "error").mockImplementation(() => {})
    const page = loadPage(name)
    expect(() => page.onLoad({ id: "car_1" })).not.toThrow()
    expect(sink).toHaveBeenCalledTimes(1)
    expect(sink).toHaveBeenCalledWith(`[${name}] wx.cloud.init failed`)
    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({ name: "getMyPermissions" }))
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["vehicle-create", "vehicle-edit", "vehicle-detail-manage"])("%s continues permission checks even when diagnostics throw", (name) => {
    jest.spyOn(console, "error").mockImplementation(() => { throw new Error("logging unavailable") })
    const page = loadPage(name)
    expect(() => page.onLoad({ id: "car_1" })).not.toThrow()
    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({ name: "getMyPermissions" }))
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each([undefined, {}, { error: null }])("unavailable console %p remains optional", (consoleValue) => {
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../shared/diagnostics.js"), "utf8"), { module, console: consoleValue })
    expect(() => module.exports.reportDiagnostic("[test] operation failed")).not.toThrow()
  })
})
