function loadPageDefinition() {
  jest.resetModules()
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  global.getApp = () => ({ globalData: {} })
  global.wx = {
    showToast: jest.fn(),
    showModal: jest.fn(),
    redirectTo: jest.fn(),
    cloud: {
      callFunction: jest.fn(),
      init: jest.fn()
    }
  }
  require("../pages/booking-manage/booking-manage")
  return definition
}

function createPage(definition, overrides) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      ...(overrides || {})
    }
  }
  page.setData = jest.fn((patch) => {
    Object.assign(page.data, patch)
  })
  return page
}

describe("booking-manage error path in onLoad", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })

  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    jest.clearAllMocks()
  })

  test("wx.cloud.init error is caught gracefully in onLoad", () => {
    const definition = loadPageDefinition()
    global.getApp = () => ({ globalData: { cloudEnvId: "test-env" } })
    global.wx = {
      cloud: {
        init: jest.fn(() => {
          throw new Error("cloud init failed")
        })
      },
      showToast: jest.fn(),
      redirectTo: jest.fn()
    }

    const page = createPage(definition)

    expect(() => {
      page.onLoad()
    }).not.toThrow()

    expect(global.wx.cloud.init).toHaveBeenCalledWith({
      env: "test-env",
      traceUser: true
    })
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
  })
})
