// Page controller tests stub the authenticated transport; its real chunk protocol
// is covered separately in adminImageUpload.client.test.js.
jest.mock("../shared/adminImageUpload", () => {
  const actual = jest.requireActual("../shared/adminImageUpload")
  if (global.wx && global.wx.cloud && global.wx.cloud.uploadFile && !global.wx.cloud.callFunction) {
    global.wx.cloud.callFunction = jest.fn()
  }
  return { ...actual, uploadAdminImage: (options) => global.wx.cloud.uploadFile(options) }
})

function setup() {
  jest.resetModules()
  const uploads = []
  const requests = []
  const wxMock = {
    cloud: {
      uploadFile: jest.fn((options) => {
        const abort = jest.fn()
        uploads.push({ ...options, abort })
        return { abort }
      }),
      callFunction: jest.fn((options) => { requests.push(options) }),
      deleteFile: jest.fn()
    },
    showLoading: jest.fn(),
    hideLoading: jest.fn(),
    showToast: jest.fn()
  }
  global.wx = wxMock
  let definition
  global.Page = (input) => { definition = input }
  require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
  const page = {
    ...definition,
    data: { ...definition.data, id: "car_1", loading: false, pageAuthorized: true,
      detail: { imageList: ["cloud://existing"], coverImage: "cloud://existing", imageCount: 1 } }
  }
  page.setData = jest.fn((patch) => { Object.assign(page.data, patch) })
  page.fetchDetail = jest.fn()
  global.getCurrentPages = () => [page]
  return { page, wxMock, uploads, requests }
}

describe("车辆图片与状态写入异步生命周期", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getCurrentPages
  })

  test.each(["business", "network", "timeout", "unavailable"])("全部上传成功后入库 %s 失败仍可重试全部图片", (failure) => {
    const { page, wxMock, uploads, requests } = setup()
    const paths = ["/tmp/one.jpg", "/tmp/two.jpg"]
    page.uploadSelectedFiles(paths, 0)
    uploads[0].success({ fileID: "cloud://one" })
    if (failure === "unavailable") wxMock.cloud.callFunction = undefined
    uploads[1].success({ fileID: "cloud://two" })
    if (failure === "business") requests[0].success({ result: { ok: false, message: "保存失败" } })
    if (failure === "network") requests[0].fail({ errMsg: "network failed" })
    if (failure === "timeout") jest.advanceTimersByTime(15000)
    expect(page.data.uploading).toBe(false)
    expect(page.data.failedUploadPaths).toEqual(paths)
    expect(page.data.uploadItems.map((item) => item.status)).toEqual(["failed", "failed"])
    if (failure === "unavailable") wxMock.cloud.callFunction = jest.fn((options) => requests.push(options))
    page.handleRetryFailedUploads()
    expect(uploads[2].filePath).toBe(paths[0])
  })

  test("上传成功时已切页则暂停后续上传，返回本页才继续", () => {
    const { page, wxMock, uploads, requests } = setup()
    page.uploadSelectedFiles(["/tmp/one.jpg", "/tmp/two.jpg"], 0)
    global.getCurrentPages = () => [page, {}]
    page.setData.mockClear()
    uploads[0].success({ fileID: "cloud://one" })
    expect(page.setData).not.toHaveBeenCalled()
    expect(uploads).toHaveLength(1)
    expect(requests).toHaveLength(0)
    expect(wxMock.showToast).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(uploads).toHaveLength(2)
    expect(page.fetchDetail).not.toHaveBeenCalled()
    uploads[1].success({ fileID: "cloud://two" })
    expect(requests[0].data.fileIds).toEqual(["cloud://one", "cloud://two"])
  })

  test("上传失败时已切页则返回后解锁，并保留失败图片", () => {
    const { page, wxMock, uploads } = setup()
    page.uploadSelectedFiles(["/tmp/one.jpg"], 0)
    global.getCurrentPages = () => [page, {}]
    page.setData.mockClear()
    uploads[0].fail({ errMsg: "permission denied" })
    expect(page.setData).not.toHaveBeenCalled()
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(wxMock.hideLoading).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.uploading).toBe(false)
    expect(page.data.failedUploadPaths).toEqual(["/tmp/one.jpg"])
    expect(wxMock.showToast).toHaveBeenCalledTimes(1)
  })

  test("后台上传超时会终止旧任务，返回后才开始重试", () => {
    const { page, uploads, requests } = setup()
    page.uploadSelectedFiles(["/tmp/one.jpg"], 0)
    global.getCurrentPages = () => [page, {}]
    jest.advanceTimersByTime(20000)
    expect(uploads[0].abort).toHaveBeenCalledTimes(1)
    expect(uploads).toHaveLength(1)
    uploads[0].success({ fileID: "cloud://late" })
    expect(requests[0].data).toEqual({ id: "car_1", action: "cleanupUpload", fileIds: ["cloud://late"] })
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(uploads).toHaveLength(2)
    uploads[1].fail({ errMsg: "permission denied" })
    expect(page.data.uploading).toBe(false)
  })

  test("立即重试使用不同云路径，旧请求迟到结果不会指向新文件", () => {
    const { page, uploads } = setup()
    page.uploadSelectedFiles(["/tmp/one.jpg"], 0)
    uploads[0].fail({ errMsg: "uploadFile:fail network" })
    expect(uploads).toHaveLength(2)
    expect(uploads[1].requestId).not.toBe(uploads[0].requestId)
  })

  test("限额拒绝停止整个批次，用户重试成功后清空失败路径并只关联新文件", () => {
    const { page, uploads, requests } = setup()
    const paths = ["/tmp/one.jpg", "/tmp/two.jpg"]
    page.uploadSelectedFiles(paths, 0)
    uploads[0].fail({ code: "UPLOAD_LIMIT", errMsg: "image upload UPLOAD_LIMIT" })
    expect(uploads).toHaveLength(1)
    expect(page.data.uploading).toBe(false)
    expect(page.data.failedUploadPaths).toEqual(paths)
    page.handleRetryFailedUploads()
    expect(uploads).toHaveLength(2)
    expect(uploads[1].filePath).toBe(paths[0])
    expect(uploads[1].requestId).not.toBe(uploads[0].requestId)
    uploads[1].success({ fileID: "cloud://new-one" })
    expect(uploads[2].filePath).toBe(paths[1])
    uploads[2].success({ fileID: "cloud://new-two" })
    expect(requests[0].data).toEqual({ id: "car_1", action: "add", fileIds: ["cloud://new-one", "cloud://new-two"] })
    requests[0].success({ result: { ok: true, imageList: ["cloud://new-one", "cloud://new-two"], coverImage: "cloud://new-one" } })
    expect(page.data.failedUploadPaths).toEqual([])
    expect(page.data.uploading).toBe(false)
    expect(page.data.uploadProgressText).toBe("图片上传完成")
    expect(jest.getTimerCount()).toBe(0)
  })

  test("结构化撤权不能被附带的network文字误判为可自动重试", () => {
    const { page, uploads } = setup()
    page.uploadSelectedFiles(["/tmp/one.jpg", "/tmp/two.jpg"], 0)
    uploads[0].fail({ code: "FORBIDDEN", errMsg: "network permission denied" })
    expect(uploads).toHaveLength(1)
    expect(page.data.uploading).toBe(false)
    expect(page.data.failedUploadPaths).toEqual(["/tmp/one.jpg", "/tmp/two.jpg"])
    expect(jest.getTimerCount()).toBe(0)
  })

  test("超时终止触发同步失败回调时仍只重试一次", () => {
    const { page, uploads, wxMock } = setup()
    page.uploadSelectedFiles(["/tmp/one.jpg"], 0)
    uploads[0].abort.mockImplementation(() => uploads[0].fail({ errMsg: "uploadFile:fail abort" }))
    jest.advanceTimersByTime(20000)
    expect(uploads).toHaveLength(2)
    expect(wxMock.showToast).not.toHaveBeenCalled()
    jest.advanceTimersByTime(20000)
    expect(uploads[1].abort).toHaveBeenCalledTimes(1)
    expect(uploads).toHaveLength(2)
    expect(page.data.uploading).toBe(false)
    expect(wxMock.showToast).toHaveBeenCalledTimes(1)
  })

  test.each(["success", "business", "network", "timeout"])("图片入库 %s 结果等待返回本页处理", (outcome) => {
    const { page, wxMock, requests } = setup()
    page.persistImageChange({ action: "setCover", fileId: "cloud://new" })
    if (typeof page.onHide === "function") page.onHide()
    global.getCurrentPages = () => [page, {}]
    page.setData.mockClear()
    wxMock.hideLoading.mockClear()
    if (outcome === "success") requests[0].success({ result: { ok: true, imageList: ["cloud://new"], coverImage: "cloud://new" } })
    if (outcome === "business") requests[0].success({ result: { ok: false, message: "保存失败" } })
    if (outcome === "network") requests[0].fail({ errMsg: "network failed" })
    if (outcome === "timeout") jest.advanceTimersByTime(15000)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(wxMock.hideLoading).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page._imageChangePending).toBe(false)
    expect(wxMock.showToast).toHaveBeenCalledTimes(1)
    expect(page.data.detail.coverImage).toBe(outcome === "success" ? "cloud://new" : "cloud://existing")
    expect(page.fetchDetail).not.toHaveBeenCalled()
  })

  test("后台待处理上传成功结果在卸载时清理，且不继续上传", () => {
    const { page, wxMock, uploads, requests } = setup()
    page.uploadSelectedFiles(["/tmp/one.jpg", "/tmp/two.jpg"], 0)
    global.getCurrentPages = () => [page, {}]
    uploads[0].success({ fileID: "cloud://one" })
    page.onUnload()
    expect(uploads).toHaveLength(1)
    expect(requests).toHaveLength(1)
    expect(requests[0].data).toEqual({ id: "car_1", action: "cleanupUpload", fileIds: ["cloud://one"] })
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(wxMock.hideLoading).not.toHaveBeenCalled()
  })

  test("后台待处理入库结果卸载后通过服务端核验清理，不回写页面", () => {
    const { page, wxMock, uploads, requests } = setup()
    page.uploadSelectedFiles(["/tmp/one.jpg"], 0)
    uploads[0].success({ fileID: "cloud://one" })
    global.getCurrentPages = () => [page, {}]
    page.setData.mockClear()
    requests[0].success({ result: { ok: true, imageList: ["cloud://one"], coverImage: "cloud://one" } })
    page.onUnload()
    expect(requests[1].data).toEqual({ id: "car_1", action: "cleanupUpload", fileIds: ["cloud://one"] })
    expect(page._vehicleImageDeferredResult).toBeNull()
    expect(page.setData).not.toHaveBeenCalled()
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })

  test("切页时只关闭自己的图片加载提示，迟到完成和卸载不再关闭其他页提示", () => {
    const { page, wxMock, requests } = setup()
    page.persistImageChange({ action: "remove", fileId: "cloud://existing" })
    expect(typeof page.onHide).toBe("function")
    page.onHide()
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
    global.getCurrentPages = () => [page, {}]
    requests[0].success({ result: { ok: true, imageList: [], coverImage: "" } })
    page.onUnload()
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
    expect(wxMock.showToast).not.toHaveBeenCalled()
  })

  test.each(["success", "business", "conflict", "network", "timeout"])("车辆状态 %s 结果回到本页才显示并按需刷新", (outcome) => {
    const { page, wxMock, requests } = setup()
    page.updateVehicleStatus("car_1", "maintenance", 0)
    page.onHide()
    global.getCurrentPages = () => [page, {}]
    page.setData.mockClear()
    wxMock.hideLoading.mockClear()
    if (outcome === "success") requests[0].success({ result: { ok: true } })
    if (outcome === "business") requests[0].success({ result: { ok: false, message: "更新失败" } })
    if (outcome === "conflict") requests[0].success({ result: { ok: false, code: "VERSION_CONFLICT" } })
    if (outcome === "network") requests[0].fail({ errMsg: "network failed" })
    if (outcome === "timeout") jest.advanceTimersByTime(20000)
    expect(page.setData).not.toHaveBeenCalled()
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(wxMock.hideLoading).not.toHaveBeenCalled()
    expect(page.fetchDetail).not.toHaveBeenCalled()
    expect(page.data.updatingStatus).toBe(true)
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.updatingStatus).toBe(false)
    expect(wxMock.showToast).toHaveBeenCalledTimes(1)
    expect(page.fetchDetail).toHaveBeenCalledTimes(outcome === "success" || outcome === "conflict" ? 1 : 0)
    requests[0].success({ result: { ok: true } })
    expect(wxMock.showToast).toHaveBeenCalledTimes(1)
  })

  test("车辆状态后台成功后卸载会丢弃待处理反馈", () => {
    const { page, wxMock, requests } = setup()
    page.updateVehicleStatus("car_1", "maintenance", 0)
    page.onHide()
    global.getCurrentPages = () => [page, {}]
    page.setData.mockClear()
    requests[0].success({ result: { ok: true } })
    page.onUnload()
    jest.advanceTimersByTime(20000)
    expect(page._vehicleStatusDeferredResult).toBeNull()
    expect(page.setData).not.toHaveBeenCalled()
    expect(page.fetchDetail).not.toHaveBeenCalled()
    expect(wxMock.showToast).not.toHaveBeenCalled()
    expect(wxMock.hideLoading).toHaveBeenCalledTimes(1)
  })
})
