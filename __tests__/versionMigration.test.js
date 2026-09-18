const {
  CURRENT_VERSION,
  STORAGE_KEY_VERSION,
  STORAGE_KEY_RELEASE_NOTES,
  RELEASE_NOTES,
  getStoredVersion,
  setStoredVersion,
  runVersionMigration,
  setupUpdateManager,
  showReleaseNotesModal
} = require("../shared/versionMigration")

describe("shared/versionMigration 版本迁移与热更新管理器", () => {
  afterEach(() => {
    delete global.wx
    delete global.App
  })

  test("首次启动时记录当前版本并返回首次启动标识", () => {
    const storage = {}
    global.wx = {
      getStorageSync: jest.fn((key) => storage[key] || ""),
      setStorageSync: jest.fn((key, value) => {
        storage[key] = value
      })
    }

    const result = runVersionMigration()

    expect(result.isFirstLaunch).toBe(true)
    expect(result.isUpgraded).toBe(false)
    expect(result.currentVersion).toBe(CURRENT_VERSION)
    expect(storage[STORAGE_KEY_VERSION]).toBe(CURRENT_VERSION)
    expect(storage[STORAGE_KEY_RELEASE_NOTES]).toEqual(RELEASE_NOTES)
  })

  test("同版本重复启动不触发升级迁移", () => {
    const storage = {
      [STORAGE_KEY_VERSION]: CURRENT_VERSION
    }
    global.wx = {
      getStorageSync: jest.fn((key) => storage[key] || ""),
      setStorageSync: jest.fn((key, value) => {
        storage[key] = value
      })
    }

    const result = runVersionMigration()

    expect(result.isFirstLaunch).toBe(false)
    expect(result.isUpgraded).toBe(false)
    expect(result.currentVersion).toBe(CURRENT_VERSION)
    expect(global.wx.setStorageSync).not.toHaveBeenCalled()
  })

  test("跨版本升级时触发平滑迁移并更新版本记录与说明", () => {
    const storage = {
      [STORAGE_KEY_VERSION]: "1.0.0"
    }
    global.wx = {
      getStorageSync: jest.fn((key) => storage[key] || ""),
      setStorageSync: jest.fn((key, value) => {
        storage[key] = value
      })
    }

    const result = runVersionMigration()

    expect(result.isFirstLaunch).toBe(false)
    expect(result.isUpgraded).toBe(true)
    expect(result.previousVersion).toBe("1.0.0")
    expect(result.currentVersion).toBe(CURRENT_VERSION)
    expect(result.releaseNotes.highlights.length).toBeGreaterThanOrEqual(3)
    expect(storage[STORAGE_KEY_VERSION]).toBe(CURRENT_VERSION)
  })

  test("新版本代码包下载完成时弹窗提示并支持立即重启更新", () => {
    let onReadyCallback = null
    const applyUpdate = jest.fn()
    const mockUpdateManager = {
      onUpdateReady: jest.fn((cb) => {
        onReadyCallback = cb
      }),
      onUpdateFailed: jest.fn(),
      applyUpdate
    }

    global.wx = {
      getUpdateManager: jest.fn(() => mockUpdateManager),
      showModal: jest.fn(({ success }) => {
        success({ confirm: true })
      })
    }

    const manager = setupUpdateManager()
    expect(manager).toBe(mockUpdateManager)
    expect(mockUpdateManager.onUpdateReady).toHaveBeenCalledTimes(1)

    // 触发微信新版本就绪回调
    onReadyCallback()

    expect(global.wx.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "更新提示",
        content: "新版本已经准备好，是否立即重启应用？",
        showCancel: false,
        confirmText: "重启更新",
        confirmColor: "#528fff"
      })
    )
    expect(applyUpdate).toHaveBeenCalledTimes(1)
  })

  test("环境不支持更新能力或存储 API 时安全优雅降级", () => {
    delete global.wx

    expect(getStoredVersion()).toBe("")
    expect(() => setStoredVersion("1.0.0")).not.toThrow()
    expect(setupUpdateManager()).toBeNull()

    const result = runVersionMigration()
    expect(result.currentVersion).toBe(CURRENT_VERSION)
  })

  test("app.js 在 onLaunch 时正确初始化版本迁移与更新监听", () => {
    jest.resetModules()
    let appConfig = null
    global.App = jest.fn((options) => {
      appConfig = options
    })

    const storage = {}
    const mockUpdateManager = {
      onUpdateReady: jest.fn(),
      onUpdateFailed: jest.fn()
    }
    global.wx = {
      getStorageSync: jest.fn((key) => storage[key] || ""),
      setStorageSync: jest.fn((key, value) => {
        storage[key] = value
      }),
      getUpdateManager: jest.fn(() => mockUpdateManager)
    }

    require("../app")

    expect(appConfig).toBeDefined()
    appConfig.onLaunch()

    expect(appConfig._versionMigrationResult).toBeDefined()
    expect(appConfig._versionMigrationResult.currentVersion).toBe(CURRENT_VERSION)
    expect(appConfig._updateManager).toBe(mockUpdateManager)
  })

  test("showReleaseNotesModal 弹出统一品牌规范的版本更新说明弹窗", () => {
    let modalOptions = null
    global.wx = {
      showModal: jest.fn((options) => {
        modalOptions = options
        if (typeof options.success === "function") {
          options.success({ confirm: true })
        }
      })
    }

    const onConfirm = jest.fn()
    showReleaseNotesModal({ onConfirm })

    expect(global.wx.showModal).toHaveBeenCalledTimes(1)
    expect(modalOptions).toMatchObject({
      title: "版本更新说明",
      showCancel: false,
      confirmText: "知道了",
      confirmColor: "#528fff"
    })
    expect(modalOptions.content).toContain(RELEASE_NOTES.title)
    expect(modalOptions.content).toContain("交付中心")
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  test("showReleaseNotesModal 在缺少 wx 环境时优雅静默降级", () => {
    delete global.wx
    expect(() => showReleaseNotesModal()).not.toThrow()
  })

  test("pages/mine 正确挂载版本号并通过 handleShowReleaseNotes 唤起更新弹窗", () => {
    jest.resetModules()
    let pageDefinition = null
    global.Page = jest.fn((def) => {
      pageDefinition = def
    })

    global.wx = {
      showModal: jest.fn()
    }

    require("../pages/mine/mine")

    expect(pageDefinition).toBeDefined()
    expect(pageDefinition.data.appVersion).toBe(CURRENT_VERSION)
    expect(typeof pageDefinition.handleShowReleaseNotes).toBe("function")

    pageDefinition.handleShowReleaseNotes()
    expect(global.wx.showModal).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "版本更新说明",
        showCancel: false,
        confirmText: "知道了",
        confirmColor: "#528fff"
      })
    )
  })
})
