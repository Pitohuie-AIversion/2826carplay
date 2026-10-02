const CSV_SESSION_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
let csvSaveSerial = 0

function getErrorMessage(error) {
  if (!error) {
    return ""
  }
  return String(error.errMsg || error.message || error)
}

function isUserCancelError(error) {
  return getErrorMessage(error).toLowerCase().includes("cancel")
}

function ensureCsvFileName(name, fallback) {
  const raw = String(name || "").trim()
  const safeFallback = String(fallback || "export.csv").trim() || "export.csv"
  const resolved = raw || safeFallback
  return /\.csv$/i.test(resolved) ? resolved : `${resolved}.csv`
}

function isDevtoolsEnv() {
  try {
    if (!wx || typeof wx.getSystemInfoSync !== "function") {
      return false
    }
    const info = wx.getSystemInfoSync()
    return Boolean(info && info.platform === "devtools")
  } catch (error) {
    return false
  }
}

function canShareCsvFile() {
  return !isDevtoolsEnv() && typeof wx.shareFileMessage === "function"
}

async function saveCsvFile(options) {
  const input = options && typeof options === "object" ? options : {}
  const fileName = ensureCsvFileName(input.fileName, input.fallbackFileName)
  const fs = wx.getFileSystemManager && wx.getFileSystemManager()
  if (!fs || typeof fs.writeFile !== "function") {
    throw new Error("文件系统不可用")
  }
  const basePath = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : ""
  if (!basePath) {
    throw new Error("文件目录不可用")
  }
  // Every write owns its path, so a timed-out export cannot overwrite or remove a retry.
  csvSaveSerial += 1
  const filePath = `${basePath}/csv_${CSV_SESSION_ID}_${csvSaveSerial}.csv`

  return new Promise((resolve, reject) => {
    const fail = (error) => {
      removeCsvFile(filePath).catch(() => {})
      reject(error)
    }
    const writeOptions = {
      filePath,
      data: String(input.csvText || ""),
      encoding: "utf8",
      success: () => resolve({ filePath, fileName }),
      fail
    }
    try {
      fs.writeFile(writeOptions)
    } catch (error) {
      fail(error)
    }
  })
}

async function removeCsvFile(filePath) {
  const target = String(filePath || "").trim()
  const basePath = wx.env && wx.env.USER_DATA_PATH ? String(wx.env.USER_DATA_PATH) : ""
  const normalizePath = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
  const normalizedTarget = normalizePath(target)
  const normalizedBase = normalizePath(basePath)
  const allowed =
    normalizedBase &&
    normalizedTarget.startsWith(`${normalizedBase}/`) &&
    !normalizedTarget.slice(normalizedBase.length + 1).split("/").some((part) => part === "." || part === "..") &&
    /\.csv$/i.test(normalizedTarget)

  if (!allowed) {
    return Promise.reject(new Error("仅允许删除小程序目录内的 CSV 文件"))
  }

  const fs = wx.getFileSystemManager && wx.getFileSystemManager()
  if (!fs || typeof fs.unlink !== "function") {
    return Promise.reject(new Error("文件系统不可用"))
  }

  return new Promise((resolve, reject) => {
    fs.unlink({
      filePath: target,
      success: resolve,
      fail: (error) => {
        const message = getErrorMessage(error).toLowerCase()
        if (message.includes("no such file") || message.includes("not found")) {
          resolve()
          return
        }
        reject(error)
      }
    })
  })
}

function openCsvFile(filePath) {
  return new Promise((resolve, reject) => {
    if (typeof wx.openDocument !== "function") {
      reject(new Error("当前环境不支持打开文件"))
      return
    }
    wx.openDocument({
      filePath,
      fileType: "csv",
      showMenu: true,
      success: resolve,
      fail: reject
    })
  })
}

function shareCsvFile(filePath, fileName) {
  return new Promise((resolve, reject) => {
    if (typeof wx.shareFileMessage !== "function" || isDevtoolsEnv()) {
      reject(new Error("当前环境不支持直接分享"))
      return
    }
    wx.shareFileMessage({
      filePath,
      fileName,
      success: resolve,
      fail: reject
    })
  })
}

module.exports = {
  canShareCsvFile,
  ensureCsvFileName,
  getErrorMessage,
  isUserCancelError,
  openCsvFile,
  removeCsvFile,
  saveCsvFile,
  shareCsvFile
}
