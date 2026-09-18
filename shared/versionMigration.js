const CURRENT_VERSION = "1.0.1"
const STORAGE_KEY_VERSION = "app_current_version"
const STORAGE_KEY_MIGRATED_AT = "app_version_migrated_at"
const STORAGE_KEY_RELEASE_NOTES = "app_latest_release_notes"

const RELEASE_NOTES = {
  version: CURRENT_VERSION,
  releaseDate: "2026-09-18",
  title: "极境车库 v1.0.1 体验更新",
  highlights: [
    "【城市筛选】首页车库与管理端新增取车交付中心城市即时过滤，支持本地与云端联动查询",
    "【偏好记忆】待协调工作台排序偏好及我的收藏「只看可预约」状态支持本地记忆与自动恢复",
    "【海报生成】车辆详情支持生成专属分享海报，优化相册权限提示文案与拦截引导",
    "【交互体验】全站核心数据页面接入微信原生下拉刷新，优化网络同步与按压微动画",
    "【热更新】引入客户端新版本就绪自动提示与启动数据平滑迁移机制"
  ]
}

function getStoredVersion() {
  if (typeof wx === "undefined" || typeof wx.getStorageSync !== "function") {
    return ""
  }
  try {
    return String(wx.getStorageSync(STORAGE_KEY_VERSION) || "").trim()
  } catch (error) {
    return ""
  }
}

function setStoredVersion(version) {
  if (typeof wx === "undefined" || typeof wx.setStorageSync !== "function") {
    return
  }
  try {
    wx.setStorageSync(STORAGE_KEY_VERSION, version)
    wx.setStorageSync(STORAGE_KEY_MIGRATED_AT, Date.now())
    wx.setStorageSync(STORAGE_KEY_RELEASE_NOTES, RELEASE_NOTES)
  } catch (error) {}
}

function runVersionMigration() {
  const previousVersion = getStoredVersion()
  const isFirstLaunch = !previousVersion
  const isUpgraded = Boolean(previousVersion && previousVersion !== CURRENT_VERSION)

  if (isFirstLaunch || isUpgraded) {
    setStoredVersion(CURRENT_VERSION)
  }

  return {
    currentVersion: CURRENT_VERSION,
    previousVersion: previousVersion || null,
    isFirstLaunch,
    isUpgraded,
    releaseNotes: RELEASE_NOTES
  }
}

function setupUpdateManager(options) {
  if (typeof wx === "undefined" || typeof wx.getUpdateManager !== "function") {
    return null
  }
  try {
    const updateManager = wx.getUpdateManager()
    if (!updateManager || typeof updateManager.onUpdateReady !== "function") {
      return null
    }

    updateManager.onUpdateReady(() => {
      if (typeof wx.showModal === "function") {
        wx.showModal({
          title: "更新提示",
          content: "新版本已经准备好，是否立即重启应用？",
          showCancel: false,
          confirmText: "重启更新",
          confirmColor: "#528fff",
          success: (res) => {
            if (res && res.confirm && typeof updateManager.applyUpdate === "function") {
              updateManager.applyUpdate()
            }
          }
        })
      }
    })

    if (typeof updateManager.onUpdateFailed === "function") {
      updateManager.onUpdateFailed(() => {
        if (options && typeof options.onFailed === "function") {
          try {
            options.onFailed()
          } catch (error) {}
        }
      })
    }

    return updateManager
  } catch (error) {
    return null
  }
}

function showReleaseNotesModal(options) {
  if (typeof wx === "undefined" || typeof wx.showModal !== "function") {
    return
  }
  const highlights = Array.isArray(RELEASE_NOTES.highlights)
    ? RELEASE_NOTES.highlights.join("\r\n\r\n")
    : ""
  try {
    wx.showModal({
      title: "版本更新说明",
      content: `${RELEASE_NOTES.title}\r\n\r\n${highlights}`,
      showCancel: false,
      confirmText: "知道了",
      confirmColor: "#528fff",
      success: (res) => {
        if (options && typeof options.onConfirm === "function") {
          try {
            options.onConfirm(res)
          } catch (e) {}
        }
      }
    })
  } catch (error) {}
}

module.exports = {
  CURRENT_VERSION,
  STORAGE_KEY_VERSION,
  STORAGE_KEY_MIGRATED_AT,
  STORAGE_KEY_RELEASE_NOTES,
  RELEASE_NOTES,
  getStoredVersion,
  setStoredVersion,
  runVersionMigration,
  setupUpdateManager,
  showReleaseNotesModal
}
