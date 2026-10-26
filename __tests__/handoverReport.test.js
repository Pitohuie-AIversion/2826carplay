const {
  buildHandoverReport,
  formatHandoverCsvContent,
  getHandoverFileName,
  WECHAT_PAY_SCORE_RENTAL_FEE_CATEGORIES,
  normalizeRentalFeeCategory
} = require("../shared/handoverReport")

describe("handoverReport helper", () => {
  const mockBooking = {
    id: "bk-2026-9999",
    vehicleName: "保时捷 911 Carrera S",
    plateNumber: "沪A91100",
    userName: "张先生",
    phone: "13800000000"
  }

  const mockHandover = {
    id: "ho-pickup-001",
    stage: "pickup",
    mileageKm: 12500,
    energyType: "fuel",
    energyLevelPercent: 95,
    damageNote: "左前轮毂有轻微划痕，已核验",
    additionalNote: "满油取还，配备专属随车礼盒",
    submittedAt: "2026-10-01T09:30:00.000Z",
    confirmedAt: "2026-10-01T09:40:00.000Z",
    photos: [
      { angle: "front", fileId: "cloud://env/front.jpg", url: "https://example.com/front.jpg" },
      { angle: "rear", fileId: "cloud://env/rear.jpg", url: "https://example.com/rear.jpg" },
      { angle: "left", fileId: "cloud://env/left.jpg", url: "https://example.com/left.jpg" },
      { angle: "right", fileId: "cloud://env/right.jpg", url: "https://example.com/right.jpg" }
    ]
  }

  test("buildHandoverReport 正确结构化交接单字段", () => {
    const report = buildHandoverReport(mockBooking, mockHandover)

    expect(report.bookingId).toBe("bk-2026-9999")
    expect(report.vehicleName).toBe("保时捷 911 Carrera S")
    expect(report.plateNumber).toBe("沪A91100")
    expect(report.stageText).toBe("取车交验")
    expect(report.mileageKm).toBe(12500)
    expect(report.energyTypeText).toBe("燃油")
    expect(report.energyLevelPercent).toBe(95)
    expect(report.damageNote).toBe("左前轮毂有轻微划痕，已核验")
    expect(report.photos).toHaveLength(4)
    expect(report.photos[0].label).toBe("车头")
  })

  test("formatHandoverCsvContent 生成带 BOM 与完整列头的 CSV 报表", () => {
    const csv = formatHandoverCsvContent(mockBooking, mockHandover)

    expect(csv.startsWith("\uFEFF")).toBe(true)
    expect(csv).toContain("预约单号,车辆名称,车牌号码,交接阶段")
    expect(csv).toContain("保时捷 911 Carrera S")
    expect(csv).toContain("12500")
    expect(csv).toContain("95%")
    expect(csv).toContain("左前轮毂有轻微划痕，已核验")
    expect(csv).toContain("cloud://env/front.jpg")
  })

  test("getHandoverFileName 生成包含阶段和单号的安全文件名", () => {
    const filename = getHandoverFileName(mockBooking, mockHandover)

    expect(filename).toContain("验车留证单_取车")
    expect(filename).toContain("9999")
    expect(filename.endsWith(".csv")).toBe(true)
  })

  test("空值与异常参数优雅降级", () => {
    const report = buildHandoverReport(null, null)

    expect(report.bookingId).toBe("—")
    expect(report.mileageKm).toBeNull()
    expect(report.energyLevelPercent).toBeNull()
    expect(report.damageNote).toBe("车况未记录")
    expect(report.scratchSummary).toBe("")
    expect(report.photos).toHaveLength(0)

    const csv = formatHandoverCsvContent(null, null)
    expect(typeof csv).toBe("string")
    expect(csv.startsWith("\uFEFF")).toBe(true)
  })

  test("buildHandoverReport 保留环检损伤项与内容核对状态", () => {
    const report = buildHandoverReport(mockBooking, {
      ...mockHandover,
      inspectorName: "王管家",
      scratchItems: [
        { part: "left", type: "scratch", description: "长约2cm浅划痕" },
        { part: "wheel_fl", type: "wheel", description: "边缘微擦" }
      ],
      customerSigned: true,
      customerSignatureUrl: "https://example.com/sig.png"
    })

    expect(report.inspectorName).toBe("王管家")
    expect(report.customerConfirmed).toBe(true)
    expect(report.scratchItems).toHaveLength(2)
    expect(report.scratchSummary).toContain("车身左侧/车门")
    expect(report.scratchSummary).toContain("左前轮毂")
  })

  test("已登记损伤不会被默认无损伤环检文案遮盖", () => {
    const report = buildHandoverReport(mockBooking, { ...mockHandover, scratchItems: [] })
    expect(report.damageNote).toBe(mockHandover.damageNote)
    expect(report.scratchSummary).toBe("")
    const csv = formatHandoverCsvContent(mockBooking, { id: "draft", mileageKm: "", energyLevelPercent: "" })
    expect(csv).toContain("车况未记录")
    expect(csv).not.toContain("无明显新增划痕")
    expect(csv).not.toContain("未发现新增")
    expect(csv).not.toContain("0%")
  })

  test.each([null, "", "  ", false, [], {}, -1, Infinity])("异常里程与能源 %p 不转为已测量的零", (value) => {
    const report = buildHandoverReport(mockBooking, { mileageKm: value, energyLevelPercent: value })
    expect(report.mileageKm).toBeNull()
    expect(report.energyLevelPercent).toBeNull()
  })

  test("合法零值保留，坏照片和环检条目不会中断导出", () => {
    const report = buildHandoverReport(mockBooking, {
      mileageKm: "0", energyLevelPercent: 0, energyType: "electric",
      photos: [null, false, [], { angle: "front", fileId: "cloud://front" }],
      scratchItems: [null, false, [], { part: "left", description: "轻微划痕" }]
    })
    expect(report.mileageKm).toBe(0)
    expect(report.energyLevelPercent).toBe(0)
    expect(report.photos).toHaveLength(1)
    expect(report.scratchItems).toHaveLength(1)
  })

  test("内容核对与电子签署区分，任意旧布尔字段不伪造已核对", () => {
    const report = buildHandoverReport(mockBooking, { customerSigned: "false", confirmedAt: "invalid" })
    expect(report.customerConfirmed).toBe(false)
    const csv = formatHandoverCsvContent(mockBooking, mockHandover)
    expect(csv).toContain("客户内容核对状态")
    expect(csv).toContain("已核对")
    expect(csv).not.toContain("已签署")
  })

  test.each(["=1+1", "+SUM(1,1)", "-1+1", "  @SUM(1,1)", "＝1+1", "\t=1+1"])("用户文本 %p 在CSV中按文本保存", (value) => {
    const csv = formatHandoverCsvContent({ ...mockBooking, userName: value }, { ...mockHandover, damageNote: value })
    const escaped = value.replace(/"/g, '""')
    expect(csv).toContain(`'${escaped}`)
  })

  test("同毫秒重复导出仍有独立安全文件名", () => {
    const names = Array.from({ length: 3 }, () => getHandoverFileName({ id: "../a/b:c" }, mockHandover))
    expect(new Set(names).size).toBe(3)
    names.forEach((name) => {
      expect(name).not.toMatch(/[\\/:]/)
      expect(name).toMatch(/^验车留证单_取车_.+\.csv$/)
    })
  })

  test("微信支付分免押租车 8 类官方后付费收费项目严格白名单校验", () => {
    expect(WECHAT_PAY_SCORE_RENTAL_FEE_CATEGORIES).toHaveLength(8)
    expect(WECHAT_PAY_SCORE_RENTAL_FEE_CATEGORIES).toEqual([
      "租车相关费用",
      "延迟还车费用",
      "加油费用",
      "ETC高速费用",
      "车损费用",
      "折旧费用",
      "停运费用",
      "闯红灯违章"
    ])
    expect(Object.isFrozen(WECHAT_PAY_SCORE_RENTAL_FEE_CATEGORIES)).toBe(true)

    // 测试归一化函数
    expect(normalizeRentalFeeCategory("租车相关费用")).toBe("租车相关费用")
    expect(normalizeRentalFeeCategory("超时还车4小时")).toBe("延迟还车费用")
    expect(normalizeRentalFeeCategory("燃油未加满差额")).toBe("加油费用")
    expect(normalizeRentalFeeCategory("纯电补能服务费")).toBe("加油费用")
    expect(normalizeRentalFeeCategory("沪杭高速ETC通行费")).toBe("ETC高速费用")
    expect(normalizeRentalFeeCategory("前杠擦碰钣金修复")).toBe("车损费用")
    expect(normalizeRentalFeeCategory("车辆事故贬值费")).toBe("折旧费用")
    expect(normalizeRentalFeeCategory("修车停工损失")).toBe("停运费用")
    expect(normalizeRentalFeeCategory("高架超速违章代缴")).toBe("闯红灯违章")
    expect(normalizeRentalFeeCategory("未知杂费项目")).toBe("租车相关费用")
    expect(normalizeRentalFeeCategory(null)).toBe("租车相关费用")
    expect(normalizeRentalFeeCategory("")).toBe("租车相关费用")
  })
})
