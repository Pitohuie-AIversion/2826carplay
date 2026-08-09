const {
  activatePageCsvFileActions,
  beginPageCsvFileAction,
  cancelPageCsvFileActions,
  isPageCsvFileActionActive
} = require("../shared/pageCsvFileActions")

describe("page CSV file action lifecycle", () => {
  function createPage(filePath = "/user-data/export.csv") {
    return {
      data: { exportFilePath: filePath }
    }
  }

  test("keeps concurrent actions for the current file active", () => {
    const page = createPage()
    const first = beginPageCsvFileAction(page, page.data.exportFilePath)
    const second = beginPageCsvFileAction(page, page.data.exportFilePath)

    expect(isPageCsvFileActionActive(page, first)).toBe(true)
    expect(isPageCsvFileActionActive(page, second)).toBe(true)
  })

  test("invalidates an action when the exported file is replaced", () => {
    const page = createPage("/user-data/old.csv")
    const action = beginPageCsvFileAction(page, page.data.exportFilePath)

    page.data.exportFilePath = "/user-data/new.csv"

    expect(isPageCsvFileActionActive(page, action)).toBe(false)
  })

  test("invalidates pending actions on unload and supports a new page lifecycle", () => {
    const page = createPage()
    const beforeUnload = beginPageCsvFileAction(page, page.data.exportFilePath)

    cancelPageCsvFileActions(page)
    expect(isPageCsvFileActionActive(page, beforeUnload)).toBe(false)

    activatePageCsvFileActions(page)
    const afterLoad = beginPageCsvFileAction(page, page.data.exportFilePath)
    expect(isPageCsvFileActionActive(page, afterLoad)).toBe(true)
  })
})
