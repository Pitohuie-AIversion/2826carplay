jest.mock("wx-server-sdk")

function load() {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "user_1" })
  const set = jest.fn().mockResolvedValue({})
  cloud.__setMockDb({
    collection: jest.fn(() => ({ doc: jest.fn(() => ({ set })) })),
    serverDate: jest.fn(() => ({ __type: "serverDate" }))
  })
  let mod
  jest.isolateModules(() => { mod = require("../cloudfunctions/analyticsTrack/index") })
  return { mod, set }
}

describe("Phase 16 server analytics validation", () => {
  test("内容事件仅保存匿名白名单字段", async () => {
    const { mod, set } = load()
    const res = await mod.main({
      eventType: "content_booking_submit",
      contentId: "guide_1",
      vehicleId: "car_1",
      channel: "wechat_share",
      scene: "weekend_trip",
      phone: "13800000000",
      note: "private"
    })
    expect(res.ok).toBe(true)
    const data = set.mock.calls[0][0].data
    expect(data).toMatchObject({ eventType: "content_booking_submit", contentId: "guide_1", vehicleId: "car_1", channel: "wechat_share", scene: "weekend_trip" })
    expect(JSON.stringify(data)).not.toContain("13800000000")
    expect(data).not.toHaveProperty("note")
  })

  test("未知渠道和非法内容标识在写入前拒绝", async () => {
    const { mod, set } = load()
    expect((await mod.main({ eventType: "content_view", contentId: "../admin" })).code).toBe("VALIDATION_ERROR")
    expect((await mod.main({ eventType: "content_view", contentId: "guide_1", channel: "unknown" })).code).toBe("VALIDATION_ERROR")
    expect(set).not.toHaveBeenCalled()
  })
})
