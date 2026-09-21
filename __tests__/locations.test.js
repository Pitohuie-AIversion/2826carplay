const {
  CITY_HUBS_MAP,
  DEFAULT_FALLBACK_HUBS,
  getCityHubs,
  getDefaultHub,
  formatLocationDisplay,
  normalizeBookingLocation
} = require("../shared/locations")

describe("shared/locations 结构化网点与接送调度模块", () => {
  test("可获取核心运营城市的预设接送枢纽与自提门店", () => {
    const shHubs = getCityHubs("上海")
    expect(Array.isArray(shHubs)).toBe(true)
    expect(shHubs.length).toBeGreaterThanOrEqual(3)
    expect(shHubs.some((h) => h.name.includes("虹桥"))).toBe(true)
    expect(shHubs.some((h) => h.name.includes("浦东"))).toBe(true)

    const bjHubs = getCityHubs("北京")
    expect(bjHubs.some((h) => h.name.includes("大兴") || h.name.includes("首都"))).toBe(true)
  })

  test("未知城市提供安全通用的默认备用网点", () => {
    const unknownHubs = getCityHubs("拉萨")
    expect(unknownHubs).toEqual(DEFAULT_FALLBACK_HUBS)

    const emptyHubs = getCityHubs("")
    expect(emptyHubs).toEqual(DEFAULT_FALLBACK_HUBS)
  })

  test("能够正确获取指定城市的默认首选网点", () => {
    const defSh = getDefaultHub("上海")
    expect(defSh.name).toContain("虹桥")

    const defUnknown = getDefaultHub("未知")
    expect(defUnknown.id).toBe("gen-store")
  })

  test("地址展示能够优雅组合城市与网点名称", () => {
    expect(formatLocationDisplay("虹桥国际机场", "上海")).toBe("上海 · 虹桥国际机场")
    expect(formatLocationDisplay("上海 · 虹桥国际机场", "上海")).toBe("上海 · 虹桥国际机场")
    expect(formatLocationDisplay("", "杭州")).toBe("杭州 · 门店自提")
    expect(formatLocationDisplay("", "")).toBe("门店自提")
  })

  test("规范化预约单中的网点数据并防止异常超长", () => {
    expect(normalizeBookingLocation(" 萧山国际机场  ", "杭州")).toBe("萧山国际机场")
    expect(normalizeBookingLocation("", "上海")).toBe(CITY_HUBS_MAP["上海"][0].name)
    const longString = "A".repeat(100)
    expect(normalizeBookingLocation(longString, "上海")).toHaveLength(60)
  })
})
