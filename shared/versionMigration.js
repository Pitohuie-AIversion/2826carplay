const CURRENT_VERSION = "1.2.0"
const STORAGE_KEY_VERSION = "app_current_version"
const STORAGE_KEY_MIGRATED_AT = "app_version_migrated_at"
const STORAGE_KEY_RELEASE_NOTES = "app_latest_release_notes"

const RELEASE_NOTES = {
  version: CURRENT_VERSION,
  releaseDate: "2026-10-19",
  title: "爱迦租车 v1.2.0 尊享对比矩阵与交验车留证闭环升级",
  highlights: [
    "【验车留证】预约详情全面支持客户专属交验车留证事实备忘复制、环检损伤结构化呈现与留证单 (CSV) 导出、查看及分享",
    "【心仪对比】心仪收藏夹引入车型对比矩阵、参数差异高亮过滤（只看差异）、生成尊享对比长图海报与管家一键核价闭环",
    "【预约触感】预约列表与预约工作台全流程接入分类轻量震动触感反馈与页面卡片分享能力",
    "【大盘运维】运营管理端大盘新增新车录入、全局参数配置与系统健康巡检一键运维通道",
    "【专属管家】预约详情与全流程支持一键致电专属管家与紧急救援通道"
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
  } catch (error) { console.error(error) }
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
          } catch (error) { console.error(error) }
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
          } catch (e) { console.error(e) }
        }
      }
    })
  } catch (error) { console.error(error) }
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
