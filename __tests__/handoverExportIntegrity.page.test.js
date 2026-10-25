function loadPage(name) {
  jest.resetModules()
  let definition
  const writes = []
  const files = new Map()
  const fileSystem = {
    writeFile: jest.fn((request) => writes.push(request)),
    unlink: jest.fn(({ filePath, success }) => {
      files.delete(filePath)
      if (success) success()
    })
  }
  global.Page = (config) => { definition = config }
  global.getApp = () => ({ globalData: {} })
  global.wx = {
    showToast: jest.fn(),
    setClipboardData: jest.fn(),
    env: { USER_DATA_PATH: "/user-data" },
    getFileSystemManager: () => fileSystem,
    cloud: { callFunction: jest.fn() }
  }
  require(`../pages/${name}/${name}.js`)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => {
    Object.entries(patch).forEach(([key, value]) => {
      const segments = key.replace(/\[(\d+)\]/g, ".$1").split(".")
      let target = page.data
      segments.slice(0, -1).forEach((segment) => { target = target[segment] })
      target[segments[segments.length - 1]] = value
    })
  })
  global.getCurrentPages = () => [page]
  const handover = {
    id: "handover_1", stage: "pickup", stageText: "取车", status: "submitted",
    mileageKm: 12000, energyType: "fuel", energyLevelPercent: 80,
    damageNote: "右侧原有细微划痕", photos: []
  }
  Object.assign(page.data, {
    id: "booking_1",
    booking: { id: "booking_1", vehicleName: "测试车辆", status: "confirmed" },
    handovers: { pickup: handover, return: {} },
    handoverList: [handover],
    handoverHistory: [handover]
  })
  const completeWrite = (index) => {
    const request = writes[index]
    files.set(request.filePath, request.data)
    request.success()
  }
  return { page, handover, writes, files, fileSystem, completeWrite }
}

describe("交接留证导出的文件与内容完整性", () => {
  beforeEach(() => jest.useFakeTimers().setSystemTime(new Date("2026-10-25T02:00:00.000Z")))
  afterEach(() => {
    jest.clearAllTimers()
    jest.useRealTimers()
    delete global.Page
    delete global.wx
    delete global.getApp
    delete global.getCurrentPages
  })

  describe.each([
    ["客户", "booking-detail", 15000],
    ["顾问", "booking-manage-detail", 20000]
  ])("%s端导出", (_label, name, timeout) => {
    test("真实详情回填将 null 或空白里程与能源显示为未记录", () => {
      const { page, handover } = loadPage(name)
      for (const value of [null, "   "]) {
        const record = { ...handover, mileageKm: value, energyLevelPercent: value }
        if (name === "booking-detail") page.applyBooking(page.data.booking, {}, { pickup: record })
        else page.applyBooking(page.data.booking, {}, {}, [record])
        const displayed = name === "booking-detail" ? page.data.handovers.pickup : page.data.handoverHistory[0]
        expect(displayed.mileageText).toBe("里程未记录")
        expect(displayed.energyText).toBe("能源未记录")
      }
    })

    test("真实详情回填保留数字或字符串明确登记的零里程与零电量", () => {
      const { page, handover } = loadPage(name)
      for (const value of [0, "0"]) {
        const record = { ...handover, mileageKm: value, energyLevelPercent: value, energyType: "electric" }
        if (name === "booking-detail") page.applyBooking(page.data.booking, {}, { pickup: record })
        else page.applyBooking(page.data.booking, {}, {}, [record])
        const displayed = name === "booking-detail" ? page.data.handovers.pickup : page.data.handoverHistory[0]
        expect(displayed.mileageText).toBe("0 km")
        expect(displayed.energyText).toBe("电量 0%")
      }
    })

    test("超时重试成功后旧写入迟到只清理旧文件，保留新文件与入口", () => {
      const { page, handover, writes, files, fileSystem, completeWrite } = loadPage(name)
      page.handleExportHandoverReport()
      expect(page.data.exportingHandover).toBe(true)
      jest.advanceTimersByTime(timeout)
      expect(page.data.exportingHandover).toBe(false)
      handover.damageNote = "补充核验：右侧原有划痕已标注"
      page.handleExportHandoverReport()
      expect(writes).toHaveLength(2)
      expect(writes[1].filePath).not.toBe(writes[0].filePath)
      completeWrite(1)
      const publishedPath = page.data.exportedHandoverPath
      wx.showToast.mockClear()
      completeWrite(0)
      expect(page.data.exportedHandoverPath).toBe(publishedPath)
      expect(files.get(publishedPath)).toBe(writes[1].data)
      expect(files.has(writes[0].filePath)).toBe(false)
      expect(fileSystem.unlink).toHaveBeenCalledTimes(1)
      expect(fileSystem.unlink).toHaveBeenCalledWith(expect.objectContaining({ filePath: writes[0].filePath }))
      expect(wx.showToast).not.toHaveBeenCalled()
      expect(page.data.exportingHandover).toBe(false)
      expect(jest.getTimerCount()).toBe(0)
    })

    test("同一次写入重复成功回调不删除已发布文件或重复提示", () => {
      const { page, writes, files, fileSystem, completeWrite } = loadPage(name)
      page.handleExportHandoverReport()
      completeWrite(0)
      const publishedPath = page.data.exportedHandoverPath
      wx.showToast.mockClear()
      writes[0].success()
      expect(page.data.exportedHandoverPath).toBe(publishedPath)
      expect(files.get(publishedPath)).toBe(writes[0].data)
      expect(fileSystem.unlink).not.toHaveBeenCalled()
      expect(wx.showToast).not.toHaveBeenCalled()
      expect(jest.getTimerCount()).toBe(0)
    })

    test("同毫秒再次导出成功时回收旧文件，写入完成前保留旧文件", () => {
      const { page, writes, files, fileSystem, completeWrite } = loadPage(name)
      page.handleExportHandoverReport()
      completeWrite(0)
      const firstPath = page.data.exportedHandoverPath
      page.handleExportHandoverReport()
      expect(writes[1].filePath).not.toBe(firstPath)
      expect(files.has(firstPath)).toBe(true)
      expect(fileSystem.unlink).not.toHaveBeenCalled()
      completeWrite(1)
      expect(page.data.exportedHandoverPath).toBe(writes[1].filePath)
      expect(files.has(firstPath)).toBe(false)
      expect(files.get(writes[1].filePath)).toBe(writes[1].data)
      expect(files.size).toBe(1)
      expect(fileSystem.unlink).toHaveBeenCalledWith(expect.objectContaining({ filePath: firstPath }))
      expect(jest.getTimerCount()).toBe(0)
    })
  })

  test("客户复制摘要保留实际损伤说明，不被默认环检摘要替换", () => {
    const { page, handover } = loadPage("booking-detail")
    handover.damageNote = "右后车门已有约 5 厘米划痕"
    handover.scratchSummary = "未发现新增环检损伤"
    page.handleCopyHandoverSummary()
    const summary = wx.setClipboardData.mock.calls[0][0].data
    expect(summary).toContain(`外观环检: ${handover.damageNote}`)
    expect(summary).not.toContain("未发现新增环检损伤")
    expect(summary).toContain("交接里程: 12000 km")
    expect(summary).toContain("能源状态: 燃油 80%")
  })

  test.each([undefined, null, ""])("摘要对缺失值 %p 标记未记录，不虚构零值或无损伤结论", (value) => {
    const { page, handover } = loadPage("booking-detail")
    Object.assign(handover, { mileageKm: value, energyLevelPercent: value, damageNote: value, scratchItems: [] })
    page.handleCopyHandoverSummary()
    const summary = wx.setClipboardData.mock.calls[0][0].data
    expect(summary).toContain("交接里程: 未记录")
    expect(summary).toContain("能源状态: 未记录")
    expect(summary).toContain("外观环检: 车况未记录")
    expect(summary).not.toMatch(/交接里程: 0 km|能源状态:.*0%|无.*损伤|未发现.*损伤/)
  })

  test("已明确登记的零里程和零能源仍按实复制", () => {
    const { page, handover } = loadPage("booking-detail")
    Object.assign(handover, { mileageKm: "0", energyLevelPercent: "0", energyType: "electric" })
    page.handleCopyHandoverSummary()
    const summary = wx.setClipboardData.mock.calls[0][0].data
    expect(summary).toContain("交接里程: 0 km")
    expect(summary).toContain("能源状态: 纯电 0%")
  })
})
