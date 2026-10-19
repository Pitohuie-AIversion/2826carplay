const {
  buildHandoverReport,
  formatHandoverCsvContent,
  getHandoverFileName
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
    expect(report.mileageKm).toBe(0)
    expect(report.damageNote).toContain("无明显新增划痕")
    expect(report.photos).toHaveLength(0)

    const csv = formatHandoverCsvContent(null, null)
    expect(typeof csv).toBe("string")
    expect(csv.startsWith("\uFEFF")).toBe(true)
  })

  test("buildHandoverReport 正确处理环检损伤项与电子签名签署状态", () => {
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
    expect(report.customerSigned).toBe(true)
    expect(report.customerSignatureUrl).toBe("https://example.com/sig.png")
    expect(report.scratchItems).toHaveLength(2)
    expect(report.scratchSummary).toContain("车身左侧/车门")
    expect(report.scratchSummary).toContain("左前轮毂")
  })
})
