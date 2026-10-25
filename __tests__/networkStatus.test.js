describe("network state initialization ordering", () => {
  let network, initialRead, statusChanged
  beforeEach(() => {
    jest.resetModules()
    global.wx = {
      getNetworkType: jest.fn((options) => { initialRead = options.success }),
      onNetworkStatusChange: jest.fn((callback) => { statusChanged = callback })
    }
    network = require("../shared/networkStatus")
  })
  afterEach(() => { network._resetForTesting(); delete global.wx })

  test("a late initial response cannot overwrite a newer disconnect or suppress recovery", () => {
    const reconnected = jest.fn()
    const dispose = network.onNetworkReconnect(reconnected)
    statusChanged({ isConnected: false, networkType: "none" })
    initialRead({ networkType: "wifi" })
    expect(network.getNetworkState().isConnected).toBe(false)
    statusChanged({ isConnected: true, networkType: "4g" })
    expect(reconnected).toHaveBeenCalledTimes(1)
    dispose()
    expect(network.getNetworkState().listenerCount).toBe(0)
  })

  test("initial offline state is used when no newer event has arrived", () => {
    const reconnected = jest.fn()
    network.onNetworkReconnect(reconnected)
    initialRead({ networkType: "none" })
    expect(network.getNetworkState().isConnected).toBe(false)
    statusChanged({ isConnected: true, networkType: "wifi" })
    expect(reconnected).toHaveBeenCalledTimes(1)
  })

  test.each(["none", "wifi"])("initial %s state reaches status subscribers without a native change event", (networkType) => {
    const changed = jest.fn()
    const reconnected = jest.fn()
    network.onNetworkStatusChange(changed)
    network.onNetworkReconnect(reconnected)
    initialRead({ networkType })
    expect(changed).toHaveBeenCalledWith({
      isConnected: networkType !== "none", networkType, previousConnected: true
    })
    expect(reconnected).not.toHaveBeenCalled()
  })

  test("a synchronous initial read reaches the first status subscriber", () => {
    wx.getNetworkType.mockImplementation(({ success }) => success({ networkType: "none" }))
    const changed = jest.fn()
    network.onNetworkStatusChange(changed)
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith({ isConnected: false, networkType: "none", previousConnected: true })
  })

  test("an unsubscribed page does not receive a pending initial status", () => {
    const changed = jest.fn()
    const dispose = network.onNetworkStatusChange(changed)
    dispose()
    initialRead({ networkType: "none" })
    expect(changed).not.toHaveBeenCalled()
    expect(network.getNetworkState().isConnected).toBe(false)
  })

  test("a stale initial read cannot publish an older state to subscribers", () => {
    const changed = jest.fn()
    network.onNetworkStatusChange(changed)
    statusChanged({ isConnected: false, networkType: "none" })
    initialRead({ networkType: "wifi" })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenLastCalledWith({ isConnected: false, networkType: "none", previousConnected: true })
  })
})
