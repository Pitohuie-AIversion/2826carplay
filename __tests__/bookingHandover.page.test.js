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
    setData(update) { Object.keys(update).forEach((key) => { this.data[key] = update[key] }) }
  }
  return page
}

describe("Phase 14 预约交接页面", () => {
  afterEach(() => {
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
      complete()
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
