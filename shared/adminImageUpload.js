const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_CHUNK_BYTES = 192 * 1024
const REQUEST_TIMEOUT_MS = 20000
const COMPLETE_TIMEOUT_MS = 65000
let requestSerial = 0

function createImageUploadRequestId() {
  requestSerial += 1
  return `image_${Date.now().toString(36)}_${requestSerial}_${Math.random().toString(36).slice(2, 10)}`
}

// All bytes pass through the authenticated cloud function. Never fall back to
// client storage writes: production storage rules deliberately deny those.
function uploadAdminImage(options) {
  const input = options || {}
  const fs = typeof wx !== "undefined" && wx.getFileSystemManager && wx.getFileSystemManager()
  const cloud = typeof wx !== "undefined" && wx.cloud
  const requestId = input.requestId || createImageUploadRequestId()
  let uploadId = ""
  let settled = false
  let failed = false
  const cleanupFiles = new Set()
  let timer = null
  let serial = 0
  let size = 0
  let chunkSize = 0
  let chunkCount = 0

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer)
    timer = null
  }
  const abortSession = (id) => {
    if (!id || !cloud || typeof cloud.callFunction !== "function") return
    try {
      const pending = cloud.callFunction({ name: "adminImageUpload", data: { action: "abort", uploadId: id }, fail: () => {} })
      if (pending && typeof pending.catch === "function") pending.catch(() => {})
    } catch (error) {}
  }
  const cleanupLateFile = (response) => {
    const result = response && response.result
    const fileID = result && result.fileID
    if (!failed || !result || result.ok !== true || typeof fileID !== "string" ||
        !fileID.startsWith("cloud://") || cleanupFiles.has(fileID)) return
    const vehicle = input.kind === "vehicle"
    if ((!vehicle && input.kind !== "handover") || !input.targetId) return
    cleanupFiles.add(fileID)
    // Abort can be refused while complete holds its server lease. A late file
    // still needs reference-aware cleanup, without restoring the cancelled UI.
    try {
      const pending = cloud.callFunction({
        name: vehicle ? "vehicleImageUpdate" : "bookingHandover",
        data: vehicle
          ? { action: "cleanupUpload", id: input.targetId, fileIds: [fileID] }
          : { action: "cleanupUpload", bookingId: input.targetId, stage: input.stage, fileList: [fileID] },
        fail: () => {}
      })
      if (pending && typeof pending.catch === "function") pending.catch(() => {})
    } catch (error) {}
  }
  const finish = (error, result) => {
    if (settled) return
    settled = true
    failed = Boolean(error)
    serial += 1
    clearTimer()
    if (error) {
      abortSession(uploadId)
      if (typeof input.fail === "function") input.fail(error)
    } else if (typeof input.success === "function") input.success(result)
  }
  const fail = (error) => finish(error || { errMsg: "image upload failed" })
  const finishFile = (result) => {
    if (!result || typeof result.fileID !== "string" || !result.fileID.startsWith("cloud://")) {
      fail({ errMsg: "image upload invalid file response" })
      return
    }
    finish(null, { fileID: result.fileID })
  }
  const progress = (loaded, phase) => {
    if (!settled && typeof input.onProgress === "function") {
      input.onProgress({ loaded, total: size, phase })
    }
  }
  const run = (invoke, done, timeout = REQUEST_TIMEOUT_MS, onLate) => {
    if (settled) return
    const current = ++serial
    let called = false
    clearTimer()
    const accept = () => {
      if (called) return false
      called = true
      if (settled || current !== serial) return false
      clearTimer()
      return true
    }
    const callbacks = {
      success: (result) => {
        if (!accept()) {
          if (typeof onLate === "function") onLate(result)
          return
        }
        done(result)
      },
      fail: (error) => { if (accept()) fail(error) }
    }
    timer = setTimeout(() => callbacks.fail({ errMsg: "image upload request timeout" }), timeout)
    try {
      const pending = invoke(callbacks)
      if (pending && typeof pending.catch === "function") pending.catch(callbacks.fail)
    } catch (error) { callbacks.fail(error) }
  }
  const call = (data, done, timeout, onLate) => run(
    (callbacks) => cloud.callFunction({ name: "adminImageUpload", data, ...callbacks }),
    (response) => {
      const result = response && response.result
      if (!result || result.ok !== true) {
        const code = result && typeof result.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(result.code)
          ? result.code : "UPLOAD_FAILED"
        fail({ code, errMsg: `image upload ${code}`, message: result && result.message })
        return
      }
      done(result)
    }, timeout, onLate
  )
  const sendChunk = (index) => {
    if (settled) return
    if (index === chunkCount) {
      progress(size, "verifying")
      call({ action: "complete", uploadId }, finishFile, COMPLETE_TIMEOUT_MS, cleanupLateFile)
      return
    }
    const position = index * chunkSize
    const length = Math.min(chunkSize, size - position)
    // Renew the page's idle watchdog for each completed stage. Reading a local
    // chunk and sending it are separate timed operations; only acknowledged
    // bytes count toward progress.
    progress(position, "reading")
    run((callbacks) => fs.readFile({ filePath: input.filePath, position, length, encoding: "base64", ...callbacks }), (read) => {
      if (!read || typeof read.data !== "string" || !read.data.length || read.data.length > Math.ceil(length / 3) * 4) {
        fail({ errMsg: "image upload invalid local file" })
        return
      }
      progress(position, "uploading")
      call({ action: "chunk", uploadId, index, data: read.data }, () => sendChunk(index + 1))
    })
  }
  const task = { abort() { finish({ errMsg: "image upload cancel" }) } }
  if (!fs || typeof fs.stat !== "function" || typeof fs.readFile !== "function" || !cloud || typeof cloud.callFunction !== "function") {
    fail({ errMsg: "image upload capability unavailable" })
    return task
  }
  run((callbacks) => fs.stat({ path: input.filePath, ...callbacks }), (result) => {
    size = result && result.stats && result.stats.size
    if (!Number.isInteger(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
      fail({ errMsg: "image upload invalid size" })
      return
    }
    const extension = String(input.extension || String(input.filePath || "").split(".").pop()).toLowerCase()
    if (!["jpg", "jpeg", "png", "webp"].includes(extension)) {
      fail({ errMsg: "image upload invalid file type" })
      return
    }
    progress(0, "authorizing")
    call({ action: "begin", kind: input.kind, targetId: input.targetId, ...(input.stage ? { stage: input.stage } : {}), requestId, size, extension }, (begin) => {
      uploadId = begin.uploadId
      chunkSize = begin.chunkSize
      chunkCount = begin.chunkCount
      if (typeof uploadId !== "string" || !uploadId || !Number.isInteger(chunkSize) || chunkSize <= 0 || chunkSize > MAX_CHUNK_BYTES || chunkCount !== Math.ceil(size / chunkSize)) {
        fail({ errMsg: "image upload invalid session" })
        return
      }
      if (Object.prototype.hasOwnProperty.call(begin, "fileID")) { finishFile(begin); return }
      sendChunk(0)
    }, REQUEST_TIMEOUT_MS, (late) => {
      const lateId = late && late.result && late.result.uploadId
      if (lateId !== uploadId) abortSession(lateId)
      cleanupLateFile(late)
    })
  })
  return task
}

module.exports = { createImageUploadRequestId, uploadAdminImage }
