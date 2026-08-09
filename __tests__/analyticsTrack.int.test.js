jest.mock("wx-server-sdk")

function loadModule(openid) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  const set = jest.fn().mockResolvedValue({ updated: 1 })
  const doc = jest.fn(() => ({ set }))
  const serverDateValue = { __type: "serverDate" }
  cloud.__setMockDb({
    collection: jest.fn((name) => {
      if (name === "analytics_events") {
        return { doc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate: jest.fn(() => serverDateValue)
  })
  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/analyticsTrack/index")
  })
  return { mod, doc, set, serverDateValue }
}

describe("cloudfunctions/analyticsTrack integration", () => {
  test("只写入事件类型、车辆 ID 和时间", async () => {
    const mocks = loadModule("user_openid")

    const res = await mocks.mod.main({
      eventType: "vehicle_detail",
      vehicleId: "vehicle_1",
      phone: "18800000000",
      userName: "不应写入"
    })

    expect(res).toEqual({ ok: true })
    expect(mocks.doc).toHaveBeenCalledWith(expect.stringMatching(/^analytics_[a-f0-9]{32}$/))
    expect(mocks.set).toHaveBeenCalledWith({
      data: {
        eventType: "vehicle_detail",
        vehicleId: "vehicle_1",
        createdAt: mocks.serverDateValue
      }
    })
    expect(JSON.stringify(mocks.doc.mock.calls)).not.toContain("user_openid")
    expect(JSON.stringify(mocks.set.mock.calls)).not.toContain("user_openid")
    expect(JSON.stringify(mocks.set.mock.calls)).not.toContain("18800000000")
  })

  test("相同账号和事件在 5 秒内只写入一次", async () => {
    const nowSpy = jest.spyOn(Date, "now").mockReturnValue(100000)
    const mocks = loadModule("user_openid")

    const first = mocks.mod.main({
      eventType: "vehicle_detail",
      vehicleId: "vehicle_1"
    })
    const second = mocks.mod.main({
      eventType: "vehicle_detail",
      vehicleId: "vehicle_2"
    })
    const results = await Promise.all([first, second])

    expect(results).toEqual([{ ok: true }, { ok: true }])
    expect(mocks.doc).toHaveBeenCalledTimes(1)
    expect(mocks.set).toHaveBeenCalledTimes(1)
    nowSpy.mockRestore()
  })

  test("写入失败后允许立即重试", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = loadModule("user_openid")
    mocks.set
      .mockRejectedValueOnce(new Error("temporary error"))
      .mockResolvedValueOnce({ updated: 1 })

    const first = await mocks.mod.main({
      eventType: "garage_view"
    })
    const second = await mocks.mod.main({
      eventType: "garage_view"
    })

    expect(first.code).toBe("INTERNAL_ERROR")
    expect(second).toEqual({ ok: true })
    expect(mocks.set).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })

  test("未知事件在写入前被拒绝", async () => {
    const mocks = loadModule("user_openid")

    const res = await mocks.mod.main({
      eventType: "unknown_event"
    })

    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.set).not.toHaveBeenCalled()
  })

  test("费用与档期事件要求车辆 ID，电话与分享允许首页无车辆上下文", async () => {
    const pricingMocks = loadModule("user_pricing")
    const missingVehicle = await pricingMocks.mod.main({ eventType: "pricing_view" })
    expect(missingVehicle.code).toBe("VALIDATION_ERROR")
    expect(pricingMocks.set).not.toHaveBeenCalled()

    const phoneMocks = loadModule("user_phone")
    const phoneResult = await phoneMocks.mod.main({ eventType: "phone_call" })
    expect(phoneResult).toEqual({ ok: true })
    expect(phoneMocks.set).toHaveBeenCalledWith({
      data: {
        eventType: "phone_call",
        vehicleId: "",
        createdAt: phoneMocks.serverDateValue
      }
    })
  })
})
