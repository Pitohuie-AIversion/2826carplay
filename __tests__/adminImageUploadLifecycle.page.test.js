// Exercise the real page -> imageSelection -> adminImageUpload chain.
// Only native file APIs and cloud RPC responses are controlled here.
const FILE_ID = "cloud://env/verified.jpg"

function setup(kind, picker = "chooseMedia", paths = ["/tmp/native-photo.jpg"]) {
  jest.resetModules()
  const selections = []
  const stats = []
  const reads = []
  const requests = []
  const fileSystem = {
    stat: jest.fn((input) => stats.push(input)),
    readFile: jest.fn((input) => reads.push(input))
  }
  global.wx = {
    [picker]: jest.fn((input) => selections.push(input)),
    getFileSystemManager: () => fileSystem,
    cloud: { callFunction: jest.fn((input) => requests.push(input)), deleteFile: jest.fn(), uploadFile: jest.fn() },
    showToast: jest.fn(), showLoading: jest.fn(), hideLoading: jest.fn()
  }
  global.getApp = () => ({ globalData: {} })
  let definition
  global.Page = (input) => { definition = input }
  require(kind === "vehicle"
    ? "../pages-admin/vehicle-detail-manage/vehicle-detail-manage"
    : "../pages/booking-manage-detail/booking-manage-detail")
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => {
    for (const [key, value] of Object.entries(patch)) {
      const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".")
      let target = page.data
      for (const part of parts.slice(0, -1)) target = target[part]
      target[parts[parts.length - 1]] = value
    }
  })
  Object.assign(page.data, { id: "target_1", loading: false, pageAuthorized: true })
  if (kind === "vehicle") {
    page.data.detail = { imageList: [], imageCount: 0, coverImage: "" }
    page.fetchDetail = jest.fn()
  } else {
    page.data.booking = { status: "confirmed" }
    page.loadDetail = jest.fn()
  }
  global.getCurrentPages = () => [page]
  if (kind === "vehicle") page.handleUploadImages()
  else page.handleChooseHandoverPhoto({ currentTarget: { dataset: { angle: "front" } } })
  const selected = picker === "chooseMedia"
    ? { tempFiles: paths.map((tempFilePath) => ({ tempFilePath, size: 6, fileType: "image" })) }
    : { tempFilePaths: paths, tempFiles: paths.map((path) => ({ path, size: 6 })) }
  const select = () => selections[0].success(selected)
  const stat = (index = 0) => stats[index].success({ stats: { size: 6 } })
  const rpc = (action) => requests.filter((request) => request.name === "adminImageUpload" && request.data.action === action)
  const begin = (index = 0) => rpc("begin")[index].success({ result: { ok: true, uploadId: `upload_${index + 1}`, chunkSize: 6, chunkCount: 1 } })
  const read = (index = 0) => reads[index].success({ data: "QUFBQUFB" })
  const chunk = (index = 0) => rpc("chunk")[index].success({ result: { ok: true, index: 0 } })
  const complete = (index = 0, fileID = FILE_ID) => rpc("complete")[index].success({ result: { ok: true, fileID } })
  return { page, selections, stats, reads, requests, select, stat, begin, read, chunk, complete, rpc }
}

describe.each(["vehicle", "handover"])("%s real image transport lifecycle", (kind) => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.wx
    delete global.Page
    delete global.getApp
    delete global.getCurrentPages
  })

  test.each(["chooseMedia", "chooseImage"])("%s selection travels through stat/read/chunk/complete exactly once", (picker) => {
    const t = setup(kind, picker)
    t.select()
    expect(t.stats[0].path).toBe("/tmp/native-photo.jpg")
    t.stat()
    expect(t.rpc("begin")[0].data).toMatchObject({ kind, targetId: "target_1", size: 6, extension: "jpg" })
    if (kind === "handover") expect(t.rpc("begin")[0].data.stage).toBe("pickup")
    t.begin(); t.read(); t.chunk(); t.complete(); t.complete()
    if (kind === "vehicle") {
      const updates = t.requests.filter((request) => request.name === "vehicleImageUpdate")
      expect(updates).toHaveLength(1)
      expect(updates[0].data).toMatchObject({ id: "target_1", action: "add", fileIds: [FILE_ID] })
      updates[0].success({ result: { ok: true, imageList: [FILE_ID], coverImage: FILE_ID } })
      expect(t.page.data.uploading).toBe(false)
    } else {
      expect(t.page.data.handoverForm.photos[0]).toMatchObject({ fileId: FILE_ID, url: "/tmp/native-photo.jpg" })
      expect(t.page.data.handoverLoading).toBe(false)
      expect(t.requests.filter((request) => request.name === "bookingHandover")).toHaveLength(0)
    }
    expect(wx.cloud.uploadFile).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("slow but advancing requests do not trigger the page's idle timeout", () => {
    const t = setup(kind)
    t.select(); t.stat()
    jest.advanceTimersByTime(12000)
    t.begin()
    jest.advanceTimersByTime(12000)
    t.read()
    jest.advanceTimersByTime(12000)
    expect(t.rpc("abort")).toHaveLength(0)
    expect(t.rpc("chunk")).toHaveLength(1)
    t.chunk()
    jest.advanceTimersByTime(30000)
    t.complete()
    if (kind === "vehicle") {
      const update = t.requests.find((request) => request.name === "vehicleImageUpdate")
      expect(update.data.fileIds).toEqual([FILE_ID])
      update.success({ result: { ok: true, imageList: [FILE_ID], coverImage: FILE_ID } })
      expect(t.page.data.uploading).toBe(false)
    } else {
      expect(t.page.data.handoverForm.photos[0].fileId).toBe(FILE_ID)
      expect(t.page.data.handoverLoading).toBe(false)
    }
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["stat", "begin", "read", "complete"])("unloading during %s stops the real task and ignores its late callback", (phase) => {
    const t = setup(kind)
    t.select()
    if (phase !== "stat") t.stat()
    if (["read", "complete"].includes(phase)) t.begin()
    if (phase === "complete") { t.read(); t.chunk() }
    t.page.onUnload()
    t.page.setData.mockClear()
    wx.showToast.mockClear()
    if (phase === "stat") t.stat()
    if (phase === "begin") t.begin()
    if (phase === "read") t.read()
    if (phase === "complete") t.complete()
    expect(t.page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(t.rpc("begin")).toHaveLength(phase === "stat" ? 0 : 1)
    expect(t.rpc("chunk")).toHaveLength(phase === "complete" ? 1 : 0)
    expect(t.rpc("abort")).toHaveLength(phase === "stat" ? 0 : 1)
    if (phase === "complete") {
      const cleanup = t.requests.find((request) => request.data.action === "cleanupUpload")
      expect(cleanup).toMatchObject({ name: kind === "vehicle" ? "vehicleImageUpdate" : "bookingHandover" })
      expect(cleanup.data).toEqual(kind === "vehicle"
        ? { id: "target_1", action: "cleanupUpload", fileIds: [FILE_ID] }
        : { bookingId: "target_1", stage: "pickup", action: "cleanupUpload", fileList: [FILE_ID] })
    }
    expect(jest.getTimerCount()).toBe(0)
  })

  test("a background completion never writes or shows UI; vehicle resumes and handover discards safely", () => {
    const t = setup(kind)
    t.select(); t.stat(); t.begin(); t.read(); t.chunk()
    t.page.onHide()
    global.getCurrentPages = () => [t.page, {}]
    t.page.setData.mockClear()
    t.complete()
    expect(t.page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    if (kind === "vehicle") {
      expect(t.requests.filter((request) => request.name === "vehicleImageUpdate")).toHaveLength(0)
      global.getCurrentPages = () => [t.page]
      t.page.onShow()
      const update = t.requests.find((request) => request.name === "vehicleImageUpdate")
      expect(update.data.fileIds).toEqual([FILE_ID])
      update.success({ result: { ok: true, imageList: [FILE_ID], coverImage: FILE_ID } })
    } else {
      const cleanup = t.requests.find((request) => request.name === "bookingHandover")
      expect(cleanup.data).toEqual({ action: "cleanupUpload", bookingId: "target_1", stage: "pickup", fileList: [FILE_ID] })
      global.getCurrentPages = () => [t.page]
      t.page.onShow()
      expect(t.page.data.handoverLoading).toBe(false)
      expect(t.page.data.handoverForm.photos[0].fileId).toBe("")
    }
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["chooseMedia", "chooseImage"])("%s success followed by duplicate success/failure cannot create or detach another task", (picker) => {
    const t = setup(kind, picker)
    t.select()
    t.select()
    t.selections[0].fail({ errMsg: `${picker}:fail cancel` })
    expect(t.stats).toHaveLength(1)
    expect(kind === "vehicle" ? t.page.data.uploading : t.page.data.handoverLoading).toBe(true)
    t.page.onUnload()
    t.stat()
    expect(t.rpc("begin")).toHaveLength(0)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("a cancelled selector ignores a later success", () => {
    const t = setup(kind)
    t.selections[0].fail({ errMsg: "chooseMedia:fail cancel" })
    t.select()
    expect(t.stats).toHaveLength(0)
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  if (kind === "vehicle") {
    test("a timed-out completion cannot associate its late file with the automatic retry", () => {
      const t = setup(kind)
      t.select(); t.stat(); t.begin(); t.read(); t.chunk()
      jest.advanceTimersByTime(65000)
      expect(t.stats).toHaveLength(2)
      expect(t.rpc("abort")).toHaveLength(1)
      t.page.setData.mockClear()
      t.complete(0, "cloud://env/old-attempt.jpg")
      expect(t.page.setData).not.toHaveBeenCalled()
      expect(t.page.data.uploading).toBe(true)

      t.stat(1); t.begin(1); t.read(1); t.chunk(1); t.complete(1, "cloud://env/retry.jpg")
      const updates = t.requests.filter((request) => request.name === "vehicleImageUpdate")
      expect(updates).toHaveLength(2)
      expect(updates[0].data).toEqual({ action: "cleanupUpload", id: "target_1", fileIds: ["cloud://env/old-attempt.jpg"] })
      expect(updates[1].data).toEqual({ action: "add", id: "target_1", fileIds: ["cloud://env/retry.jpg"] })
      updates[1].success({ result: { ok: true, imageList: ["cloud://env/retry.jpg"], coverImage: "cloud://env/retry.jpg" } })
      expect(t.page.data.uploading).toBe(false)
      expect(t.page.data.failedUploadPaths).toEqual([])
      expect(t.page.data.detail.imageList).toEqual(["cloud://env/retry.jpg"])
      expect(jest.getTimerCount()).toBe(0)
    })

    test.each(["cancel", "unload"])("%s during server completion queues the late unassociated file for cleanup", (exit) => {
      const t = setup(kind)
      t.select(); t.stat(); t.begin(); t.read(); t.chunk()
      wx.cloud.callFunction.mockImplementation((request) => {
        t.requests.push(request)
        return Promise.resolve({ result: request.data.action === "abort"
          ? { ok: false, code: "UPLOAD_BUSY" }
          : { ok: true } })
      })
      if (exit === "cancel") t.page.handleCancelUpload()
      else t.page.onUnload()
      expect(t.rpc("abort")).toHaveLength(1)
      t.page.setData.mockClear()
      wx.showToast.mockClear()

      t.complete()

      const updates = t.requests.filter((request) => request.name === "vehicleImageUpdate")
      expect(updates).toHaveLength(1)
      expect(updates[0].data).toEqual({ id: "target_1", action: "cleanupUpload", fileIds: [FILE_ID] })
      expect(t.page.setData).not.toHaveBeenCalled()
      expect(wx.showToast).not.toHaveBeenCalled()
      if (exit === "cancel") {
        expect(t.page.data.failedUploadPaths).toEqual(["/tmp/native-photo.jpg"])
        expect(t.page.data.uploading).toBe(false)
      }
      expect(jest.getTimerCount()).toBe(0)
    })

    test.each([
      ["UPLOAD_LIMIT", "上传数量或频次已达限"],
      ["FORBIDDEN", "无图片上传权限"],
      ["STATUS_NOT_ALLOWED", "车辆状态不允许上传"],
      ["NOT_FOUND", "上传目标不存在"]
    ])("%s stops the remaining batch and preserves all retry paths", (code, title) => {
      const paths = ["/tmp/one.jpg", "/tmp/two.jpg", "/tmp/three.jpg"]
      const t = setup(kind, "chooseMedia", paths)
      t.select(); t.stat()
      t.rpc("begin")[0].success({ result: { ok: false, code, message: "business rejection" } })
      expect(t.stats).toHaveLength(1)
      expect(t.reads).toHaveLength(0)
      expect(t.rpc("begin")).toHaveLength(1)
      expect(t.page.data.uploading).toBe(false)
      expect(t.page.data.failedUploadPaths).toEqual(paths)
      expect(t.page.data.uploadItems.map((item) => item.status)).toEqual(["failed", "failed", "failed"])
      expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title }))
      expect(jest.getTimerCount()).toBe(0)
    })

    test("a background quota rejection ends the batch only when the page returns and is delivered once", () => {
      const paths = ["/tmp/one.jpg", "/tmp/two.jpg"]
      const t = setup(kind, "chooseMedia", paths)
      t.select(); t.stat()
      t.page.onHide()
      global.getCurrentPages = () => [t.page, {}]
      t.page.setData.mockClear()
      t.rpc("begin")[0].success({ result: { ok: false, code: "UPLOAD_LIMIT" } })
      expect(t.page.setData).not.toHaveBeenCalled()
      expect(wx.showToast).not.toHaveBeenCalled()
      global.getCurrentPages = () => [t.page]
      t.page.onShow(); t.page.onShow()
      expect(t.stats).toHaveLength(1)
      expect(t.page.data.failedUploadPaths).toEqual(paths)
      expect(t.page.data.uploading).toBe(false)
      expect(wx.showToast).toHaveBeenCalledTimes(1)
      expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "上传数量或频次已达限" }))
      expect(jest.getTimerCount()).toBe(0)
    })

    test("quota after one uploaded image preserves the successful association and the blocking reason", () => {
      const paths = ["/tmp/one.jpg", "/tmp/two.jpg", "/tmp/three.jpg"]
      const t = setup(kind, "chooseMedia", paths)
      t.select(); t.stat(); t.begin(); t.read(); t.chunk(); t.complete()
      t.stat(1)
      t.rpc("begin")[1].success({ result: { ok: false, code: "UPLOAD_LIMIT" } })
      expect(t.stats).toHaveLength(2)
      const update = t.requests.find((request) => request.name === "vehicleImageUpdate" && request.data.action === "add")
      expect(update.data.fileIds).toEqual([FILE_ID])
      update.success({ result: { ok: true, imageList: [FILE_ID], coverImage: FILE_ID } })
      expect(t.page.data.failedUploadPaths).toEqual(paths.slice(1))
      expect(t.page.data.uploading).toBe(false)
      expect(t.page.data.uploadProgressText).toContain("上传数量或频次已达限")
      expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "上传数量或频次已达限" }))
      expect(jest.getTimerCount()).toBe(0)
    })

    test("revoked permission during a chunk cancels the session without trying the next image", () => {
      const paths = ["/tmp/one.jpg", "/tmp/two.jpg"]
      const t = setup(kind, "chooseMedia", paths)
      t.select(); t.stat(); t.begin(); t.read()
      t.rpc("chunk")[0].success({ result: { ok: false, code: "FORBIDDEN" } })
      expect(t.rpc("abort")).toHaveLength(1)
      expect(t.stats).toHaveLength(1)
      expect(t.page.data.failedUploadPaths).toEqual(paths)
      expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "无图片上传权限" }))
      expect(jest.getTimerCount()).toBe(0)
    })

    test.each(["stat", "begin", "read", "complete"])("the cancel button stops %s without waiting for native callbacks", (phase) => {
      const t = setup(kind)
      t.select()
      if (phase !== "stat") t.stat()
      if (["read", "complete"].includes(phase)) t.begin()
      if (phase === "complete") { t.read(); t.chunk() }
      t.page.handleCancelUpload()
      expect(t.page.data.uploading).toBe(false)
      expect(t.page.data.failedUploadPaths).toEqual(["/tmp/native-photo.jpg"])
      if (phase === "stat") t.stat()
      if (phase === "begin") t.begin()
      if (phase === "read") t.read()
      if (phase === "complete") t.complete()
      expect(t.rpc("begin")).toHaveLength(phase === "stat" ? 0 : 1)
      expect(t.rpc("abort")).toHaveLength(phase === "stat" ? 0 : 1)
      expect(t.requests.filter((request) => request.name === "vehicleImageUpdate" && request.data.action === "add")).toHaveLength(0)
      expect(t.requests.filter((request) => request.name === "vehicleImageUpdate" && request.data.action === "cleanupUpload")).toHaveLength(phase === "complete" ? 1 : 0)
      expect(wx.showToast).toHaveBeenCalledTimes(1)
      expect(jest.getTimerCount()).toBe(0)
    })
  }

  if (kind === "handover") {
    test.each([
      ["UPLOAD_LIMIT", "上传数量或频次已达限"],
      ["FORBIDDEN", "无图片上传权限"],
      ["STATUS_NOT_ALLOWED", "预约状态不允许上传"],
      ["PICKUP_NOT_CONFIRMED", "请先核对取车记录"]
    ])("%s gives an actionable rejection without clearing the previous photo", (code, title) => {
      const t = setup(kind)
      t.page.data.handoverForm.photos[0].fileId = "cloud://env/previous.jpg"
      t.page.data.handoverForm.mileageKm = "123"
      t.select(); t.stat()
      t.rpc("begin")[0].success({ result: { ok: false, code, message: "business rejection" } })
      expect(t.page.data.handoverLoading).toBe(false)
      expect(t.page.data.handoverForm.photos[0].fileId).toBe("cloud://env/previous.jpg")
      expect(t.page.data.handoverForm.mileageKm).toBe("123")
      expect(t.rpc("begin")).toHaveLength(1)
      expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title }))
      expect(jest.getTimerCount()).toBe(0)
    })

    test("background rejection waits for return and is shown exactly once", () => {
      const t = setup(kind)
      t.select(); t.stat()
      t.page.onHide()
      global.getCurrentPages = () => [t.page, {}]
      t.page.setData.mockClear()
      t.rpc("begin")[0].success({ result: { ok: false, code: "FORBIDDEN" } })
      expect(t.page.setData).not.toHaveBeenCalled()
      expect(wx.showToast).not.toHaveBeenCalled()
      global.getCurrentPages = () => [t.page]
      t.page.onShow(); t.page.onShow()
      expect(t.page.data.handoverLoading).toBe(false)
      expect(wx.showToast).toHaveBeenCalledTimes(1)
      expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "无图片上传权限" }))
      expect(jest.getTimerCount()).toBe(0)
    })

    test.each(["unload", "booking", "stage"])("background upload feedback is discarded after %s", (change) => {
      const t = setup(kind)
      t.select(); t.stat()
      global.getCurrentPages = () => [t.page, {}]
      t.rpc("begin")[0].success({ result: { ok: false, code: "FORBIDDEN" } })
      if (change === "unload") t.page.onUnload()
      if (change === "booking") t.page.data.id = "target_2"
      if (change === "stage") t.page.data.handoverStage = "return"
      global.getCurrentPages = () => [t.page]
      if (change !== "unload") t.page.onShow()
      expect(wx.showToast).not.toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
    })
  }
})
