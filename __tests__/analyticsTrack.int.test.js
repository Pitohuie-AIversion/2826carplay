jest.mock("wx-server-sdk")

function loadModule(openid) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  const add = jest.fn().mockResolvedValue({ _id: "event_1" })
  const serverDateValue = { __type: "serverDate" }
  cloud.__setMockDb({
    collection: jest.fn((name) => {
      if (name === "analytics_events") {
        return { add }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate: jest.fn(() => serverDateValue)
  })
  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/analyticsTrack/index")
  })
  return { mod, add, serverDateValue }
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
    expect(mocks.add).toHaveBeenCalledWith({
      data: {
        eventType: "vehicle_detail",
        vehicleId: "vehicle_1",
        createdAt: mocks.serverDateValue
      }
    })
    expect(JSON.stringify(mocks.add.mock.calls[0][0])).not.toContain("user_openid")
    expect(JSON.stringify(mocks.add.mock.calls[0][0])).not.toContain("18800000000")
  })

  test("未知事件在写入前被拒绝", async () => {
    const mocks = loadModule("user_openid")

    const res = await mocks.mod.main({
      eventType: "unknown_event"
    })

    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.add).not.toHaveBeenCalled()
  })
})
