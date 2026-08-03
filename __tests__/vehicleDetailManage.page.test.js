const fs = require("fs")
const path = require("path")

describe("pages/vehicle-detail-manage 车辆详情管理视觉", () => {
  const pageDir = path.resolve(__dirname, "../pages/vehicle-detail-manage")
  const wxmlSource = fs.readFileSync(path.join(pageDir, "vehicle-detail-manage.wxml"), "utf8")
  const wxssSource = fs.readFileSync(path.join(pageDir, "vehicle-detail-manage.wxss"), "utf8")

  afterEach(() => {
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

    expect(jsSource).toContain('const partialUpload = payload.action === "add" && Number(skippedCount) > 0')
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
    require("../pages/vehicle-detail-manage/vehicle-detail-manage")
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
    require("../pages/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        detail: { imageCount: 0 },
        uploading: false
      },
      uploadSelectedFiles: jest.fn()
    }

    page.handleUploadImages()

    expect(page.uploadSelectedFiles).toHaveBeenCalledWith(["/tmp/vehicle.jpg"], 2)
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
    require("../pages/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        detail: { imageCount: 0 },
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
    require("../pages/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
        detail: { imageCount: 0 },
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
    require("../pages/vehicle-detail-manage/vehicle-detail-manage")
    const page = {
      ...definition,
      data: {
        ...definition.data,
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
})
