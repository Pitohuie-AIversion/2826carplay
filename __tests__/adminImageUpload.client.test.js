function setup(size = 9) {
  jest.resetModules()
  const calls = []
  const reads = []
  const fs = {
    stat: jest.fn(({ success }) => success({ stats: { size } })),
    readFile: jest.fn((options) => reads.push(options))
  }
  global.wx = {
    getFileSystemManager: () => fs,
    cloud: { callFunction: jest.fn((options) => calls.push(options)), uploadFile: jest.fn() }
  }
  const { uploadAdminImage } = require("../shared/adminImageUpload")
  const success = jest.fn()
  const fail = jest.fn()
  const progress = jest.fn()
  const task = uploadAdminImage({ kind: "vehicle", targetId: "car_1", filePath: "/tmp/photo.jpg", success, fail, onProgress: progress })
  const respond = (index, result) => calls[index].success({ result })
  const begin = (fields = {}) => respond(0, { ok: true, uploadId: "upload_1", chunkSize: 6, chunkCount: Math.ceil(size / 6), ...fields })
  const read = (index) => reads[index].success({ data: Buffer.alloc(reads[index].length, 65).toString("base64") })
  return { calls, reads, fs, task, success, fail, progress, respond, begin, read }
}

describe("管理员图片分块上传客户端", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); delete global.wx })

  test("只有鉴权成功才发送图片字节，逐块读取并在服务端完成后回传文件ID", () => {
    const t = setup()
    expect(t.reads).toHaveLength(0)
    expect(t.calls[0]).toMatchObject({ name: "adminImageUpload", data: { action: "begin", kind: "vehicle", targetId: "car_1", size: 9, extension: "jpg" } })
    t.begin()
    expect(t.reads[0]).toMatchObject({ position: 0, length: 6, encoding: "base64" })
    t.read(0)
    expect(t.calls[1].data).toEqual({ action: "chunk", uploadId: "upload_1", index: 0, data: "QUFBQUFB" })
    t.respond(1, { ok: true, index: 0 })
    expect(t.reads[1]).toMatchObject({ position: 6, length: 3 })
    t.read(1)
    t.respond(2, { ok: true, index: 1 })
    expect(t.calls[3].data).toEqual({ action: "complete", uploadId: "upload_1" })
    expect(t.success).not.toHaveBeenCalled()
    t.respond(3, { ok: true, fileID: "cloud://env/vehicle-images/car_1/verified.jpg" })
    expect(t.success).toHaveBeenCalledWith({ fileID: "cloud://env/vehicle-images/car_1/verified.jpg" })
    expect(wx.cloud.uploadFile).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each([0, -1, 10 * 1024 * 1024 + 1, NaN, "100"])("拒绝本地文件非法大小 %s，绝不退回直接上传", (size) => {
    const t = setup(size)
    expect(t.fail).toHaveBeenCalledTimes(1)
    expect(t.calls).toHaveLength(0)
    expect(wx.cloud.uploadFile).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("普通用户被拒绝后不读取任何文件内容", () => {
    const t = setup()
    t.respond(0, { ok: false, code: "FORBIDDEN", message: "权限不足" })
    expect(t.fail).toHaveBeenCalledWith(expect.objectContaining({ code: "FORBIDDEN", errMsg: "image upload FORBIDDEN" }))
    expect(t.reads).toHaveLength(0)
    expect(t.calls).toHaveLength(1)
  })

  test("取消期间迟到的begin回执清理服务器会话，且不发送图片", () => {
    const t = setup()
    t.task.abort()
    t.begin()
    expect(t.calls[1].data).toEqual({ action: "abort", uploadId: "upload_1" })
    expect(t.reads).toHaveLength(0)
    expect(t.fail).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("begin重复成功回调不会中止已开始的上传或重复读块", () => {
    const t = setup()
    t.begin()
    t.begin()
    expect(t.reads).toHaveLength(1)
    expect(t.calls).toHaveLength(1)
    expect(t.fail).not.toHaveBeenCalled()
  })

  test("非法分块参数不能导致无限读取，并清理会话", () => {
    const t = setup()
    t.begin({ chunkSize: 1024 * 1024 })
    expect(t.fail).toHaveBeenCalledTimes(1)
    expect(t.reads).toHaveLength(0)
    expect(t.calls[1].data.action).toBe("abort")
  })

  test("读取超时取消会话，迟到读取不会上传", () => {
    const t = setup()
    t.begin()
    jest.advanceTimersByTime(20000)
    t.read(0)
    expect(t.calls.map((call) => call.data.action)).toEqual(["begin", "abort"])
    expect(t.fail).toHaveBeenCalledTimes(1)
  })

  test("分块拒绝之后停止后续读取并清理会话", () => {
    const t = setup()
    t.begin()
    t.read(0)
    t.respond(1, { ok: false, code: "FORBIDDEN" })
    expect(t.reads).toHaveLength(1)
    expect(t.calls[2].data.action).toBe("abort")
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each([{}, ["FORBIDDEN"], "FORBIDDEN\nraw", 123, null])("非法错误代码不能伪装成业务拒绝: %j", (code) => {
    const t = setup()
    t.respond(0, { ok: false, code })
    expect(t.fail).toHaveBeenCalledWith(expect.objectContaining({ code: "UPLOAD_FAILED", errMsg: "image upload UPLOAD_FAILED" }))
    expect(t.reads).toHaveLength(0)
  })

  test("阶段推进不虚增字节数，且停止响应的阶段仍然超时", () => {
    const t = setup()
    jest.advanceTimersByTime(12000)
    t.begin()
    expect(t.progress).toHaveBeenLastCalledWith({ loaded: 0, total: 9, phase: "reading" })
    jest.advanceTimersByTime(12000)
    t.read(0)
    expect(t.progress).toHaveBeenLastCalledWith({ loaded: 0, total: 9, phase: "uploading" })
    jest.advanceTimersByTime(12000)
    t.respond(1, { ok: true, index: 0 })
    expect(t.progress).toHaveBeenLastCalledWith({ loaded: 6, total: 9, phase: "reading" })
    jest.advanceTimersByTime(20000)
    expect(t.fail).toHaveBeenCalledTimes(1)
    expect(t.calls.filter((call) => call.data.action === "abort")).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("最终验证期间取消，迟到成品不能回填页面", () => {
    const t = setup(6)
    t.begin()
    t.read(0)
    t.respond(1, { ok: true })
    t.task.abort()
    t.respond(2, { ok: true, fileID: "cloud://env/late.jpg" })
    expect(t.success).not.toHaveBeenCalled()
    expect(t.fail).toHaveBeenCalledTimes(1)
    expect(t.calls[3].data.action).toBe("abort")
    expect(jest.getTimerCount()).toBe(0)
  })

  test("服务端完成耗时允许超过普通块请求时限", () => {
    const t = setup(6)
    t.begin()
    t.read(0)
    t.respond(1, { ok: true })
    jest.advanceTimersByTime(30000)
    expect(t.fail).not.toHaveBeenCalled()
    t.respond(2, { ok: true, fileID: "cloud://env/completed.jpg" })
    expect(t.success).toHaveBeenCalledTimes(1)
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["https://example.invalid/photo.jpg", {}, 123, "", null])("begin缓存成品也必须校验文件ID: %j", (fileID) => {
    const t = setup(6)
    t.begin({ fileID })
    expect(t.success).not.toHaveBeenCalled()
    expect(t.fail).toHaveBeenCalledWith(expect.objectContaining({ errMsg: "image upload invalid file response" }))
    expect(t.reads).toHaveLength(0)
    expect(t.calls[1].data).toEqual({ action: "abort", uploadId: "upload_1" })
    expect(jest.getTimerCount()).toBe(0)
  })

  test("begin返回有效缓存成品时直接完成且不重复读取上传", () => {
    const t = setup(6)
    t.begin({ fileID: "cloud://env/verified.jpg" })
    expect(t.success).toHaveBeenCalledWith({ fileID: "cloud://env/verified.jpg" })
    expect(t.reads).toHaveLength(0)
    expect(t.calls).toHaveLength(1)
    expect(jest.getTimerCount()).toBe(0)
  })
})
