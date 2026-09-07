const fs = require("fs")
const path = require("path")

function loadVehicleDetailDefinition(wxMock) {
  let definition = null
  global.Page = jest.fn((input) => {
    definition = input
  })
  global.wx = wxMock
  jest.resetModules()
  require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
  return definition
}

function createVehicleDetailPage(definition, overrides = {}) {
  const page = {
    ...definition,
    data: {
      ...definition.data,
      loading: false,
      ...overrides
    }
  }
  page.setData = jest.fn((patch) => {
    page.data = { ...page.data, ...patch }
  })
  return page
}

describe("pages/vehicle-detail-manage 车辆详情管理视觉", () => {
  const pageDir = path.resolve(__dirname, "../pages-admin/vehicle-detail-manage")
  const wxmlSource = fs.readFileSync(path.join(pageDir, "vehicle-detail-manage.wxml"), "utf8")
  const wxssSource = fs.readFileSync(path.join(pageDir, "vehicle-detail-manage.wxss"), "utf8")

  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.wx
  })

  test("档案状态、基础资料与管理信息使用清晰分组和可见性提示", () => {
    expect(wxmlSource).toContain("detail-section-glyph-status")
    expect(wxmlSource).toContain("detail-section-glyph-profile")
    expect(wxmlSource).toContain("detail-section-glyph-admin")
    expect(wxmlSource).toContain("visibility-chip-public")
    expect(wxmlSource).toContain("visibility-chip-private")
    expect(wxmlSource).toContain("danger-zone")
    expect(wxmlSource).toContain("retire-native-icon")
    expect(wxssSource).toContain(".detail-section-glyph-status .detail-section-glyph-icon")
  })

  test("图片和底部操作使用对应原生图标与吸底行动栏", () => {
    expect(wxmlSource).toContain("detail-section-glyph-images")
    expect(wxmlSource).toContain("upload-native-icon")
    expect(wxmlSource).toContain("cover-native-icon")
    expect(wxmlSource).toContain("trash-native-icon")
    expect(wxmlSource).toContain("empty-image-icon")
    expect(wxmlSource).toContain("back-native-icon")
    expect(wxmlSource).toContain("edit-native-icon")
    expect(wxmlSource).toContain("detail-action-dock")
    expect(wxmlSource).toContain('hover-class="vehicle-image-pressed"')
    expect(wxmlSource).toContain('aria-label="预览第 {{index + 1}} 张车辆图片"')
    expect(wxmlSource).not.toContain(">✓<")
    expect(wxssSource).toMatch(/\.detail-action-dock\s*\{[\s\S]*?position:\s*sticky/)
    expect(wxssSource).toContain(".vehicle-image-pressed")
    expect(wxmlSource).toContain('aria-pressed="{{detail.status === op.value}}"')
    expect(wxmlSource).toContain("status-op-btn-pressed")
    expect(wxmlSource).toContain("vehicle-detail-button-pressed")
    expect(wxmlSource).toContain('disabled="{{loading || updatingStatus || uploading}}"')
    expect(wxmlSource).toContain(
      "{{loading || updatingStatus || uploading ? 'none' : 'vehicle-detail-button-pressed'}}"
    )
    expect(wxssSource).toContain(".status-op-btn-pressed")
    expect(wxssSource).toContain(".vehicle-detail-button-pressed")
    expect(wxmlSource).toContain('binderror="handleManagedImageError"')
    expect(wxmlSource).toContain("vehicle-image-fallback")
    expect(wxmlSource).toContain("vehicle-image-fallback-emblem")
    expect(wxmlSource).toContain("vehicle-image-fallback-ring")
    expect(wxmlSource).toContain("文件异常")
    expect(wxssSource).toContain(".vehicle-image-fallback")
    expect(wxssSource).toContain(".vehicle-image-fallback-emblem")
    expect(wxssSource).toContain(".mini-placeholder-warning")
  })

  test("部分图片被跳过时使用无勾的长提示", () => {
    const jsSource = fs.readFileSync(path.join(pageDir, "vehicle-detail-manage.js"), "utf8")

    expect(jsSource).toContain('const partialUpload = actionPayload.action === "add" && Number(skippedCount) > 0')
    expect(jsSource).toContain("`已上传，跳过 ${skippedCount} 张`")
    expect(jsSource).toContain('icon: partialUpload ? "none" : "success"')
    expect(jsSource).toContain("duration: partialUpload ? 2200 : 1500")
  })

  test("图片加载失败时保留记录并标记异常", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {}
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        detail: {
          imageItems: [{ fileId: "cloud://missing-image", imageFailed: false }]
        }
      }
    }
    page.setData = jest.fn((patch) => {
      Object.assign(page.data, patch)
    })

    page.handleManagedImageError({
      currentTarget: { dataset: { fileId: "cloud://missing-image" } }
    })

    expect(page.data.detail.imageItems[0].imageFailed).toBe(true)
  })

  test("选择图片时跳过超过 10MB 或不支持格式的文件", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      chooseImage: jest.fn(({ success }) => {
        success({
          tempFiles: [
            { path: "/tmp/vehicle.jpg", size: 1024 },
            { path: "/tmp/oversize.png", size: 10 * 1024 * 1024 + 1 },
            { path: "/tmp/animated.gif", size: 2048 }
          ]
        })
      }),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        detail: { imageCount: 0 },
        loading: false,
        uploading: false
      },
      uploadSelectedFiles: jest.fn()
    }

    page.handleUploadImages()

    expect(page.uploadSelectedFiles).toHaveBeenCalledWith(["/tmp/vehicle.jpg"], 2)
    delete global.Page
    delete global.wx
  })

  test.each([
    [0, 9],
    [1, 8],
    [5, 4],
    [8, 1]
  ])("单次可选择剩余图片名额（已有 %i 张时可选 %i 张）", (imageCount, expectedCount) => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      chooseImage: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        detail: { imageCount },
        loading: false,
        uploading: false
      }
    }

    page.handleUploadImages()

    expect(global.wx.chooseImage).toHaveBeenCalledWith(
      expect.objectContaining({ count: expectedCount })
    )
    delete global.Page
    delete global.wx
  })

  test("已有 9 张图片时阻止继续选择", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      chooseImage: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        detail: { imageCount: 9 },
        loading: false,
        uploading: false
      }
    }

    page.handleUploadImages()

    expect(global.wx.chooseImage).not.toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "最多上传 9 张图片",
      icon: "none"
    })
    delete global.Page
    delete global.wx
  })

  test("全部图片不合规时在上传前给出明确提示", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      chooseImage: jest.fn(({ success }) => {
        success({
          tempFiles: [{ path: "/tmp/vehicle.gif", size: 1024 }]
        })
      }),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        detail: { imageCount: 0 },
        loading: false,
        uploading: false
      },
      uploadSelectedFiles: jest.fn()
    }

    page.handleUploadImages()

    expect(page.uploadSelectedFiles).not.toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "仅支持10MB内图片",
      icon: "none"
    })
    delete global.Page
    delete global.wx
  })

  test("取消选择图片保持静默，真实失败时提示重试", () => {
    let definition = null
    let selectionError = { errMsg: "chooseImage:fail cancel" }
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      chooseImage: jest.fn(({ fail }) => fail(selectionError)),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        detail: { imageCount: 0 },
        loading: false,
        uploading: false
      }
    }

    page.handleUploadImages()
    expect(global.wx.showToast).not.toHaveBeenCalled()

    selectionError = { errMsg: "chooseImage:fail permission denied" }
    page.handleUploadImages()
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "选择图片失败，请重试",
      icon: "none"
    })
  })

  test("图片入库失败时请求服务端清理并进入队列兜底路径", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    const callFunction = jest.fn((options) => {
      if (options.data.action === "add") {
        options.fail({ errMsg: "database unavailable" })
      }
    })
    global.wx = {
      cloud: {
        callFunction,
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1",
        uploading: true
      }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })
    const fileIds = ["cloud://env.bucket/vehicle-images/car_1/orphan.jpg"]

    page.persistImageChange(
      { action: "add", fileIds },
      fileIds,
      0
    )

    expect(callFunction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        name: "vehicleImageUpdate",
        data: {
          id: "car_1",
          action: "cleanupUpload",
          fileIds
        }
      })
    )
  })

  test("图片上传遇到网络错误时重试一次并保留明确提示", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    const uploadFile = jest
      .fn()
      .mockImplementationOnce(({ fail }) => fail({ errMsg: "uploadFile:fail network timeout" }))
      .mockImplementationOnce(({ fail }) => fail({ errMsg: "uploadFile:fail network timeout" }))
    global.wx = {
      cloud: {
        uploadFile,
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1"
      }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    page.uploadSelectedFiles(["/tmp/vehicle.jpg"], 0)

    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "网络异常，请重试",
      icon: "none"
    })
    expect(page.data.uploading).toBe(false)
  })

  test("开发者工具无法识别图片内容时给出格式提示", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {
        uploadFile: jest.fn(({ fail }) => {
          fail({ errMsg: "Could not find MIME for Buffer <null>" })
        }),
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1"
      }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    page.uploadSelectedFiles(["/tmp/invalid.jpg"], 0)

    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "图片格式无法识别",
      icon: "none"
    })
  })

  test("云上传无回调时超时退出加载并只重试一次", () => {
    jest.useFakeTimers()
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    const uploadFile = jest.fn()
    global.wx = {
      cloud: {
        uploadFile,
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1"
      }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    page.uploadSelectedFiles(["/tmp/vehicle.jpg"], 0)
    jest.advanceTimersByTime(40 * 1000)

    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(global.wx.hideLoading).toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "网络异常，请重试",
      icon: "none"
    })
    expect(page.data.uploading).toBe(false)
    jest.useRealTimers()
  })

  test("云上传成功回调缺少 fileID 时按失败处理而不提交空图片", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {
        uploadFile: jest.fn(({ success }) => success({})),
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1"
      },
      persistImageChange: jest.fn()
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    page.uploadSelectedFiles(["/tmp/vehicle.jpg"], 0)

    expect(page.persistImageChange).not.toHaveBeenCalled()
    expect(global.wx.showToast).toHaveBeenCalledWith({
      title: "图片上传失败",
      icon: "none"
    })
    expect(page.data.uploading).toBe(false)
  })

  test("多张图片上传成功后一次性提交全部 fileID", () => {
    let definition = null
    let uploadIndex = 0
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {
        uploadFile: jest.fn(({ success }) => {
          uploadIndex += 1
          success({ fileID: `cloud://env/vehicle-images/car_1/image_${uploadIndex}.jpg` })
        }),
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1"
      },
      persistImageChange: jest.fn()
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    page.uploadSelectedFiles(["/tmp/one.jpg", "/tmp/two.png"], 1)

    const fileIds = [
      "cloud://env/vehicle-images/car_1/image_1.jpg",
      "cloud://env/vehicle-images/car_1/image_2.jpg"
    ]
    expect(wx.cloud.uploadFile).toHaveBeenCalledTimes(2)
    expect(page.persistImageChange).toHaveBeenCalledWith(
      { action: "add", fileIds },
      fileIds,
      1
    )
  })

  test("单次选择 9 张图片时全部上传并一次性提交", () => {
    let definition = null
    let uploadIndex = 0
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {
        uploadFile: jest.fn(({ success }) => {
          uploadIndex += 1
          success({ fileID: `cloud://env/vehicle-images/car_1/image_${uploadIndex}.jpg` })
        }),
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1"
      },
      persistImageChange: jest.fn()
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })
    const localFiles = Array.from({ length: 9 }, (_, index) => `/tmp/image_${index + 1}.jpg`)
    const fileIds = Array.from(
      { length: 9 },
      (_, index) => `cloud://env/vehicle-images/car_1/image_${index + 1}.jpg`
    )

    page.uploadSelectedFiles(localFiles, 0)

    expect(global.wx.cloud.uploadFile).toHaveBeenCalledTimes(9)
    expect(page.persistImageChange).toHaveBeenCalledWith(
      { action: "add", fileIds },
      fileIds,
      0
    )
  })

  test.each([
    ["uploadFile:fail permission denied", "无图片上传权限"],
    ["uploadFile:fail storage quota limit", "云存储空间不足"],
    ["uploadFile:fail no such file", "所选图片已失效"]
  ])("上传错误 %s 显示对应业务提示", (errMsg, title) => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {
        uploadFile: jest.fn(({ fail }) => fail({ errMsg })),
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1"
      }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    page.uploadSelectedFiles(["/tmp/vehicle.jpg"], 0)

    expect(wx.showToast).toHaveBeenCalledWith({ title, icon: "none" })
    expect(page.data.uploading).toBe(false)
  })

  test("上传 SDK 同步抛错时退出加载状态", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {
        uploadFile: jest.fn(() => {
          throw new Error("upload sdk crashed")
        }),
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1"
      }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    expect(() => page.uploadSelectedFiles(["/tmp/vehicle.jpg"], 0)).not.toThrow()
    expect(page.data.uploading).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "图片上传失败",
      icon: "none"
    })
  })

  test("图片记录写入无响应时超时清理并忽略迟到成功", () => {
    jest.useFakeTimers()
    let definition = null
    let lateSuccess
    global.Page = jest.fn((input) => {
      definition = input
    })
    const callFunction = jest.fn((options) => {
      if (options.data.action === "add") {
        lateSuccess = options.success
      }
    })
    global.wx = {
      cloud: {
        callFunction,
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1",
        uploading: true,
        detail: { imageList: [], coverImage: "" }
      }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })
    const fileIds = ["cloud://env/vehicle-images/car_1/orphan.jpg"]

    page.persistImageChange({ action: "add", fileIds }, fileIds, 0)
    jest.advanceTimersByTime(15 * 1000)
    lateSuccess({
      result: {
        ok: true,
        imageList: fileIds,
        coverImage: fileIds[0]
      }
    })

    expect(page.data.uploading).toBe(false)
    expect(page.data.detail.imageList).toEqual([])
    expect(callFunction).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        data: { id: "car_1", action: "cleanupUpload", fileIds }
      })
    )
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "图片操作失败",
      icon: "none"
    })
  })

  test("图片记录写入同步抛错时退出加载并请求清理", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    const callFunction = jest.fn(() => {
      throw new Error("callFunction crashed")
    })
    global.wx = {
      cloud: {
        callFunction,
        deleteFile: jest.fn()
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1",
        uploading: true
      }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })
    const fileIds = ["cloud://env/vehicle-images/car_1/orphan.jpg"]

    expect(() => page.persistImageChange({ action: "add", fileIds }, fileIds, 0)).not.toThrow()

    expect(page.data.uploading).toBe(false)
    expect(callFunction).toHaveBeenCalledTimes(2)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "图片操作失败",
      icon: "none"
    })
  })

  test("云上传能力缺失时不会进入上传态", () => {
    let definition = null
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {},
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        loading: false,
        id: "car_1",
        uploading: false
      }
    }

    page.uploadSelectedFiles(["/tmp/vehicle.jpg"], 0)

    expect(page.data.uploading).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "云上传能力未初始化",
      icon: "none"
    })
  })

  test("多图中单张失败时保留成功项并仅暴露失败项重试", () => {
    let definition = null
    let index = 0
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {
        uploadFile: jest.fn(({ success, fail }) => {
          index += 1
          if (index === 2) {
            fail({ errMsg: "uploadFile:fail invalid image" })
            return null
          }
          success({ fileID: `cloud://env/success_${index}.jpg` })
          return null
        }),
        deleteFile: jest.fn()
      },
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: { ...definition.data, loading: false, id: "car_1" },
      persistImageChange: jest.fn()
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    page.uploadSelectedFiles(["/tmp/one.jpg", "/tmp/bad.jpg", "/tmp/three.jpg"], 0)

    expect(page.persistImageChange).toHaveBeenCalledWith(
      {
        action: "add",
        fileIds: ["cloud://env/success_1.jpg", "cloud://env/success_3.jpg"]
      },
      ["cloud://env/success_1.jpg", "cloud://env/success_3.jpg"],
      1,
      expect.objectContaining({
        failedUploadPaths: ["/tmp/bad.jpg"],
        uploadedCount: 2
      })
    )
    expect(page.data.failedUploadPaths).toEqual(["/tmp/bad.jpg"])
    expect(page.data.uploadItems.map((item) => item.status)).toEqual(["success", "failed", "success"])
    expect(wx.cloud.deleteFile).not.toHaveBeenCalled()
  })

  test("上传中可取消并保留未完成图片用于重试", () => {
    let definition = null
    let failUpload
    const abort = jest.fn(() => failUpload({ errMsg: "uploadFile:fail abort" }))
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {
        uploadFile: jest.fn((options) => {
          failUpload = options.fail
          return { abort }
        }),
        deleteFile: jest.fn()
      },
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: { ...definition.data, loading: false, id: "car_1" }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    page.uploadSelectedFiles(["/tmp/one.jpg", "/tmp/two.jpg"], 0)
    page.handleCancelUpload()

    expect(abort).toHaveBeenCalled()
    expect(page.data.uploading).toBe(false)
    expect(page.data.failedUploadPaths).toEqual(["/tmp/one.jpg", "/tmp/two.jpg"])
    expect(page.data.uploadProgressText).toContain("已取消")
  })

  test("上传任务取消后没有 SDK 回调也会立即结束上传态", () => {
    jest.useFakeTimers()
    let definition = null
    const abort = jest.fn()
    global.Page = jest.fn((input) => {
      definition = input
    })
    global.wx = {
      cloud: {
        uploadFile: jest.fn(() => ({ abort })),
        deleteFile: jest.fn()
      },
      hideLoading: jest.fn(),
      showToast: jest.fn()
    }
    jest.resetModules()
    require("../pages-admin/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: { ...definition.data, loading: false, id: "car_1" }
    }
    page.setData = jest.fn((patch) => {
      page.data = { ...page.data, ...patch }
    })

    page.uploadSelectedFiles(["/tmp/one.jpg", "/tmp/two.jpg"], 0)
    page.handleCancelUpload()

    expect(abort).toHaveBeenCalledTimes(1)
    expect(page.data.uploading).toBe(false)
    expect(page.data.failedUploadPaths).toEqual(["/tmp/one.jpg", "/tmp/two.jpg"])
    expect(page.data.uploadItems.map((item) => item.status)).toEqual(["cancelled", "cancelled"])
    expect(page.data.uploadProgressText).toBe("上传已取消，可重试未完成图片")
    expect(wx.showToast).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(40 * 1000)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test("详情读取超时会结束刷新并忽略迟到结果", () => {
    jest.useFakeTimers()
    let requestOptions = null
    const done = jest.fn()
    const definition = loadVehicleDetailDefinition({
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      },
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition)

    page.fetchDetail("car-timeout", done)
    jest.advanceTimersByTime(15 * 1000)

    expect(done).toHaveBeenCalledTimes(1)
    expect(page.data.loading).toBe(false)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "档案加载超时，请重试",
      icon: "none"
    })

    requestOptions.success({
      result: {
        ok: true,
        detail: { id: "car-timeout", brandModel: "迟到车辆" }
      }
    })
    expect(page.data.detail).toBeNull()
    expect(done).toHaveBeenCalledTimes(1)
  })

  test("连续读取详情时结束旧刷新且只采用最新结果", () => {
    const requests = []
    const firstDone = jest.fn()
    const secondDone = jest.fn()
    const definition = loadVehicleDetailDefinition({
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      },
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition)

    page.fetchDetail("car-old", firstDone)
    page.fetchDetail("car-new", secondDone)
    expect(firstDone).toHaveBeenCalledTimes(1)

    requests[1].success({
      result: {
        ok: true,
        detail: { id: "car-new", brandModel: "新车辆" }
      }
    })
    requests[0].success({
      result: {
        ok: true,
        detail: { id: "car-old", brandModel: "旧车辆" }
      }
    })

    expect(page.data.detail.id).toBe("car-new")
    expect(page.data.detail.brandModel).toBe("新车辆")
    expect(secondDone).toHaveBeenCalledTimes(1)
  })

  test("状态或图片写入期间底层详情读取入口直接收尾", () => {
    const definition = loadVehicleDetailDefinition({
      cloud: {
        callFunction: jest.fn()
      },
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition, {
      id: "car-busy",
      loading: false,
      updatingStatus: true
    })
    const statusDone = jest.fn()
    const uploadDone = jest.fn()
    const imageDone = jest.fn()

    page.fetchDetail("car-busy", statusDone)
    page.data.updatingStatus = false
    page.data.uploading = true
    page.fetchDetail("car-busy", uploadDone)
    page.data.uploading = false
    page._imageChangePending = true
    page.fetchDetail("car-busy", imageDone)

    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    expect(statusDone).toHaveBeenCalledTimes(1)
    expect(uploadDone).toHaveBeenCalledTimes(1)
    expect(imageDone).toHaveBeenCalledTimes(1)
  })

  test("图片选择器在详情刷新开始后返回时不启动上传", () => {
    let chooseOptions = null
    const definition = loadVehicleDetailDefinition({
      chooseImage: jest.fn((options) => {
        chooseOptions = options
      }),
      cloud: {
        uploadFile: jest.fn()
      },
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition, {
      id: "car-refresh",
      loading: false,
      detail: { imageCount: 0 }
    })

    page.handleUploadImages()
    page.setData({ loading: true })
    chooseOptions.success({
      tempFiles: [{ path: "/tmp/stale.jpg", size: 1024 }]
    })

    expect(wx.cloud.uploadFile).not.toHaveBeenCalled()
    expect(page.data.uploading).toBe(false)
  })

  test("状态更新超时会解除互斥并忽略迟到成功", () => {
    jest.useFakeTimers()
    let requestOptions = null
    const definition = loadVehicleDetailDefinition({
      cloud: {
        callFunction: jest.fn((options) => {
          requestOptions = options
        })
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition, { loading: false })
    page.fetchDetail = jest.fn()

    page.updateVehicleStatus("car-1", "idle")
    page.updateVehicleStatus("car-1", "maintenance")
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(20 * 1000)

    expect(page.data.updatingStatus).toBe(false)
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "状态更新超时，请重试",
      icon: "none"
    })

    requestOptions.success({ result: { ok: true, message: "已更新" } })
    expect(page.fetchDetail).not.toHaveBeenCalled()
  })

  test("状态云函数同步抛错时恢复页面操作", () => {
    const definition = loadVehicleDetailDefinition({
      cloud: {
        callFunction: jest.fn(() => {
          throw new Error("status unavailable")
        })
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition, { loading: false })

    expect(() => page.retireVehicle("car-1")).not.toThrow()
    expect(page.data.updatingStatus).toBe(false)
    expect(wx.hideLoading).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({
      title: "停用失败",
      icon: "none"
    })
  })

  test("封面设置期间阻止重复图片操作并在超时后恢复", () => {
    jest.useFakeTimers()
    const requests = []
    const definition = loadVehicleDetailDefinition({
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition, {
      id: "car-1",
      detail: { imageList: ["cloud://cover"], coverImage: "cloud://cover" }
    })

    page.persistImageChange({ action: "setCover", fileId: "cloud://cover" })
    page.persistImageChange({ action: "remove", fileId: "cloud://cover" })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)

    jest.advanceTimersByTime(15 * 1000)
    expect(page._imageChangePending).toBe(false)
    page.persistImageChange({ action: "setCover", fileId: "cloud://cover" })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(2)
    requests[1].fail({ errMsg: "request failed" })
  })

  test("已有图片写入拒绝上传入库时清理新文件并解除上传态", () => {
    const fileIds = ["cloud://env/new-upload.jpg"]
    const definition = loadVehicleDetailDefinition({
      cloud: {
        callFunction: jest.fn()
      },
      hideLoading: jest.fn(),
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition, {
      id: "car-image-busy",
      loading: false,
      uploading: true
    })
    page._imageChangePending = true

    page.persistImageChange(
      { action: "add", fileIds },
      fileIds,
      0
    )

    expect(wx.cloud.callFunction).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "vehicleImageUpdate",
        data: {
          id: "car-image-busy",
          action: "cleanupUpload",
          fileIds
        }
      })
    )
    expect(page.data.uploading).toBe(false)
  })

  test("图片入库期间离页会清理待确认文件并忽略迟到成功", () => {
    const requests = []
    const fileIds = ["cloud://env/orphan.jpg"]
    const definition = loadVehicleDetailDefinition({
      cloud: {
        callFunction: jest.fn((options) => requests.push(options))
      },
      showLoading: jest.fn(),
      hideLoading: jest.fn(),
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition, {
      id: "car-1",
      uploading: true,
      detail: { imageList: [], coverImage: "" }
    })

    page.persistImageChange(
      { action: "add", fileIds },
      fileIds,
      0
    )
    page.onUnload()

    expect(requests[1]).toEqual(expect.objectContaining({
      name: "vehicleImageUpdate",
      data: {
        id: "car-1",
        action: "cleanupUpload",
        fileIds
      }
    }))
    requests[0].success({
      result: { ok: true, imageList: fileIds, coverImage: fileIds[0] }
    })
    expect(page.data.detail.imageList).toEqual([])
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("上传过程中离页会终止任务且不再显示反馈", () => {
    const abort = jest.fn()
    const definition = loadVehicleDetailDefinition({
      cloud: {
        uploadFile: jest.fn(() => ({ abort })),
        callFunction: jest.fn()
      },
      hideLoading: jest.fn(),
      showToast: jest.fn()
    })
    const page = createVehicleDetailPage(definition, { id: "car-1" })

    page.uploadSelectedFiles(["/tmp/vehicle.jpg"], 0)
    page.onUnload()

    expect(abort).toHaveBeenCalledTimes(1)
    expect(wx.showToast).not.toHaveBeenCalled()
  })
})
