/**
 * 爱迦租车 - 通用 Canvas 2D 海报绘制与相册保存核心服务 (Canvas Poster Service)
 *
 * 职责：
 * 1. 提供底层 Canvas 2D 高保真图形绘制基语 (圆角矩形、AspectFill裁切、单行省略)
 * 2. 封装微信原生相册保存流程 (生命周期防穿透、60s防挂起超时回收、授权拒绝自动恢复引导)
 * 3. 消除 car-detail、favorites 等页面的重复 Canvas 绘图与相册处理样板代码
 */

const { beginPageNativeAction, isPageNativeActionActive } = require("./pageNativeAction")
const { triggerHapticFeedback } = require("./hapticFeedback")
const { handleAlbumSaveError } = require("./albumPermission")

/**
 * 绘制平滑圆角矩形路径 (自动限制最大半径不超出短边一半)
 * @param {CanvasRenderingContext2D} ctx 
 * @param {number} x 
 * @param {number} y 
 * @param {number} width 
 * @param {number} height 
 * @param {number} radius 
 */
function drawPosterRoundedRect(ctx, x, y, width, height, radius) {
  if (!ctx || typeof ctx.beginPath !== "function") return
  const r = Math.min(radius || 0, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + width - r, y)
  ctx.arcTo(x + width, y, x + width, y + r, r)
  ctx.lineTo(x + width, y + height - r)
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r)
  ctx.lineTo(x + r, y + height)
  ctx.arcTo(x, y + height, x, y + height - r, r)
  ctx.lineTo(x + r, y)
  ctx.arcTo(x, y, x + r, y, r)
  ctx.closePath()
}

/**
 * 保持宽高比居中裁切并填充圆角矩形 (AspectFill)
 * @param {CanvasRenderingContext2D} ctx 
 * @param {HTMLImageElement|Image} img 
 * @param {number} x 
 * @param {number} y 
 * @param {number} width 
 * @param {number} height 
 * @param {number} radius 
 */
function drawPosterAspectFillImage(ctx, img, x, y, width, height, radius) {
  if (!ctx || !img) return
  ctx.save()
  drawPosterRoundedRect(ctx, x, y, width, height, radius)
  ctx.clip()

  const imgW = (img && (img.width || img.naturalWidth)) || width
  const imgH = (img && (img.height || img.naturalHeight)) || height
  const scale = Math.max(width / imgW, height / imgH)
  const drawW = imgW * scale
  const drawH = imgH * scale
  const drawX = x + (width - drawW) / 2
  const drawY = y + (height - drawH) / 2

  if (typeof ctx.drawImage === "function") {
    ctx.drawImage(img, drawX, drawY, drawW, drawH)
  }
  ctx.restore()
}

/**
 * 文本单行绘制并带超长省略号截断 (Ellipsis)
 * @param {CanvasRenderingContext2D} ctx 
 * @param {string} text 
 * @param {number} x 
 * @param {number} y 
 * @param {number} maxWidth 
 */
function drawPosterTextEllipsis(ctx, text, x, y, maxWidth) {
  if (!ctx || text === undefined || text === null) return
  const str = String(text).trim()
  if (!str) return
  try {
    if (ctx.measureText && ctx.measureText(str).width <= maxWidth) {
      ctx.fillText(str, x, y)
      return
    }
  } catch (e) {
    if (typeof ctx.fillText === "function") ctx.fillText(str, x, y)
    return
  }
  let truncated = str
  while (truncated.length > 1) {
    try {
      if (ctx.measureText && ctx.measureText(truncated + "…").width <= maxWidth) {
        break
      }
    } catch (e) {
      break
    }
    truncated = truncated.slice(0, -1)
  }
  if (typeof ctx.fillText === "function") {
    ctx.fillText(truncated + "…", x, y)
  }
}

/**
 * 安全保存海报到系统相册
 * 包含：并发防重、原生动作防穿透、60s防挂起超时回收、远程图片预下载、错误授权弹窗恢复
 *
 * @param {object} page Page 实例
 * @param {object} options
 * @param {string} options.filePath 海报文件路径
 * @param {string} [options.exclusiveKey="poster-save"] 原生动作互斥 key
 * @param {function} options.isActive 校验当前保存动作是否依然有效
 * @param {string} [options.taskField="_posterSaveTask"] 页面挂载的任务变量名
 * @param {string} [options.timerField="_posterSaveTimer"] 页面挂载的超时计时器名
 * @param {string} [options.loadingActionField="_posterSaveLoadingAction"] 页面挂载的 loading 标识
 * @param {function} [options.resolveCover] 远程路径异步转本地路径解析器
 * @param {function} [options.onSuccess] 保存成功时的回调
 * @param {function} [options.onCloseModal] 关闭海报模态框回调
 */
async function savePosterImageToPhotosAlbum(page, options = {}) {
  const {
    filePath: initialFilePath,
    exclusiveKey = "poster-save",
    isActive,
    taskField = "_posterSaveTask",
    timerField = "_posterSaveTimer",
    loadingActionField = "_posterSaveLoadingAction",
    resolveCover,
    onSuccess,
    onCloseModal
  } = options

  if (page[taskField]) return

  const action = beginPageNativeAction(page, { requireCurrent: true, exclusiveKey })
  const checkActive = () => {
    if (typeof isActive === "function" && !isActive(action)) return false
    return isPageNativeActionActive(page, action)
  }

  if (!checkActive()) return

  let filePath = initialFilePath
  if (!filePath) {
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({ title: "海报生成中", icon: "none" })
    }
    return
  }

  const saveTask = {}
  page[taskField] = saveTask

  const finishSave = () => {
    if (page[taskField] !== saveTask) return false
    page[taskField] = null
    if (page[timerField]) {
      clearTimeout(page[timerField])
      page[timerField] = null
    }
    return checkActive()
  }

  const handleFailure = (error) => {
    if (finishSave()) {
      handleAlbumSaveError(page, error, checkActive)
    }
  }

  page[timerField] = setTimeout(() => {
    if (!finishSave()) return
    if (page[loadingActionField] === action) {
      page[loadingActionField] = null
      if (typeof wx !== "undefined" && typeof wx.hideLoading === "function") {
        wx.hideLoading()
      }
    }
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({ title: "保存未确认，请重试", icon: "none" })
    }
  }, 60000)

  // 处理云存储或网络图片协议预下载
  if (filePath.startsWith("http://") || filePath.startsWith("https://") || filePath.startsWith("cloud://")) {
    if (typeof resolveCover === "function") {
      try {
        if (typeof wx !== "undefined" && typeof wx.showLoading === "function") {
          page[loadingActionField] = action
          wx.showLoading({ title: "保存中…", mask: true })
        }
        filePath = await resolveCover(filePath)
      } catch (e) {
      } finally {
        if (page[loadingActionField] === action) {
          page[loadingActionField] = null
          if (typeof wx !== "undefined" && typeof wx.hideLoading === "function") {
            wx.hideLoading()
          }
        }
      }
    }
  }

  if (page[taskField] !== saveTask || !checkActive()) {
    finishSave()
    return
  }

  if (typeof wx !== "undefined" && typeof wx.saveImageToPhotosAlbum === "function") {
    try {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: () => {
          if (finishSave()) {
            triggerHapticFeedback("medium")
            if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
              wx.showToast({ title: "海报已保存相册", icon: "success" })
            }
            if (typeof onSuccess === "function") {
              onSuccess()
            } else if (typeof onCloseModal === "function") {
              onCloseModal()
            }
          }
        },
        fail: handleFailure
      })
    } catch (error) {
      handleFailure(error)
    }
  } else {
    finishSave()
    if (typeof wx !== "undefined" && typeof wx.showToast === "function") {
      wx.showToast({ title: "系统暂不支持", icon: "none" })
    }
  }
}

module.exports = {
  drawPosterRoundedRect,
  drawComparePosterRoundedRect: drawPosterRoundedRect,
  drawPosterAspectFillImage,
  drawPosterTextEllipsis,
  savePosterImageToPhotosAlbum
}
