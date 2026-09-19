/**
 * 极境车库 - 豪车尊享触感震动反馈（Haptic Feedback）
 * 
 * 在高价值用户动作（如复制顾问微信、保存海报、点亮收藏、拨打救援）时，
 * 触发细腻的轻微马达触感震动，模拟豪华车物理按键质感。
 */

function triggerHapticFeedback(type = "light") {
  if (typeof wx === "undefined" || typeof wx.vibrateShort !== "function") {
    return false
  }

  const validTypes = ["light", "medium", "heavy"]
  const vibrationType = validTypes.includes(type) ? type : "light"

  try {
    wx.vibrateShort({
      type: vibrationType,
      style: vibrationType,
      fail: () => {}
    })
    return true
  } catch (error) {
    // 模拟器或不支持震动的设备安全静默
    return false
  }
}

module.exports = {
  triggerHapticFeedback
}
