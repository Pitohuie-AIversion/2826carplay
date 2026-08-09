const {
  activatePageNativeActions,
  beginPageNativeAction,
  cancelPageNativeActions,
  isPageNativeActionActive
} = require("../shared/pageNativeAction")

describe("page native action lifecycle", () => {
  afterEach(() => {
    delete global.getCurrentPages
    delete global.getApp
    delete global.App
    delete global.wx
  })

  test("keeps actions active during the current page lifecycle", () => {
    const page = {}
    activatePageNativeActions(page)
    const first = beginPageNativeAction(page)
    const second = beginPageNativeAction(page)

    expect(isPageNativeActionActive(page, first)).toBe(true)
    expect(isPageNativeActionActive(page, second)).toBe(true)
  })

  test("optionally invalidates an older action with the same exclusive key", () => {
    const page = {}
    activatePageNativeActions(page)
    const first = beginPageNativeAction(page, { exclusiveKey: "write-confirmation" })
    const unrelated = beginPageNativeAction(page, { exclusiveKey: "other-confirmation" })
    const second = beginPageNativeAction(page, { exclusiveKey: "write-confirmation" })

    expect(isPageNativeActionActive(page, first)).toBe(false)
    expect(isPageNativeActionActive(page, unrelated)).toBe(true)
    expect(isPageNativeActionActive(page, second)).toBe(true)
  })

  test("invalidates pending native callbacks when the page unloads", () => {
    const page = {}
    activatePageNativeActions(page)
    const action = beginPageNativeAction(page)

    cancelPageNativeActions(page)

    expect(isPageNativeActionActive(page, action)).toBe(false)
  })

  test("starts a separate lifecycle when the page loads again", () => {
    const page = {}
    activatePageNativeActions(page)
    const oldAction = beginPageNativeAction(page)
    cancelPageNativeActions(page)
    activatePageNativeActions(page)
    const newAction = beginPageNativeAction(page)

    expect(isPageNativeActionActive(page, oldAction)).toBe(false)
    expect(isPageNativeActionActive(page, newAction)).toBe(true)
  })

  test("optionally requires the action owner to remain the current page", () => {
    const page = {}
    const nextPage = {}
    activatePageNativeActions(page)
    const currentOnlyAction = beginPageNativeAction(page, { requireCurrent: true })
    const lifecycleOnlyAction = beginPageNativeAction(page)
    global.getCurrentPages = jest.fn(() => [page])

    expect(isPageNativeActionActive(page, currentOnlyAction)).toBe(true)
    global.getCurrentPages.mockReturnValue([page, nextPage])
    expect(isPageNativeActionActive(page, currentOnlyAction)).toBe(false)
    expect(isPageNativeActionActive(page, lifecycleOnlyAction)).toBe(true)
  })

  test("suppresses current-page feedback while the mini program is hidden", () => {
    const page = {}
    const app = { globalData: { nativeActionAppVisible: true } }
    global.getApp = jest.fn(() => app)
    global.getCurrentPages = jest.fn(() => [page])
    activatePageNativeActions(page)
    const currentOnlyAction = beginPageNativeAction(page, { requireCurrent: true })
    const lifecycleOnlyAction = beginPageNativeAction(page)

    app.globalData.nativeActionAppVisible = false
    expect(isPageNativeActionActive(page, currentOnlyAction)).toBe(false)
    expect(isPageNativeActionActive(page, lifecycleOnlyAction)).toBe(true)
    app.globalData.nativeActionAppVisible = true
    expect(isPageNativeActionActive(page, currentOnlyAction)).toBe(true)
  })

  test("tracks foreground visibility through the app lifecycle", () => {
    let definition
    global.App = jest.fn((input) => {
      definition = input
    })
    global.wx = {}
    jest.isolateModules(() => require("../app"))
    const app = {
      ...definition,
      globalData: { ...definition.globalData }
    }

    definition.onHide.call(app)
    expect(app.globalData.nativeActionAppVisible).toBe(false)
    definition.onShow.call(app)
    expect(app.globalData.nativeActionAppVisible).toBe(true)
  })
})
