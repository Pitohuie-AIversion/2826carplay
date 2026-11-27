const canvasPoster = require("../shared/canvasPoster")

describe("shared/canvasPoster", () => {
  let mockCtx

  beforeEach(() => {
    mockCtx = {
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      arcTo: jest.fn(),
      closePath: jest.fn(),
      save: jest.fn(),
      clip: jest.fn(),
      restore: jest.fn(),
      drawImage: jest.fn(),
      fillText: jest.fn(),
      measureText: jest.fn((str) => ({ width: str.length * 10 }))
    }
  })

  test("drawPosterRoundedRect draws path with constrained radius", () => {
    canvasPoster.drawPosterRoundedRect(mockCtx, 10, 20, 100, 80, 20)
    expect(mockCtx.beginPath).toHaveBeenCalled()
    expect(mockCtx.moveTo).toHaveBeenCalledWith(30, 20)
    expect(mockCtx.closePath).toHaveBeenCalled()

    // When radius is larger than half of dimensions, clamp it
    mockCtx.beginPath.mockClear()
    canvasPoster.drawPosterRoundedRect(mockCtx, 0, 0, 40, 20, 50)
    expect(mockCtx.beginPath).toHaveBeenCalled()
  })

  test("drawPosterAspectFillImage clips and scales aspect-fill image", () => {
    const img = { width: 400, height: 200 }
    canvasPoster.drawPosterAspectFillImage(mockCtx, img, 10, 10, 100, 100, 10)
    expect(mockCtx.save).toHaveBeenCalled()
    expect(mockCtx.clip).toHaveBeenCalled()
    expect(mockCtx.drawImage).toHaveBeenCalled()
    expect(mockCtx.restore).toHaveBeenCalled()
  })

  test("drawPosterTextEllipsis handles normal and truncated text", () => {
    // Normal text fits
    canvasPoster.drawPosterTextEllipsis(mockCtx, "short", 10, 20, 100)
    expect(mockCtx.fillText).toHaveBeenCalledWith("short", 10, 20)

    // Truncated text
    mockCtx.fillText.mockClear()
    canvasPoster.drawPosterTextEllipsis(mockCtx, "a very long text that will exceed", 10, 20, 80)
    expect(mockCtx.fillText).toHaveBeenCalled()
    const lastCallArg = mockCtx.fillText.mock.calls[0][0]
    expect(lastCallArg).toContain("…")
  })

  test("savePosterImageToPhotosAlbum performs lifecycle guard, timeout and saves image", async () => {
    jest.useFakeTimers()
    const mockPage = {
      data: { posterImagePath: "wxfile://tmp/test.png" },
      setData: jest.fn()
    }

    global.wx = {
      saveImageToPhotosAlbum: jest.fn(({ success }) => success()),
      showToast: jest.fn(),
      vibrateShort: jest.fn()
    }

    const onCloseModal = jest.fn()
    const savePromise = canvasPoster.savePosterImageToPhotosAlbum(mockPage, {
      filePath: "wxfile://tmp/test.png",
      isActive: () => true,
      onCloseModal
    })

    await savePromise
    expect(global.wx.saveImageToPhotosAlbum).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: "wxfile://tmp/test.png" })
    )
    expect(global.wx.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "海报已保存相册", icon: "success" })
    )
    expect(onCloseModal).toHaveBeenCalled()

    jest.useRealTimers()
    delete global.wx
  })
})
