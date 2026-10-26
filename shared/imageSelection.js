function chooseImageFiles(options) {
  const input = options || {}
  let settled = false
  const once = (callback) => (result) => {
    if (settled) return
    settled = true
    if (typeof callback === "function") callback(result)
  }
  const fail = once(input.fail)
  if (typeof wx.chooseMedia === "function") {
    wx.chooseMedia({
      count: input.count,
      mediaType: ["image"],
      sizeType: input.sizeType,
      sourceType: input.sourceType,
      success: once((result) => {
        const files = (result && Array.isArray(result.tempFiles) ? result.tempFiles : [])
          .map((file) => ({ ...file, path: file.tempFilePath }))
        if (typeof input.success === "function") input.success({ tempFiles: files, tempFilePaths: files.map((file) => file.path) })
      }),
      fail
    })
  } else if (typeof wx.chooseImage === "function") {
    wx.chooseImage({ ...input, success: once(input.success), fail })
  } else {
    fail({ errMsg: "image picker unavailable" })
  }
}

module.exports = { chooseImageFiles }
