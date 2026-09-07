const { sanitizeAttribution, buildQuery, hasAttribution, isShareLanding } = require("../shared/contentAttribution")

describe("shared/contentAttribution", () => {
  afterEach(() => {
    delete global.getCurrentPages
  })

  test("保留合法的受控来源字段", () => {
    expect(sanitizeAttribution({
      channel: "wechat_share",
      scene: "weekend_trip",
      contentId: "guide_2026",
      vehicleId: "car-1",
      url: "/pages/mine/mine"
    })).toEqual({
      channel: "wechat_share",
      scene: "weekend_trip",
      contentId: "guide_2026",
      vehicleId: "car-1"
    })
  })

  test("丢弃未知、超长和非法参数", () => {
    expect(sanitizeAttribution({
      channel: "unknown",
      scene: "weekend_trip".repeat(20),
      contentId: "../admin",
      vehicleId: "x".repeat(65)
    })).toEqual({ channel: "", scene: "", contentId: "", vehicleId: "" })
  })

  test("只生成白名单查询参数", () => {
    const query = buildQuery({ channel: "qr", contentId: "guide_1", url: "https://bad.example" })
    expect(query).toBe("channel=qr&contentId=guide_1")
    expect(hasAttribution({ channel: "qr" })).toBe(true)
  })

  test("只把页面栈首层识别为分享落地", () => {
    global.getCurrentPages = jest.fn(() => [{ route: "pages/content-page/content-page" }])
    expect(isShareLanding()).toBe(true)
    global.getCurrentPages.mockReturnValue([
      { route: "pages/content-page/content-page" },
      { route: "pages/car-detail/car-detail" }
    ])
    expect(isShareLanding()).toBe(false)
  })
})
