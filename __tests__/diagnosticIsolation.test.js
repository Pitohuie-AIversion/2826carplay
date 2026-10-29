const fs = require("fs")
const path = require("path")
const vm = require("vm")

describe("diagnostics preserve exception isolation", () => {
  beforeEach(() => {
    jest.resetModules()
    jest.spyOn(console, "error").mockImplementation(() => { throw new Error("logging unavailable") })
  })
  afterEach(() => {
    jest.restoreAllMocks()
    delete global.wx
  })

  test.each(["onError", "onUnhandledRejection"])("App.%s does not retry a failed logger", (handler) => {
    let app
    const logger = () => { throw new Error("logging unavailable") }
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), {
      App: (definition) => { app = definition }, console: { error: logger, warn: logger }
    })
    expect(() => app[handler](new Error("original failure"))).not.toThrow()
  })

  test("a failed listener and logger cannot prevent later network listeners", () => {
    const network = require("../shared/networkStatus")
    const nextListener = jest.fn()
    network.onNetworkStatusChange(() => { throw new Error("listener failed") })
    network.onNetworkStatusChange(nextListener)
    expect(() => network._simulateStatusChange({ isConnected: false, networkType: "none" })).not.toThrow()
    expect(nextListener).toHaveBeenCalledTimes(1)
  })

  test("a failed callback and logger cannot leave cloud requests unresolved", async () => {
    let request
    global.wx = { cloud: { callFunction: (options) => { request = options } } }
    const { callCloud } = require("../shared/cloudClient")
    const complete = jest.fn()
    const result = callCloud("example", {}, {
      timeoutMs: 0,
      onSuccess: () => { throw new Error("callback failed") },
      onComplete: complete
    })
    expect(() => request.success({ result: { ok: true, data: "loaded" } })).not.toThrow()
    expect(await Promise.race([result, Promise.resolve("still pending")])).toMatchObject({ ok: true, data: "loaded" })
    expect(complete).toHaveBeenCalledTimes(1)
  })
})
