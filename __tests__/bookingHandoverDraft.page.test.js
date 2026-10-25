function createPage() {
  jest.resetModules()
  let definition
  const app = { globalData: {} }
  global.Page = (value) => { definition = value }
  global.getApp = () => app
  global.wx = {
    showToast: jest.fn(),
    showModal: jest.fn(),
    cloud: { callFunction: jest.fn() }
  }
  require("../pages/booking-manage-detail/booking-manage-detail")
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => {
    Object.entries(patch).forEach(([key, value]) => {
      const keys = key.replace(/\[(\d+)\]/g, ".$1").split(".")
      let target = page.data
      keys.slice(0, -1).forEach((segment) => { target = target[segment] })
      target[keys[keys.length - 1]] = value
    })
  })
  Object.assign(page.data, { id: "booking_1", pageAuthorized: true, booking: { status: "confirmed" } })
  page.loadDetail = jest.fn()
  global.getCurrentPages = () => [page]
  return { page, app }
}

function fillHandover(page) {
  Object.assign(page.data.handoverForm, {
    expectedVersion: 2, mileageKm: "12000", energyLevelPercent: "80",
    damageNote: "未发现损伤", additionalNote: "钥匙一把"
  })
  page.data.handoverForm.photos.forEach((photo) => {
    photo.fileId = `cloud://env/handover-images/booking_1/pickup/${photo.angle}.jpg`
    photo.url = `/tmp/${photo.angle}.jpg`
  })
}

const stageEvent = { currentTarget: { dataset: { stage: "return" } } }
const inputEvent = (value) => ({ currentTarget: { dataset: { field: "damageNote" } }, detail: { value } })
const switchAway = (page) => { global.getCurrentPages = () => [page, {}] }
const returnToPage = (page) => { global.getCurrentPages = () => [page]; page.onShow() }

describe("交接草稿切换与管理员后台写入完成", () => {
  beforeEach(() => jest.useFakeTimers())
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.getApp
    delete global.getCurrentPages
    delete global.wx
  })

  test("空白草稿直接切换，不显示放弃提示", () => {
    const { page } = createPage()
    page.handleHandoverStageChange(stageEvent)
    expect(page.data.handoverStage).toBe("return")
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test.each(["text", "energy", "photo"])("%s 草稿取消切换后完整保留，不清理照片", (kind) => {
    const { page } = createPage()
    if (kind === "text") page.handleHandoverInput(inputEvent("车门有划痕"))
    if (kind === "energy") page.handleHandoverEnergyType({ detail: { value: 1 } })
    if (kind === "photo") page.data.handoverForm.photos[0].fileId = "cloud://env/handover-images/booking_1/pickup/front.jpg"
    const before = JSON.stringify(page.data.handoverForm)
    page.handleHandoverStageChange(stageEvent)
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: "切换交接阶段", cancelText: "继续填写" }))
    wx.showModal.mock.calls[0][0].success({ confirm: false })
    expect(page.data.handoverStage).toBe("pickup")
    expect(JSON.stringify(page.data.handoverForm)).toBe(before)
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test("确认切换只清理原预约原阶段的草稿照片，重复回调只执行一次", () => {
    const { page } = createPage()
    fillHandover(page)
    const files = page.data.handoverForm.photos.map((photo) => photo.fileId)
    page._handoverSubmitSnapshot = { key: "old", requestId: "old_request" }
    page.handleHandoverStageChange(stageEvent)
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
    const confirm = wx.showModal.mock.calls[0][0].success
    confirm({ confirm: true })
    confirm({ confirm: true })
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
    expect(wx.cloud.callFunction).toHaveBeenCalledWith(expect.objectContaining({
      data: { action: "cleanupUpload", bookingId: "booking_1", stage: "pickup", fileList: files }
    }))
    expect(page.data.handoverStage).toBe("return")
    expect(page.data.handoverForm.mileageKm).toBe("")
    expect(page.data.handoverForm.photos.every((photo) => !photo.fileId)).toBe(true)
    expect(page._handoverSubmitSnapshot).toBeNull()
  })

  test.each(["edit", "photo", "booking", "stage", "busy", "background", "unload"])("%s 后迟到的切换确认不会清空当前草稿", (change) => {
    const { page } = createPage()
    fillHandover(page)
    page.handleHandoverStageChange(stageEvent)
    const confirm = wx.showModal.mock.calls[0][0].success
    if (change === "edit") page.handleHandoverInput(inputEvent("新增车门划痕"))
    if (change === "photo") page.data.handoverForm.photos[0].fileId = "cloud://env/handover-images/booking_1/pickup/new.jpg"
    if (change === "booking") page.data.id = "booking_2"
    if (change === "stage") page.data.handoverStage = "return"
    if (change === "busy") page.data.handoverLoading = true
    if (change === "background") switchAway(page)
    if (change === "unload") page.onUnload()
    const before = JSON.stringify(page.data.handoverForm)
    page.setData.mockClear()
    wx.cloud.callFunction.mockClear()
    confirm({ confirm: true })
    expect(page.setData).not.toHaveBeenCalled()
    expect(JSON.stringify(page.data.handoverForm)).toBe(before)
    expect(wx.cloud.callFunction).not.toHaveBeenCalled()
  })

  test("连续发起切换确认只接受最新一次", () => {
    const { page } = createPage()
    fillHandover(page)
    page.handleHandoverStageChange(stageEvent)
    page.handleHandoverStageChange(stageEvent)
    wx.showModal.mock.calls[0][0].success({ confirm: true })
    expect(page.data.handoverStage).toBe("pickup")
    wx.showModal.mock.calls[1][0].success({ confirm: true })
    expect(page.data.handoverStage).toBe("return")
    expect(wx.cloud.callFunction).toHaveBeenCalledTimes(1)
  })

  test.each([false, true])("后台提交成功（重复=%s）返回时只交付一次，不误报超时或重复刷新", (duplicate) => {
    const { page } = createPage()
    fillHandover(page)
    page.handleSubmitHandover()
    const request = wx.cloud.callFunction.mock.calls[0][0]
    switchAway(page)
    page.setData.mockClear()
    request.success({ result: { ok: true, duplicate } })
    jest.advanceTimersByTime(25000)
    expect(page.setData).not.toHaveBeenCalled()
    expect(page.data.handoverForm.mileageKm).toBe("12000")
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
    returnToPage(page)
    expect(page.data.handoverLoading).toBe(false)
    expect(page._bookingDetailMutationActive).toBe(false)
    expect(page.data.handoverForm.mileageKm).toBe("")
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
    expect(wx.showToast).toHaveBeenCalledWith({ title: duplicate ? "记录已提交" : "交接记录已提交", icon: "none" })
    request.success({ result: { ok: true } })
    expect(wx.showToast).toHaveBeenCalledTimes(1)
  })

  test.each([
    ["version", "交接记录已更新"],
    ["image", "请重新上传交接图片"],
    ["network", "网络连接已断开"],
    ["timeout", "交接提交超时"],
    ["empty", "提交失败"]
  ])("后台 %s 保留真实失败原因与草稿，返回后允许幂等重试", (kind, title) => {
    const { page } = createPage()
    fillHandover(page)
    const before = JSON.stringify(page.data.handoverForm)
    page.handleSubmitHandover()
    const request = wx.cloud.callFunction.mock.calls[0][0]
    switchAway(page)
    page.setData.mockClear()
    if (kind === "version") request.success({ result: { ok: false, code: "VERSION_CONFLICT" } })
    if (kind === "image") request.success({ result: { ok: false, code: "IMAGE_DELETION_CONFLICT" } })
    if (kind === "network") request.fail({ errMsg: "网络连接已断开" })
    if (kind === "timeout") jest.advanceTimersByTime(20000)
    if (kind === "empty") request.success({ result: null })
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
    returnToPage(page)
    expect(page.data.handoverLoading).toBe(false)
    expect(JSON.stringify(page.data.handoverForm)).toBe(before)
    expect(page.loadDetail).not.toHaveBeenCalled()
    if (kind === "version") {
      expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title }))
      wx.showModal.mock.calls[0][0].success({ confirm: false })
    } else {
      expect(wx.showToast).toHaveBeenCalledWith({ title, icon: "none" })
    }
    page.handleSubmitHandover()
    expect(wx.cloud.callFunction.mock.calls[1][0].data.requestId).toBe(request.data.requestId)
    request.success({ result: { ok: true } })
    expect(page.data.handoverLoading).toBe(true)
    expect(JSON.stringify(page.data.handoverForm)).toBe(before)
  })

  test("应用隐藏但页面仍在栈顶时也延后交付", () => {
    const { page, app } = createPage()
    fillHandover(page)
    page.handleSubmitHandover()
    app.globalData.nativeActionAppVisible = false
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true } })
    page.onShow()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(page.loadDetail).not.toHaveBeenCalled()
    app.globalData.nativeActionAppVisible = true
    page.onShow()
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
  })

  test.each(["before", "after"])("%s 收到后台结果时卸载，均不再交付或遗留定时器", (timing) => {
    const { page } = createPage()
    fillHandover(page)
    page.handleSubmitHandover()
    const request = wx.cloud.callFunction.mock.calls[0][0]
    switchAway(page)
    if (timing === "before") page.onUnload()
    request.success({ result: { ok: false, code: "VERSION_CONFLICT" } })
    if (timing === "after") page.onUnload()
    page.setData.mockClear()
    request.fail({ errMsg: "late failure" })
    expect(page._bookingDetailMutationDeferredResult).toBeNull()
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showModal).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  test.each(["remark", "quote", "tags"])("共享写入 %s 在后台成功后返回才更新已保存状态", (kind) => {
    const { page } = createPage()
    if (kind === "remark") {
      Object.assign(page.data.booking, { adminRemark: "", adminRemarkDraft: "已约好时间" })
      page.data.remarkDirty = true
      page.handleSaveRemark()
    }
    if (kind === "quote") {
      page.data.quoteDirty = true
      page.handleSaveQuoteDraft()
    }
    if (kind === "tags") {
      page.data.booking.tags = []
      page.handleToggleCustomerTag({ currentTarget: { dataset: { tag: "高意向" } } })
    }
    const request = wx.cloud.callFunction.mock.calls[0][0]
    switchAway(page)
    page.setData.mockClear()
    request.success({ result: { ok: true, tags: ["高意向"], quote: { id: "draft_1", revision: 1 } } })
    expect(page.setData).not.toHaveBeenCalled()
    expect(wx.showToast).not.toHaveBeenCalled()
    returnToPage(page)
    expect(page._bookingDetailMutationActive).toBe(false)
    expect(wx.showToast).toHaveBeenCalledTimes(1)
    if (kind === "remark") expect(page.data.remarkDirty).toBe(false)
    if (kind === "quote") {
      expect(page.data.quoteDirty).toBe(false)
      expect(page.data.quoteDraft.id).toBe("draft_1")
    }
    if (kind === "tags") expect(page.data.booking.tags).toEqual(["高意向"])
    expect(page.loadDetail).toHaveBeenCalledTimes(kind === "tags" ? 0 : 1)
  })

  test("状态写入成功保留提醒失败信息，提示的后台完成也延后刷新", () => {
    const { page } = createPage()
    page.updateStatus("completed")
    switchAway(page)
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, notificationStatus: "failed" } })
    expect(wx.showModal).not.toHaveBeenCalled()
    returnToPage(page)
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: "状态已更新" }))
    expect(page._bookingDetailStatusFeedbackPending).toBe(true)
    expect(page.loadDetail).not.toHaveBeenCalled()
    switchAway(page)
    const complete = wx.showModal.mock.calls[0][0].complete
    complete()
    complete()
    expect(page.loadDetail).not.toHaveBeenCalled()
    returnToPage(page)
    expect(page._bookingDetailStatusFeedbackPending).toBe(false)
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
  })

  test("报价发送成功后的提醒完成回调不在后台写入或刷新", () => {
    const { page } = createPage()
    Object.assign(page.data, { quoteDraft: { id: "draft_1", version: 1, revision: 1 }, quoteDirty: false })
    page.handleSendQuote()
    wx.showModal.mock.calls[0][0].success({ confirm: true })
    wx.cloud.callFunction.mock.calls[0][0].success({ result: { ok: true, notificationStatus: "failed" } })
    switchAway(page)
    page.setData.mockClear()
    wx.showModal.mock.calls[1][0].complete()
    expect(page.setData).not.toHaveBeenCalled()
    expect(page.loadDetail).not.toHaveBeenCalled()
    returnToPage(page)
    expect(page.data.quoteLoading).toBe(false)
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
  })
})
