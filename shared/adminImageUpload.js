const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_CHUNK_BYTES = 192 * 1024
const REQUEST_TIMEOUT_MS = 20000
const COMPLETE_TIMEOUT_MS = 65000
let requestSerial = 0

function createImageUploadRequestId() {
  requestSerial += 1
  return `image_${Date.now().toString(36)}_${requestSerial}_${Math.random().toString(36).slice(2, 10)}`
}

function isValidImageSize(size) {
  return Number.isInteger(size) && size > 0 && size <= MAX_IMAGE_BYTES
}

function getFileExtension(input) {
  return String(input.extension || String(input.filePath || "").split(".").pop()).toLowerCase()
}

function isValidExtension(extension) {
  return ["jpg", "jpeg", "png", "webp"].includes(extension)
}

function isValidSession(begin, size) {
  const uploadId = begin && begin.uploadId
  const chunkSize = begin && begin.chunkSize
  const chunkCount = begin && begin.chunkCount
  return typeof uploadId === "string" && uploadId &&
    Number.isInteger(chunkSize) && chunkSize > 0 && chunkSize <= MAX_CHUNK_BYTES &&
    chunkCount === Math.ceil(size / chunkSize)
}

function isValidLocalFileChunk(read, length) {
  return read && typeof read.data === "string" && read.data.length && read.data.length <= Math.ceil(length / 3) * 4
}

function isValidFileResponse(result) {
  return result && typeof result.fileID === "string" && result.fileID.startsWith("cloud://")
}

function extractErrorCode(result) {
  return result && typeof result.code === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(result.code)
    ? result.code
    : "UPLOAD_FAILED"
}

function isCleanupApplicable(input, failed, result, fileID, cleanupFiles) {
  if (!failed || !result || result.ok !== true || !fileID || cleanupFiles.has(fileID)) return false
  const vehicle = input.kind === "vehicle"
  if ((!vehicle && input.kind !== "handover") || !input.targetId) return false
  return true
}

function createCleanupPayload(input, fileID) {
  const vehicle = input.kind === "vehicle"
  return {
    name: vehicle ? "vehicleImageUpdate" : "bookingHandover",
    data: vehicle
      ? { action: "cleanupUpload", id: input.targetId, fileIds: [fileID] }
      : { action: "cleanupUpload", bookingId: input.targetId, stage: input.stage, fileList: [fileID] }
  }
}

class AdminImageUploadSession {
  constructor(input, fs, cloud) {
    this.input = input
    this.fs = fs
    this.cloud = cloud
    this.requestId = input.requestId || createImageUploadRequestId()
    this.uploadId = ""
    this.settled = false
    this.failed = false
    this.cleanupFiles = new Set()
    this.timer = null
    this.serial = 0
    this.size = 0
    this.chunkSize = 0
    this.chunkCount = 0
  }

  clearTimer() {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
  }

  abortSession(id) {
    if (!id || !this.cloud || typeof this.cloud.callFunction !== "function") return
    try {
      const pending = this.cloud.callFunction({ name: "adminImageUpload", data: { action: "abort", uploadId: id }, fail: () => {} })
      if (pending && typeof pending.catch === "function") pending.catch(() => {})
    } catch (error) { console.error(error) }
  }

  cleanupLateFile(response) {
    const result = response && response.result
    const fileID = result && result.fileID
    if (!isValidFileResponse(result)) return
    if (!isCleanupApplicable(this.input, this.failed, result, fileID, this.cleanupFiles)) return

    this.cleanupFiles.add(fileID)
    try {
      const payload = createCleanupPayload(this.input, fileID)
      payload.fail = () => {}
      const pending = this.cloud.callFunction(payload)
      if (pending && typeof pending.catch === "function") pending.catch(() => {})
    } catch (error) { console.error(error) }
  }

  finish(error, result) {
    if (this.settled) return
    this.settled = true
    this.failed = Boolean(error)
    this.serial += 1
    this.clearTimer()
    if (error) {
      this.abortSession(this.uploadId)
      if (typeof this.input.fail === "function") this.input.fail(error)
    } else if (typeof this.input.success === "function") this.input.success(result)
  }

  fail(error) {
    this.finish(error || { errMsg: "image upload failed" })
  }

  finishFile(result) {
    if (!isValidFileResponse(result)) {
      this.fail({ errMsg: "image upload invalid file response" })
      return
    }
    this.finish(null, { fileID: result.fileID })
  }

  progress(loaded, phase) {
    if (!this.settled && typeof this.input.onProgress === "function") {
      this.input.onProgress({ loaded, total: this.size, phase })
    }
  }

  run(invoke, done, timeout = REQUEST_TIMEOUT_MS, onLate) {
    if (this.settled) return
    const current = ++this.serial
    let called = false
    this.clearTimer()
    const accept = () => {
      if (called) return false
      called = true
      if (this.settled || current !== this.serial) return false
      this.clearTimer()
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
      fail: (error) => { if (accept()) this.fail(error) }
    }
    this.timer = setTimeout(() => callbacks.fail({ errMsg: "image upload request timeout" }), timeout)
    try {
      const pending = invoke(callbacks)
      if (pending && typeof pending.catch === "function") pending.catch(callbacks.fail)
    } catch (error) { callbacks.fail(error) }
  }

  call(data, done, timeout, onLate) {
    this.run(
      (callbacks) => this.cloud.callFunction({ name: "adminImageUpload", data, ...callbacks }),
      (response) => {
        const result = response && response.result
        if (!result || result.ok !== true) {
          const code = extractErrorCode(result)
          this.fail({ code, errMsg: `image upload ${code}`, message: result && result.message })
          return
        }
        done(result)
      }, timeout, onLate
    )
  }

  sendChunk(index) {
    if (this.settled) return
    if (index === this.chunkCount) {
      this.progress(this.size, "verifying")
      this.call({ action: "complete", uploadId: this.uploadId }, (r) => this.finishFile(r), COMPLETE_TIMEOUT_MS, (r) => this.cleanupLateFile(r))
      return
    }
    const position = index * this.chunkSize
    const length = Math.min(this.chunkSize, this.size - position)
    this.progress(position, "reading")
    this.run((callbacks) => this.fs.readFile({ filePath: this.input.filePath, position, length, encoding: "base64", ...callbacks }), (read) => {
      if (!isValidLocalFileChunk(read, length)) {
        this.fail({ errMsg: "image upload invalid local file" })
        return
      }
      this.progress(position, "uploading")
      this.call({ action: "chunk", uploadId: this.uploadId, index, data: read.data }, () => this.sendChunk(index + 1))
    })
  }

  start() {
    const task = { abort: () => this.finish({ errMsg: "image upload cancel" }) }
    if (!this.fs || typeof this.fs.stat !== "function" || typeof this.fs.readFile !== "function" || !this.cloud || typeof this.cloud.callFunction !== "function") {
      this.fail({ errMsg: "image upload capability unavailable" })
      return task
    }
    this.run((callbacks) => this.fs.stat({ path: this.input.filePath, ...callbacks }), (result) => {
      this.size = result && result.stats && result.stats.size
      if (!isValidImageSize(this.size)) {
        this.fail({ errMsg: "image upload invalid size" })
        return
      }
      const extension = getFileExtension(this.input)
      if (!isValidExtension(extension)) {
        this.fail({ errMsg: "image upload invalid file type" })
        return
      }
      this.progress(0, "authorizing")
      this.call({ action: "begin", kind: this.input.kind, targetId: this.input.targetId, ...(this.input.stage ? { stage: this.input.stage } : {}), requestId: this.requestId, size: this.size, extension }, (begin) => {
        this.uploadId = begin.uploadId
        this.chunkSize = begin.chunkSize
        this.chunkCount = begin.chunkCount
        if (!isValidSession(begin, this.size)) {
          this.fail({ errMsg: "image upload invalid session" })
          return
        }
        if (Object.prototype.hasOwnProperty.call(begin, "fileID")) { this.finishFile(begin); return }
        this.sendChunk(0)
      }, REQUEST_TIMEOUT_MS, (late) => {
        const lateId = late && late.result && late.result.uploadId
        if (lateId !== this.uploadId) this.abortSession(lateId)
        this.cleanupLateFile(late)
      })
    })
    return task
  }
}

// All bytes pass through the authenticated cloud function. Never fall back to
// client storage writes: production storage rules deliberately deny those.
function uploadAdminImage(options) {
  const input = options || {}
  const fs = typeof wx !== "undefined" && wx.getFileSystemManager && wx.getFileSystemManager()
  const cloud = typeof wx !== "undefined" && wx.cloud
  const session = new AdminImageUploadSession(input, fs, cloud)
  return session.start()
}

module.exports = { createImageUploadRequestId, uploadAdminImage }
