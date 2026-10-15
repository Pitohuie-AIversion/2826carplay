const CURRENT_VERSION = "1.1.0"
const STORAGE_KEY_VERSION = "app_current_version"
const STORAGE_KEY_MIGRATED_AT = "app_version_migrated_at"
const STORAGE_KEY_RELEASE_NOTES = "app_latest_release_notes"

const RELEASE_NOTES = {
  version: CURRENT_VERSION,
  releaseDate: "2026-10-15",
  title: "极境车库 v1.1.0 尊享体验与运营敏捷升级",
  highlights: [
    "【动态试算】预约页面接入梯度连租折扣试算与省费明细即时计算，租后开启五星体验评价闭环",
    "【驾控座舱】车型详情配置支持「动力驾控」与「奢享座舱」双模态无缝切换与尊享权益全景看板",
    "【运营通告】管理员支持线上即时发布首页全局公告，支持弱网自愈指示条与离线浏览",
    "【性能加速】全站接入腾讯云数据万象 WebP 动态压缩与微信后台数据预拉取（Background Fetch）",
    "【特色筛选】车库页面新增免押金、￥2000内、尊享超跑与纯电性能快速筛选芯片"
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
