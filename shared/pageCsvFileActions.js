const { openCsvFile, saveCsvFile } = require("./csvFile")
const { beginPageNativeAction, isPageNativeActionActive } = require("./pageNativeAction")

function closePageCsvPreview(page, options) {
  if (!page) return
  page._csvPreviewSerial = Number(page._csvPreviewSerial || 0) + 1
  if (typeof page._cancelCsvPreviewRead === "function") page._cancelCsvPreviewRead()
  page._cancelCsvPreviewRead = null
  if (page.data) page.data.csvPreview = null
  if (!(options && options.unload) && typeof page.setData === "function") page.setData({ csvPreview: null })
}

function openPageCsvPreview(page, filePath, fileName, pathField) {
  const nativeAction = beginPageNativeAction(page, { requireCurrent: true })
  const field = pathField || "exportFilePath"
  if (!filePath || !isPageNativeActionActive(page, nativeAction) || page.data[field] !== filePath) return Promise.resolve()
  closePageCsvPreview(page)
  const serial = page._csvPreviewSerial
  const isActive = () => serial === page._csvPreviewSerial && page.data[field] === filePath && isPageNativeActionActive(page, nativeAction)
  const name = String(fileName || filePath.split("/").pop() || "CSV 预览")
  page.setData({ csvPreview: { fileName: name, loading: true, rows: [], truncated: false } })
  const read = openCsvFile(filePath)
  page._cancelCsvPreviewRead = () => { if (typeof read.cancel === "function") read.cancel() }
  return read.then((preview) => {
    if (!isActive()) return
    page._cancelCsvPreviewRead = null
    page.setData({ csvPreview: { fileName: name, loading: false, rows: preview && preview.rows || [], truncated: Boolean(preview && preview.truncated) } })
  }).catch(() => {
    if (!isActive()) return
    closePageCsvPreview(page)
    wx.showToast({ title: "文件打开失败", icon: "none" })
  })
}

function activatePageCsvFileActions(page) {
  if (!page || typeof page !== "object") {
    return
  }
  page._csvFileActionsUnloaded = false
  page._removedCsvFileAction = null
  page._csvFileLifecycleSerial = Number(page._csvFileLifecycleSerial || 0) + 1
}

function savePageCsvFile(page, options) {
  const pending = page._pendingCsvWrites || (page._pendingCsvWrites = new Set())
  const write = saveCsvFile(options)
  pending.add(write)
  const release = () => pending.delete(write)
  write.then(release, release)
  return write
}

function cancelPageCsvWrites(page) {
  const pending = page && page._pendingCsvWrites
  if (!pending) return
  page._pendingCsvWrites = null
  for (const write of pending) {
    if (typeof write.cancel === "function") write.cancel()
  }
  pending.clear()
}

function beginPageCsvFileAction(page, filePath, options) {
  if (!page || typeof page !== "object") {
    return null
  }
  return {
    lifecycleSerial: Number(page._csvFileLifecycleSerial || 0),
    nativeAction: beginPageNativeAction(page),
    filePath: String(filePath || ""),
    pathField: options && options.pathField || "exportFilePath",
    clearFields: options && Array.isArray(options.clearFields) ? options.clearFields.slice() : ["exportFileName"]
  }
}

function isPageCsvFileActionActive(page, action) {
  if (!page || !action || page._csvFileActionsUnloaded === true) {
    return false
  }
  const currentFilePath = String((page.data && page.data[action.pathField || "exportFilePath"]) || "")
  return (
    Number(page._csvFileLifecycleSerial || 0) === action.lifecycleSerial &&
    isPageNativeActionActive(page, action.nativeAction) &&
    currentFilePath === action.filePath
  )
}

function cancelPageCsvFileActions(page) {
  if (!page || typeof page !== "object") {
    return
  }
  page._csvFileActionsUnloaded = true
  cancelPageCsvWrites(page)
  closePageCsvPreview(page, { unload: true })
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
    closePageCsvPreview(page)
    const patch = { [action.pathField || "exportFilePath"]: "" }
    ;(action.clearFields || ["exportFileName"]).forEach((field) => { patch[field] = "" })
    page.setData(patch)
  }
}

module.exports = {
  savePageCsvFile,
  cancelPageCsvWrites,
  closePageCsvPreview,
  openPageCsvPreview,
  activatePageCsvFileActions,
  applyPageCsvFileRemoval,
  beginPageCsvFileAction,
  cancelPageCsvFileActions,
  isPageCsvFileActionActive,
  markPageCsvFileRemoved
}
