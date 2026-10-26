describe.each(["car-detail", "favorites"])("%s 海报相册授权恢复", (name) => {
  let page
  let currentPages
  let save
  let app

  beforeEach(() => {
    jest.resetModules()
    jest.useFakeTimers()
    global.wx = {
      showToast: jest.fn(), showModal: jest.fn(), openSetting: jest.fn(), showLoading: jest.fn(), hideLoading: jest.fn(),
      getPrivacySetting: jest.fn(({ success }) => success({ needAuthorization: false })),
      getSetting: jest.fn(({ success }) => success({ authSetting: { "scope.writePhotosAlbum": false } })),
      saveImageToPhotosAlbum: jest.fn(), vibrateShort: jest.fn()
    }
    app = { globalData: {} }
    global.getApp = () => app
    global.Page = (definition) => {
      page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
      page.setData = jest.fn((patch) => Object.assign(page.data, patch))
    }
    require(`../pages/${name}/${name}`)
    Object.assign(page.data, {
      car: { id: "vehicle_1" }, carId: "vehicle_1",
      posterModalVisible: true, posterImagePath: "wxfile://poster.png",
      comparePosterVisible: true, comparePosterImagePath: "wxfile://poster.png"
    })
    currentPages = [page]
    global.getCurrentPages = () => currentPages
    save = () => name === "car-detail" ? page.handleSavePoster() : page.handleSaveComparePoster()
  })

  afterEach(() => {
    wx.showToast.mock.calls.forEach(([options]) => expect(Array.from(options.title).length).toBeLessThanOrEqual(10))
    page.onUnload()
    expect(jest.getTimerCount()).toBe(0)
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  async function rejectAlbum(error = { errMsg: "saveImageToPhotosAlbum:fail auth deny" }) {
    await save()
    wx.saveImageToPhotosAlbum.mock.calls.at(-1)[0].fail(error)
  }

  test("首次保存仍在途时连续点击只发起一次相册写入", async () => {
    await save()
    await save()
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(1)
    wx.saveImageToPhotosAlbum.mock.calls[0][0].success()
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "海报已保存相册", icon: "success" })
  })

  test("保存失败解除在途锁，用户可以立即重新保存", async () => {
    await rejectAlbum({ errMsg: "saveImageToPhotosAlbum:fail system error" })
    await save()
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(2)
    wx.saveImageToPhotosAlbum.mock.calls[1][0].success()
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "海报已保存相册", icon: "success" })
  })

  test("原生保存同步异常也能解除在途锁并允许重试", async () => {
    wx.saveImageToPhotosAlbum.mockImplementationOnce(() => { throw new Error("album bridge unavailable") })
    await expect(save()).resolves.toBeUndefined()
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "保存未完成，请重试", icon: "none" })
    await save()
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(2)
    wx.saveImageToPhotosAlbum.mock.calls[1][0].success()
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "海报已保存相册", icon: "success" })
  })

  test.each(["切页", "应用后台"])("%s后返回可新建保存，旧回执不能解除新保存的在途锁", async (leave) => {
    page.loadOperationConfig = jest.fn()
    page.fetchList = jest.fn()
    await save()
    const previousSave = wx.saveImageToPhotosAlbum.mock.calls[0][0]
    page.onHide()
    if (leave === "切页") currentPages = [page, {}]
    else app.globalData.nativeActionAppVisible = false
    expect(jest.getTimerCount()).toBe(0)
    currentPages = [page]
    app.globalData.nativeActionAppVisible = true
    page.onShow()
    await save()
    previousSave.success()
    await save()
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(2)
    expect(wx.showToast).not.toHaveBeenCalled()
    wx.saveImageToPhotosAlbum.mock.calls[1][0].fail({ errMsg: "saveImageToPhotosAlbum:fail cancel" })
    await save()
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(3)
  })

  test("原生保存无回执时限时解锁，用户重试不受旧成功回执影响", async () => {
    await save()
    const previousSave = wx.saveImageToPhotosAlbum.mock.calls[0][0]
    jest.advanceTimersByTime(60000)
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "保存未确认，请重试", icon: "none" })
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(1)
    await save()
    previousSave.success()
    await save()
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(2)
    wx.saveImageToPhotosAlbum.mock.calls[1][0].success()
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "海报已保存相册", icon: "success" })
    expect(jest.getTimerCount()).toBe(0)
  })

  if (name === "car-detail") {
    test("远程封面下载期间禁止重复保存，超时关闭遮罩且迟到下载不再写相册", async () => {
      page.data.posterImagePath = "cloud://env/cover.jpg"
      let resolveCover
      page.resolvePosterCover = jest.fn(() => new Promise((resolve) => { resolveCover = resolve }))
      const first = save()
      await save()
      expect(page.resolvePosterCover).toHaveBeenCalledTimes(1)
      jest.advanceTimersByTime(60000)
      expect(wx.hideLoading).toHaveBeenCalledTimes(1)
      expect(wx.saveImageToPhotosAlbum).not.toHaveBeenCalled()
      resolveCover("wxfile://late-cover.jpg")
      await first
      expect(wx.saveImageToPhotosAlbum).not.toHaveBeenCalled()
      page.data.posterImagePath = "wxfile://new-cover.jpg"
      await save()
      expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(1)
    })
  }

  test("拒绝后确认才打开设置，允许后由用户再次保存", async () => {
    await rejectAlbum()
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ confirmText: "去设置", cancelText: "暂不开启" }))
    expect(wx.openSetting).not.toHaveBeenCalled()
    wx.showModal.mock.calls[0][0].success({ confirm: true })
    expect(wx.openSetting).toHaveBeenCalledTimes(1)
    wx.openSetting.mock.calls[0][0].success({ authSetting: { "scope.writePhotosAlbum": true } })
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "已授权，请再次保存", icon: "none" })
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(1)
    await save()
    wx.saveImageToPhotosAlbum.mock.calls[1][0].success()
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "海报已保存相册", icon: "success" })
    expect(name === "car-detail" ? page.data.posterModalVisible : page.data.comparePosterVisible).toBe(false)
  })

  test.each(["cancel", "denied"])("%s 后不循环弹窗或自动重试保存", async (outcome) => {
    await rejectAlbum()
    wx.showModal.mock.calls[0][0].success({ confirm: outcome !== "cancel" })
    if (outcome === "denied") wx.openSetting.mock.calls[0][0].success({ authSetting: { "scope.writePhotosAlbum": false } })
    jest.runOnlyPendingTimers()
    expect(wx.showModal).toHaveBeenCalledTimes(1)
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(1)
    expect(wx.openSetting).toHaveBeenCalledTimes(outcome === "cancel" ? 0 : 1)
  })

  test.each([
    [{ errno: 104, errMsg: "privacy authorization denied" }, "请先同意隐私指引"],
    [{ errMsg: "saveImageToPhotosAlbum:fail privacy permission is not authorized" }, "请先同意隐私指引"],
    [{ errno: 112, errMsg: "api scope is not declared in the privacy agreement" }, "相册功能暂不可用"],
    [{ errMsg: "saveImageToPhotosAlbum:fail appid privacy api banned" }, "相册功能暂不可用"]
  ])("隐私错误 %p 不误导用户修改相册权限", async (error, title) => {
    await rejectAlbum(error)
    expect(wx.showToast).toHaveBeenCalledWith({ title, icon: "none" })
    expect(wx.getSetting).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.openSetting).not.toHaveBeenCalled()
  })

  test("耦合授权拒绝但隐私尚未同意时，不打开相册设置", async () => {
    wx.getPrivacySetting.mockImplementation(({ success }) => success({ needAuthorization: true }))
    await rejectAlbum({ errno: 103, errMsg: "auth deny" })
    expect(wx.showToast).toHaveBeenCalledWith({ title: "请先同意隐私指引", icon: "none" })
    expect(wx.getSetting).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
  })

  test("用户取消系统保存不弹设置或错误提示", async () => {
    await rejectAlbum({ errMsg: "saveImageToPhotosAlbum:fail cancel" })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.getSetting).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
  })

  test.each(["hidden", "unloaded"])("权限读取过程中 %s 不弹出恢复提示", async (state) => {
    wx.getSetting.mockImplementation(() => {})
    await rejectAlbum()
    if (state === "hidden") currentPages = [page, {}]
    else page.onUnload()
    wx.getSetting.mock.calls[0][0].success({ authSetting: { "scope.writePhotosAlbum": false } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
  })

  test.each(["hidden", "unloaded"])("恢复弹窗期间 %s 后的确认不能打开其他页面的设置", async (state) => {
    await rejectAlbum()
    if (state === "hidden") currentPages = [page, {}]
    else page.onUnload()
    wx.showModal.mock.calls[0][0].success({ confirm: true })
    expect(wx.openSetting).not.toHaveBeenCalled()
  })

  test.each(["hidden", "unloaded"])("设置回执在 %s 后不提示、不保存", async (state) => {
    await rejectAlbum()
    wx.showModal.mock.calls[0][0].success({ confirm: true })
    if (state === "hidden") currentPages = [page, {}]
    else page.onUnload()
    wx.openSetting.mock.calls[0][0].success({ authSetting: { "scope.writePhotosAlbum": true } })
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(wx.saveImageToPhotosAlbum).toHaveBeenCalledTimes(1)
  })

  test("打开设置导致页面隐藏后，迟到回执静默，返回可重新保存", async () => {
    await rejectAlbum()
    wx.showModal.mock.calls[0][0].success({ confirm: true })
    page.onHide()
    currentPages = [page, {}]
    currentPages = [page]
    wx.openSetting.mock.calls[0][0].success({ authSetting: { "scope.writePhotosAlbum": true } })
    expect(wx.showToast).not.toHaveBeenCalled()
    await save()
    wx.saveImageToPhotosAlbum.mock.calls[1][0].success()
    expect(wx.showToast).toHaveBeenLastCalledWith({ title: "海报已保存相册", icon: "success" })
  })
})
