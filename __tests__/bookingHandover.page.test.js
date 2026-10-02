const fs = require("fs")
const path = require("path")

function loadPage(relativePath, wxOverrides = {}) {
  jest.resetModules()
  let definition
  global.Page = jest.fn((config) => { definition = config })
  global.getApp = jest.fn(() => ({ globalData: {} }))
  global.getCurrentPages = jest.fn(() => [])
  global.wx = {
    showToast: jest.fn(),
    showModal: jest.fn(({ success }) => success({ confirm: true })),
    cloud: { callFunction: jest.fn() },
    ...wxOverrides
  }
  require(relativePath)
  const page = {
    ...definition,
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(update) { Object.keys(update).forEach((key) => {
      const parts = key.replace(/\[(\d+)\]/g, ".$1").split(".")
      let target = this.data
      parts.slice(0, -1).forEach((part) => { target = target[part] })
      target[parts[parts.length - 1]] = update[key]
    }) }
  }
  return page
}

describe("Phase 14 预约交接页面", () => {
  afterEach(() => {
    jest.useRealTimers()
    delete global.Page
    delete global.getApp
    delete global.getCurrentPages
    delete global.wx
  })

  test("顾问端提交四角记录并复用同一云函数", () => {
    const callFunction = jest.fn(({ name, data, success, complete }) => {
      expect(name).toBe("bookingHandover")
      expect(data).toMatchObject({ action: "submit", bookingId: "booking_1", stage: "pickup", mileageKm: 12000, energyLevelPercent: 80 })
      expect(data.photos.map((item) => item.angle)).toEqual(["front", "rear", "left", "right"])
      success({ result: { ok: true, version: 1 } })
      if (complete) complete()
    })
    const page = loadPage("../pages/booking-manage-detail/booking-manage-detail.js", { cloud: { callFunction } })
    page.data.id = "booking_1"
    page.data.booking = { status: "confirmed" }
    page.data.handoverForm = {
      mileageKm: "12000", energyType: "fuel", energyLevelPercent: "80",
      damageNote: "未发现已知损伤", additionalNote: "钥匙一把",
      photos: ["front", "rear", "left", "right"].map((angle) => ({ angle, fileId: `cloud://env/handover-images/booking_1/pickup/${angle}.jpg`, url: "temp" }))
    }
    page.loadDetail = jest.fn()

    page.handleSubmitHandover()

    expect(callFunction).toHaveBeenCalledTimes(1)
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
    expect(page.data.handoverForm.photos.every((item) => !item.fileId)).toBe(true)
  })

  test("用户端确认文案明确内容核对边界", () => {
    const callFunction = jest.fn(({ data, success, complete }) => {
      expect(data).toEqual({ action: "confirm", bookingId: "booking_1", handoverId: "handover_1", stage: "pickup" })
      success({ result: { ok: true, duplicate: false } })
      complete()
    })
    const showModal = jest.fn(({ content, success }) => {
      expect(content).toContain("不是电子签章或合同签署")
      success({ confirm: true })
    })
    const page = loadPage("../pages/booking-detail/booking-detail.js", { cloud: { callFunction }, showModal })
    page.data.id = "booking_1"
    page.data.handovers = { pickup: { id: "handover_1", stageText: "取车", status: "submitted" }, return: {} }
    page.loadDetail = jest.fn()

    page.handleConfirmHandover({ currentTarget: { dataset: { stage: "pickup" } } })

    expect(callFunction).toHaveBeenCalledTimes(1)
    expect(page.loadDetail).toHaveBeenCalledTimes(1)
  })

  test("同毫秒上传同角度仍使用不同云路径，旧图清理同步异常不丢失新图", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-09-30T00:00:00Z"))
    const uploadFile = jest.fn(({ cloudPath, success }) => success({ fileID: `cloud://env/${cloudPath}` }))
    const page = loadPage("../pages/booking-manage-detail/booking-manage-detail.js", {
      chooseImage: jest.fn(({ success }) => success({ tempFilePaths: ["temp/front.jpg"], tempFiles: [{ size: 100 }] })),
      cloud: { uploadFile, callFunction: jest.fn(() => { throw new Error("cleanup SDK unavailable") }) }
    })
    page.data.id = "booking_1"
    page.data.booking = { status: "confirmed" }
    const event = { currentTarget: { dataset: { angle: "front" } } }
    page.handleChooseHandoverPhoto(event)
    const first = page.data.handoverForm.photos[0].fileId
    expect(() => page.handleChooseHandoverPhoto(event)).not.toThrow()
    expect(uploadFile).toHaveBeenCalledTimes(2)
    expect(uploadFile.mock.calls[0][0].cloudPath).not.toBe(uploadFile.mock.calls[1][0].cloudPath)
    expect(page.data.handoverForm.photos[0].fileId).not.toBe(first)
    expect(page.data.handoverLoading).toBe(false)
    expect(() => page.onUnload()).not.toThrow()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("被清理图片提交受阻时提示重新上传，保留其他交接字段", () => {
    const page = loadPage("../pages/booking-manage-detail/booking-manage-detail.js", {
      cloud: { callFunction: jest.fn(({ success }) => success({ result: { ok: false, code: "IMAGE_DELETION_CONFLICT" } })) }
    })
    page.data.id = "booking_1"
    page.data.booking = { status: "confirmed" }
    Object.assign(page.data.handoverForm, { mileageKm: "12000", energyLevelPercent: "80", damageNote: "未发现损伤" })
    page.data.handoverForm.photos.forEach((photo) => { photo.fileId = `cloud://env/handover-images/booking_1/pickup/${photo.angle}.jpg` })
    page.handleSubmitHandover()
    expect(wx.showToast).toHaveBeenCalledWith({ title: "请重新上传交接图片", icon: "none" })
    expect(page.data.handoverForm.mileageKm).toBe("12000")
    expect(page.data.handoverLoading).toBe(false)
  })

  test("历史暂不可用时当前取还车仍可完成核对，恢复后清除提示", () => {
    const page = loadPage("../pages/booking-manage-detail/booking-manage-detail.js")
    const booking = { latestPickupHandoverId: "pickup_45", latestReturnHandoverId: "return_1", status: "confirmed" }
    const handovers = [{ id: "pickup_45", stage: "pickup", status: "confirmed" }, { id: "return_1", stage: "return", status: "confirmed" }]
    page.applyBooking(booking, {}, {}, handovers, true)
    expect(page.data.handoverReadyForCompletion).toBe(true)
    expect(page.data.handoverHistoryUnavailable).toBe(true)
    page.applyBooking(booking, {}, {}, handovers, false)
    expect(page.data.handoverHistoryUnavailable).toBe(false)
  })

  test("交接填写时固定版本，详情后续更新不能把旧表单当成新版本提交", () => {
    const callFunction = jest.fn(({ success }) => success({ result: { ok: false, code: "VERSION_CONFLICT" } }))
    const page = loadPage("../pages/booking-manage-detail/booking-manage-detail.js", { cloud: { callFunction }, showModal: jest.fn(({ success }) => success({ confirm: false })) })
    page.data.id = "booking_1"
    page.data.booking = { status: "confirmed", latestPickupHandoverVersion: 1 }
    page.handleHandoverInput({ currentTarget: { dataset: { field: "mileageKm" } }, detail: { value: "12000" } })
    page.data.handoverForm.energyLevelPercent = "80"
    page.data.handoverForm.damageNote = "未发现损伤"
    page.data.handoverForm.photos.forEach((photo) => { photo.fileId = `cloud://env/handover-images/booking_1/pickup/${photo.angle}.jpg` })
    page.data.booking.latestPickupHandoverVersion = 2
    page.handleSubmitHandover()
    expect(callFunction.mock.calls[0][0].data.expectedVersion).toBe(1)
    expect(page.data.handoverForm.mileageKm).toBe("12000")
    expect(page.data.handoverForm.expectedVersion).toBe(1)
    expect(wx.showModal).toHaveBeenCalledWith(expect.objectContaining({ title: "交接记录已更新", cancelText: "保留输入" }))
  })

  test("客户核对无响应可重试，卸载后失败回调保持静默", () => {
    jest.useFakeTimers()
    const requests = []
    const page = loadPage("../pages/booking-detail/booking-detail.js", { cloud: { callFunction: jest.fn((request) => requests.push(request)) } })
    page.data.id = "booking_1"
    page.data.handovers.pickup = { id: "handover_1", stageText: "取车", status: "submitted" }
    page.loadDetail = jest.fn()
    const event = { currentTarget: { dataset: { stage: "pickup" } } }
    page.handleConfirmHandover(event)
    expect(page.data.handoverResponding).toBe(true)
    jest.advanceTimersByTime(12000)
    expect(page.data.handoverResponding).toBe(false)
    requests[0].success({ result: { ok: true } })
    expect(page.loadDetail).not.toHaveBeenCalled()
    page.handleConfirmHandover(event)
    page.onUnload()
    wx.showToast.mockClear()
    requests[1].fail(new Error("late failure"))
    requests[1].complete()
    expect(wx.showToast).not.toHaveBeenCalled()
    expect(jest.getTimerCount()).toBe(0)
  })

  test("客户核对接口同步异常会恢复按钮并清除计时器", () => {
    jest.useFakeTimers()
    const page = loadPage("../pages/booking-detail/booking-detail.js", { cloud: { callFunction: jest.fn(() => { throw new Error("sdk failure") }) } })
    page.data.id = "booking_1"
    page.data.handovers.pickup = { id: "handover_1", stageText: "取车", status: "submitted" }
    expect(() => page.handleConfirmHandover({ currentTarget: { dataset: { stage: "pickup" } } })).not.toThrow()
    expect(page.data.handoverResponding).toBe(false)
    expect(jest.getTimerCount()).toBe(0)
  })

  test("双端模板包含交接边界、私有照片和人工救援提示", () => {
    const root = path.resolve(__dirname, "..")
    const adminWxml = fs.readFileSync(path.join(root, "pages/booking-manage-detail/booking-manage-detail.wxml"), "utf8")
    const userWxml = fs.readFileSync(path.join(root, "pages/booking-detail/booking-detail.wxml"), "utf8")
    expect(adminWxml).toContain("handoverForm.photos")
    expect(adminWxml).toContain("归档并清理照片")
    expect(userWxml).toContain("不是电子签章、合同签署、自动定损、扣款或维修报价")
    expect(userWxml).toContain("不提供实时调度、定位跟踪或到达时间承诺")
  })
})
