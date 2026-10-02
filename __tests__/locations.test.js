const { getCityHubs, getDefaultHub, resolveServiceHub, hasHubCoordinates, formatLocationDisplay, normalizeBookingLocation } = require("../shared/locations")

const hubs = [
  { id: "sh-store", city: "上海", name: "保存的上海门店", address: "上海门店真实地址", type: "store", latitude: 31.2, longitude: 121.4 },
  { id: "sh-hub", city: "上海", name: "保存的上海接送点", address: "上海接送点真实地址", type: "hub" },
  { id: "hz-store", city: "杭州", name: "保存的杭州门店", address: "杭州门店真实地址", type: "store" }
]

describe("已保存服务网点", () => {
  test("只列出指定城市已保存网点，空或未知城市不生成备用地址", () => {
    expect(getCityHubs("上海市", hubs).map((hub) => hub.id)).toEqual(["sh-store", "sh-hub"])
    expect(getDefaultHub("上海", hubs).id).toBe("sh-store")
    expect(getCityHubs("上海")).toEqual([])
    expect(getCityHubs("未知", hubs)).toEqual([])
    expect(getCityHubs("", hubs)).toEqual([])
    expect(getDefaultHub("未知", hubs)).toBeNull()
    getCityHubs("上海", hubs)[0].name = "临时编辑"
    expect(hubs[0].name).toBe("保存的上海门店")
  })

  test("导航精确匹配编号、名称、地址；历史未知地址不回退到其它门店", () => {
    for (const location of [hubs[0].id, hubs[0].name, hubs[0].address]) {
      expect(resolveServiceHub(location, "上海", hubs)).toEqual(hubs[0])
    }
    expect(resolveServiceHub("保存的上海", "上海", hubs)).toBeNull()
    expect(resolveServiceHub("旧地址已撤销", "上海", hubs)).toBeNull()
    expect(resolveServiceHub(hubs[0].name, "杭州", hubs)).toBeNull()
    expect(resolveServiceHub("", "上海", hubs)).toBeNull()
  })

  test("仅有城市时，只允许唯一已保存门店且拒绝歧义", () => {
    expect(resolveServiceHub("上海市", "", hubs)).toEqual(hubs[0])
    expect(resolveServiceHub("上海", "上海", [...hubs, { ...hubs[0], id: "another" }])).toBeNull()
    expect(resolveServiceHub("上海", "上海", [hubs[1]])).toBeNull()
    expect(resolveServiceHub("上海", "杭州", hubs)).toBeNull()
    expect(resolveServiceHub(hubs[0].name, "", [...hubs, { ...hubs[0], city: "北京" }])).toBeNull()
  })

  test("导航要求成对有效坐标，缺失、空白和非法值不能转成零坐标", () => {
    expect(hasHubCoordinates(hubs[0])).toBe(true)
    expect(hasHubCoordinates({ latitude: 0, longitude: "0" })).toBe(true)
    for (const hub of [null, {}, { latitude: 31.2, longitude: null }, { latitude: "", longitude: "" }, { latitude: " ", longitude: " " }, { latitude: false, longitude: false }, { latitude: 91, longitude: 181 }, { latitude: "NaN", longitude: 121.4 }]) {
      expect(hasHubCoordinates(hub)).toBe(false)
    }
  })

  test("已保存网点正常展示，缺失地点明确待确认且不生成地址", () => {
    expect(formatLocationDisplay("已约定网点", "上海")).toBe("上海 · 已约定网点")
    expect(formatLocationDisplay("上海 · 已约定网点", "上海")).toBe("上海 · 已约定网点")
    expect(formatLocationDisplay("", "杭州")).toBe("杭州 · 取车地点待确认")
    expect(formatLocationDisplay("", "")).toBe("取车地点待确认")
    expect(normalizeBookingLocation("  已保存地址  ")).toBe("已保存地址")
    expect(normalizeBookingLocation("", "上海")).toBe("")
    expect(normalizeBookingLocation("A".repeat(100))).toHaveLength(60)
  })
})
