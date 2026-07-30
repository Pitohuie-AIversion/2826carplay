function getErrorMessage(error) {
  if (!error) {
    return ""
  }
  return String(error.errMsg || error.message || error)
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

function saveCsvFile(options) {
  const input = options && typeof options === "object" ? options : {}
  const fileName = ensureCsvFileName(input.fileName, input.fallbackFileName)
  const fs = wx.getFileSystemManager && wx.getFileSystemManager()
  if (!fs) {
    return Promise.reject(new Error("文件系统不可用"))
  }
  const basePath = wx.env && wx.env.USER_DATA_PATH ? wx.env.USER_DATA_PATH : ""
  const filePath = basePath ? `${basePath}/${fileName}` : fileName

  return new Promise((resolve, reject) => {
    fs.writeFile({
      filePath,
      data: String(input.csvText || ""),
      encoding: "utf8",
      success: () => resolve({ filePath, fileName }),
      fail: (error) => reject(error)
    })
  })
}

function removeCsvFile(filePath) {
  const target = String(filePath || "").trim()
  const basePath = wx.env && wx.env.USER_DATA_PATH ? String(wx.env.USER_DATA_PATH) : ""
  const normalizePath = (value) => String(value || "").replace(/\\/g, "/").replace(/\/+$/, "")
  const normalizedTarget = normalizePath(target)
  const normalizedBase = normalizePath(basePath)
  const allowed =
    normalizedBase &&
    normalizedTarget.startsWith(`${normalizedBase}/`) &&
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
  openCsvFile,
  removeCsvFile,
  saveCsvFile,
  shareCsvFile
}
