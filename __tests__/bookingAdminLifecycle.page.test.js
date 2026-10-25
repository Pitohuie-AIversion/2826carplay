function loadPage(name, overrides = {}) {
  jest.resetModules()
  let definition
  global.Page = (value) => { definition = value }
  global.getApp = () => ({ globalData: {} })
  global.wx = { showToast: jest.fn(), showModal: jest.fn(), cloud: { callFunction: jest.fn() }, ...overrides }
  const path = name === "operations-overview" ? `../pages-admin/${name}/${name}` : `../pages/${name}/${name}`
  require(path)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => {
    Object.entries(patch).forEach(([key, value]) => {
      const keys = key.replace(/\[(\d+)\]/g, ".$1").split(".")
      let current = page.data
      keys.slice(0, -1).forEach((segment) => { current = current[segment] })
      current[keys[keys.length - 1]] = value
    })
  })
  global.getCurrentPages = () => [page]
  return page
}

function setHandover(page) {
  Object.assign(page.data, {
    id: "booking_1", booking: { status: "confirmed" }, handoverStage: "pickup",
    handoverForm: { mileageKm: "12000", energyLevelPercent: "80", energyType: "fuel", damageNote: "无损伤", additionalNote: "",
      photos: ["front", "rear", "left", "right"].map((angle) => ({ angle, fileId: `cloud://env/handover-images/booking_1/pickup/${angle}.jpg` })) }
  })
}

describe("管理员预约原生动作与写入恢复", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  test("预约列表软键盘搜索使用确认事件最新值，清空也立即请求", () => {
    const page = loadPage("booking-manage")
    page.data.keyword = "旧词"
    page.fetchList = jest.fn()
    page.handleSearchConfirm({ detail: { value: "最新输入" } })
    expect(page.fetchList).toHaveBeenLastCalledWith({ keyword: "最新输入" })
    page.handleClearKeyword()
    expect(page.fetchList).toHaveBeenLastCalledWith({ keyword: "" })
  })

  test("工作台软键盘搜索显式使用最新词过滤，不等待状态渲染", () => {
    const page = loadPage("booking-workbench")
    page.data.keyword = "旧词"
    page.data.allBookings = [
      { id: "one", status: "pending", vehicleName: "保时捷" },
      { id: "two", status: "pending", vehicleName: "法拉利" }
    ]
    const setData = page.setData
    page.setData = jest.fn((patch) => { if (Object.keys(patch).length > 1) setData(patch) })
    page.handleSearchConfirm({ detail: { value: "法拉利" } })
    expect(page.data.queue.map((item) => item.id)).toEqual(["two"])
  })

  test("工作台确认菜单切页后不写入，返回后解除按钮忙碌状态", () => {
    const page = loadPage("booking-workbench")
    page.data.loading = false
    page.handleMarkContacted({ currentTarget: { dataset: { id: "booking_1", status: "pending" } } })
    global.getCurrentPages = () => [{}]
    wx.showModal.mock.calls[0][0].success({ confirm: true })
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.statusUpdatingId).toBe("")
  })

  test("留证单导出超时解除忙碌，迟到文件不会回填", () => {
    const writeFile = jest.fn()
    const unlink = jest.fn()
    const page = loadPage("booking-manage-detail", { env: { USER_DATA_PATH: "/tmp" }, getFileSystemManager: () => ({ writeFile, unlink }) })
    page.handleExportHandoverReport()
    jest.advanceTimersByTime(20001)
    expect(page.data.exportingHandover).toBe(false)
    writeFile.mock.calls[0][0].success()
    expect(page.data.exportedHandoverPath).toBe("")
    expect(unlink).toHaveBeenCalled()
  })

  test("交接图片选择期间返回页面不会刷新覆盖表单，卸载后不启动上传", () => {
    const chooseImage = jest.fn()
    const uploadFile = jest.fn()
    const page = loadPage("booking-manage-detail", { chooseImage, cloud: { uploadFile, callFunction: jest.fn() } })
    page.data.id = "booking_1"
    page.data.pageAuthorized = true
    page.loadDetail = jest.fn()
    page.handleChooseHandoverPhoto({ currentTarget: { dataset: { angle: "front" } } })
    expect(page.data.handoverLoading).toBe(true)
    page.onShow()
    expect(page.loadDetail).not.toHaveBeenCalled()
    page.onUnload()
    chooseImage.mock.calls[0][0].success({ tempFilePaths: ["/tmp/front.jpg"] })
    expect(uploadFile).not.toHaveBeenCalled()
  })

  test("迟到的上传结果会清理云文件，不回填已卸载的表单", () => {
    const uploadFile = jest.fn()
    const callFunction = jest.fn()
    const page = loadPage("booking-manage-detail", {
      chooseImage: ({ success }) => success({ tempFilePaths: ["/tmp/front.jpg"] }),
      cloud: { uploadFile, callFunction }
    })
    page.data.id = "booking_1"
    page.handleChooseHandoverPhoto({ currentTarget: { dataset: { angle: "front" } } })
    page.onUnload()
    page.setData.mockClear()
    uploadFile.mock.calls[0][0].success({ fileID: "cloud://env/handover-images/booking_1/pickup/late.jpg" })
    expect(page.setData).not.toHaveBeenCalled()
    expect(callFunction).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "cleanupUpload", bookingId: "booking_1", stage: "pickup" }) }))
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("交接提交超时重试复用请求号，旧回调不重置重试中的表单", () => {
    const page = loadPage("booking-manage-detail")
    setHandover(page)
    page.loadDetail = jest.fn()
    page.handleSubmitHandover()
    const first = wx.cloud.callFunction.mock.calls[0][0]
    jest.advanceTimersByTime(20001)
    expect(page.data.handoverLoading).toBe(false)
    page.handleSubmitHandover()
    const second = wx.cloud.callFunction.mock.calls[1][0]
    expect(second.data.requestId).toBe(first.data.requestId)
    first.success({ result: { ok: true } })
    expect(page.data.handoverLoading).toBe(true)
    expect(page.data.handoverForm.photos[0].fileId).not.toBe("")
    second.success({ result: { ok: true, duplicate: true } })
    expect(page.data.handoverLoading).toBe(false)
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
  })

  test("标签以服务端成功为准，失败与重复点击不产生本地假保存", () => {
    const page = loadPage("booking-manage-detail")
    page.data.id = "booking_1"
    page.data.booking = { status: "contacted", tags: ["高意向"] }
    const event = { currentTarget: { dataset: { tag: "高意向" } } }
    page.handleToggleCustomerTag(event)
    page.handleToggleCustomerTag(event)
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(page.data.booking.tags).toEqual(["高意向"])
    wx.cloud.callFunction.mock.calls[0][0].fail(new Error("offline"))
    expect(page.data.booking.tags).toEqual(["高意向"])
    page.handleToggleCustomerTag(event)
    wx.cloud.callFunction.mock.calls[1][0].success({ result: { ok: true, tags: [] } })
    expect(page.data.booking.tags).toEqual([])
  })

  test.each([undefined, [], ["老客户"], [" 老客户 "]])("标签并发基线使用服务端原值 %p，冲突不改展示或基线", (tags) => {
    const page = loadPage("booking-manage-detail")
    page.data.id = "booking_1"
    page.loadDetail()
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, detail: {
      id: "booking_1", status: "contacted", city: "杭州", pickupLocation: "送车上门",
      ...(tags === undefined ? {} : { tags })
    } } })
    const displayed = page.data.booking.tags.slice()
    const event = { currentTarget: { dataset: { tag: "高意向" } } }
    page.handleToggleCustomerTag(event)
    const request = wx.cloud.callFunction.mock.calls[1][0]
    expect(request.data.expectedValues.tags).toEqual(tags === undefined ? null : tags)
    request.success({ result: { ok: false, code: "VERSION_CONFLICT", message: "标签已更新，请刷新" } })
    expect(page.data.booking.tags).toEqual(displayed)
    expect(page.data.booking.tagBaseline).toEqual(tags === undefined ? null : tags)
    page.handleToggleCustomerTag(event)
    wx.cloud.callFunction.mock.calls[2][0].success({ result: { ok: true, tags: ["高意向"] } })
    expect(page.data.booking.tags).toEqual(["高意向"])
    page.handleToggleCustomerTag(event)
    expect(wx.cloud.callFunction.mock.calls[3][0].data.expectedValues.tags).toEqual(["高意向"])
    page.onUnload()
  })

  test("报价草稿未保存时 onShow 与刷新加载都保留草稿", () => {
    const page = loadPage("booking-manage-detail")
    Object.assign(page.data, { id: "booking_1", pageAuthorized: true, quoteDirty: true })
    page.onShow()
    page.loadDetail()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test.each([true, false])("报价草稿存在时协调保存 changed=%s 立即回填真实结果和下次版本基线", (changed) => {
    const page = loadPage("booking-manage-detail")
    Object.assign(page.data, {
      id: "booking_1", quoteDirty: true, coordinationEditable: true,
      quoteForm: { baseRentalAmount: "1234.50", customerNote: "未保存报价" },
      booking: { status: "contacted", schedulePriority: "normal", coordinationStatus: "pending" }
    })
    const quoteBefore = { ...page.data.quoteForm }
    page.handleUpdateCoordination({ currentTarget: { dataset: { field: "schedulePriority", value: "priority" } } })
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, changed, schedulePriority: "priority", coordinationStatus: "coordinating" } })
    expect(page.data.booking.schedulePriority).toBe("priority")
    expect(page.data.booking.coordinationStatus).toBe("coordinating")
    expect(page.data.quoteDirty).toBe(true)
    expect(page.data.quoteForm).toEqual(quoteBefore)
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    page.handleUpdateCoordination({ currentTarget: { dataset: { field: "schedulePriority", value: "standby" } } })
    expect(wx.cloud.callFunction.mock.calls[1][0].data.expectedValues).toEqual({ schedulePriority: "priority" })
    page.onUnload()
  })

  test.each([false, true])("备注保存成功在报价草稿旁更新基线，后台返回=%s", (background) => {
    const page = loadPage("booking-manage-detail")
    Object.assign(page.data, {
      id: "booking_1", quoteDirty: true, remarkDirty: true,
      quoteForm: { baseRentalAmount: "4567.00", customerNote: "未保存方案" },
      booking: { status: "contacted", adminRemark: "原备注", adminRemarkDraft: "新备注" }
    })
    const quoteBefore = { ...page.data.quoteForm }
    page.handleSaveRemark()
    if (background) global.getCurrentPages = () => [page, {}]
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, adminRemark: "服务端确认的新备注" } })
    if (background) {
      expect(page.data.booking.adminRemark).toBe("原备注")
      global.getCurrentPages = () => [page]
      page.onShow()
    }
    expect(page.data.booking.adminRemark).toBe("服务端确认的新备注")
    expect(page.data.booking.adminRemarkDraft).toBe("服务端确认的新备注")
    expect(page.data.remarkDirty).toBe(false)
    expect(page.data.quoteDirty).toBe(true)
    expect(page.data.quoteForm).toEqual(quoteBefore)
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    page.handleRemarkInput({ detail: { value: "再次修改" } })
    page.handleSaveRemark()
    expect(wx.cloud.callFunction.mock.calls[1][0].data.expectedAdminRemark).toBe("服务端确认的新备注")
    page.onUnload()
  })

  test("后台 CSV 分享失败不提示也不自动打开文件", () => {
    const shareFileMessage = jest.fn()
    const openDocument = jest.fn()
    const page = loadPage("booking-manage", { shareFileMessage, openDocument })
    Object.assign(page.data, { exportFilePath: "/tmp/report.csv", exportFileName: "report.csv" })
    page.handleShareExportedFile()
    global.getCurrentPages = () => [{}]
    shareFileMessage.mock.calls[0][0].fail({ errMsg: "must use tap gesture" })
    expect(openDocument).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
  })

  test("后台 CSV 写入完成时清理临时文件，返回页面恢复可操作状态", async () => {
    const writeFile = jest.fn()
    const unlink = jest.fn(({ success }) => { if (success) success() })
    const page = loadPage("booking-manage", { env: { USER_DATA_PATH: "/tmp" }, getFileSystemManager: () => ({ writeFile, unlink }) })
    page.handleExport()
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, csvText: "a,b", fileName: "report.csv" } })
    global.getCurrentPages = () => [{}]
    page.setData.mockClear()
    writeFile.mock.calls[0][0].success()
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(page.setData).not.toHaveBeenCalled()
    expect(unlink).toHaveBeenCalledWith(expect.objectContaining({ filePath: writeFile.mock.calls[0][0].filePath }))
    expect(wx.showToast).not.toHaveBeenCalled()
    global.getCurrentPages = () => [page]
    page.onShow()
    expect(page.data.loading).toBe(false)
    expect(page.data.exportFilePath).toBe("")
  })

  test("留证单删除失败保留文件路径以便重试", () => {
    const page = loadPage("booking-manage-detail", { getFileSystemManager: () => ({ unlink: ({ fail }) => fail() }) })
    page.data.exportedHandoverPath = "/tmp/proof.csv"
    page.handleDeleteExportedHandover()
    expect(page.data.exportedHandoverPath).toBe("/tmp/proof.csv")
  })

  test("运营概览卸载主动清除每个数据源的超时计时器", async () => {
    const page = loadPage("operations-overview")
    Object.assign(page.data, { canManageVehicles: true, canManageBookings: true, canManageRoles: true })
    page.loadOverview()
    expect(jest.getTimerCount()).toBe(3)
    page.onUnload()
    page.setData.mockClear()
    expect(jest.getTimerCount()).toBe(0)
    await Promise.resolve()
    await Promise.resolve()
    expect(page.setData).not.toHaveBeenCalled()
  })
})
