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
})
