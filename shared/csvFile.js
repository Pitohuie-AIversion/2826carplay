const CSV_SESSION_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`
let csvSaveSerial = 0
const CSV_PREVIEW_MAX_BYTES = 128 * 1024
const CSV_PREVIEW_MAX_ROWS = 100
const CSV_PREVIEW_MAX_COLUMNS = 30
const CSV_PREVIEW_MAX_CELL_CHARS = 2000

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
    let settled = false
    let writeSuccessHandled = false
    const fail = (error) => {
      if (settled) return
      settled = true
      removeCsvFile(filePath).catch(() => {})
      reject(error)
    }
    const writeOptions = {
      filePath,
      data: String(input.csvText || ""),
      encoding: "utf8",
      success: () => {
        if (writeSuccessHandled) return
        writeSuccessHandled = true
        if (settled) {
          removeCsvFile(filePath).catch(() => {})
          return
        }
        settled = true
        resolve({ filePath, fileName })
      },
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

function parseCsvPreview(text, options) {
  const source = String(text || "").replace(/^\ufeff/, "")
  const partial = Boolean(options && options.partial)
  const rows = []
  let row = [], field = "", quoted = false, touched = false, clipped = false
  let truncated = partial
  const append = (value) => {
    touched = true
    if (field.length < CSV_PREVIEW_MAX_CELL_CHARS) field += value
    else clipped = truncated = true
  }
  const finishField = () => {
    if (row.length < CSV_PREVIEW_MAX_COLUMNS) row.push(field + (clipped ? "…" : ""))
    else truncated = true
    field = ""
    clipped = false
  }
  const finishRow = () => {
    finishField()
    if (rows.length >= CSV_PREVIEW_MAX_ROWS) { truncated = true; return false }
    rows.push(row)
    row = []
    touched = false
    return true
  }
  for (let i = 0; i < source.length; i += 1) {
    const character = source[i]
    if (character === '"') {
      touched = true
      if (quoted && source[i + 1] === '"') { append('"'); i += 1 }
      else if (quoted || !field) quoted = !quoted
      else append(character)
    } else if (character === "," && !quoted) {
      touched = true
      finishField()
    } else if ((character === "\r" || character === "\n") && !quoted) {
      if (!finishRow()) break
      if (character === "\r" && source[i + 1] === "\n") i += 1
    } else append(character)
  }
  if (!partial && quoted) throw new Error("CSV 内容不完整")
  if (!partial && (touched || row.length || field)) finishRow()
  return { rows, truncated }
}

// CSV is not a supported openDocument format. Read a bounded prefix for the in-page viewer.
function openCsvFile(filePath) {
  let cancel = () => {}
  const promise = new Promise((resolve, reject) => {
    let settled = false
    let timer = null
    const finish = (error, value) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      if (error) reject(error)
      else resolve(value)
    }
    cancel = () => finish(null, { rows: [], truncated: false })
    try {
      const base = String(wx.env && wx.env.USER_DATA_PATH || "").replace(/\\/g, "/").replace(/\/+$/, "")
      const target = String(filePath || "").replace(/\\/g, "/")
      if (!base || !target.startsWith(`${base}/`) || !/\.csv$/i.test(target) ||
          target.slice(base.length + 1).split("/").some((part) => part === "." || part === "..")) {
        throw new Error("仅支持预览小程序目录内的 CSV 文件")
      }
      const fs = wx.getFileSystemManager && wx.getFileSystemManager()
      if (!fs || typeof fs.stat !== "function" || typeof fs.readFile !== "function") throw new Error("当前环境不支持文件预览")
      timer = setTimeout(() => finish(new Error("预览读取超时")), 10000)
      fs.stat({
        path: target,
        success: (result) => {
          if (settled) return
          const size = result && result.stats && result.stats.size
          if (!Number.isFinite(size) || size < 0) { finish(new Error("无法读取文件大小")); return }
          if (!size) { finish(null, { rows: [], truncated: false }); return }
          try {
            fs.readFile({
              filePath: target,
              encoding: "utf8",
              position: 0,
              length: Math.min(size, CSV_PREVIEW_MAX_BYTES),
              success: (read) => {
                if (settled) return
                try {
                  const content = String(read && read.data || "")
                  finish(null, parseCsvPreview(content.slice(0, CSV_PREVIEW_MAX_BYTES), {
                    partial: size > CSV_PREVIEW_MAX_BYTES || content.length > CSV_PREVIEW_MAX_BYTES
                  }))
                } catch (error) { finish(error) }
              },
              fail: (error) => finish(error)
            })
          } catch (error) { finish(error) }
        },
        fail: (error) => finish(error)
      })
    } catch (error) { finish(error) }
  })
  promise.cancel = () => cancel()
  return promise
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
  CSV_PREVIEW_MAX_BYTES,
  canShareCsvFile,
  ensureCsvFileName,
  getErrorMessage,
  isUserCancelError,
  openCsvFile,
  parseCsvPreview,
  removeCsvFile,
  saveCsvFile,
  shareCsvFile
}
