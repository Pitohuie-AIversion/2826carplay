function activatePageCsvFileActions(page) {
  if (!page || typeof page !== "object") {
    return
  }
  page._csvFileActionsUnloaded = false
  page._removedCsvFileAction = null
  page._csvFileLifecycleSerial = Number(page._csvFileLifecycleSerial || 0) + 1
}

function beginPageCsvFileAction(page, filePath) {
  if (!page || typeof page !== "object") {
    return null
  }
  return {
    lifecycleSerial: Number(page._csvFileLifecycleSerial || 0),
    filePath: String(filePath || "")
  }
}

function isPageCsvFileActionActive(page, action) {
  if (!page || !action || page._csvFileActionsUnloaded === true) {
    return false
  }
  const currentFilePath = String((page.data && page.data.exportFilePath) || "")
  return (
    Number(page._csvFileLifecycleSerial || 0) === action.lifecycleSerial &&
    currentFilePath === action.filePath
  )
}

function cancelPageCsvFileActions(page) {
  if (!page || typeof page !== "object") {
    return
  }
  page._csvFileActionsUnloaded = true
  page._removedCsvFileAction = null
  page._csvFileLifecycleSerial = Number(page._csvFileLifecycleSerial || 0) + 1
}

function markPageCsvFileRemoved(page, action) {
  if (!isPageCsvFileActionActive(page, action)) {
    return false
  }
  page._removedCsvFileAction = action
  return true
}

function applyPageCsvFileRemoval(page) {
  const action = page && page._removedCsvFileAction
  if (!action) {
    return
  }
  page._removedCsvFileAction = null
  if (isPageCsvFileActionActive(page, action)) {
    page.setData({ exportFilePath: "", exportFileName: "" })
  }
}

module.exports = {
  activatePageCsvFileActions,
  applyPageCsvFileRemoval,
  beginPageCsvFileAction,
  cancelPageCsvFileActions,
  isPageCsvFileActionActive,
  markPageCsvFileRemoved
}
