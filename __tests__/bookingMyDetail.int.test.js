jest.mock("wx-server-sdk")

function createMockDb({ bookingData, handovers = [] }) {
  const get = jest.fn().mockResolvedValue({ data: bookingData })
  const field = jest.fn(() => ({ get }))
  const doc = jest.fn(() => ({ field }))
  const handoverDoc = jest.fn((id) => ({ get: async () => ({ data: handovers.find((record) => record._id === id) || null }) }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "bookings") {
        return { doc }
      }
      if (name === "booking_handovers") return { doc: handoverDoc }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    doc,
    field,
    handoverDoc
  }
}

async function loadBookingMyDetailWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingMyDetail/index")
  })

  return mod
}

describe("cloudfunctions/bookingMyDetail integration", () => {
  test("超过40条历史仍按当前两个交接ID读取，拒绝其他预约或阶段记录", async () => {
    const handovers = Array.from({ length: 45 }, (_, index) => ({ _id: `pickup_${index + 1}`, bookingId: "booking_1", stage: "pickup", version: index + 1, status: "confirmed", photos: [] }))
    handovers.push({ _id: "return_1", bookingId: "booking_1", stage: "return", version: 1, status: "confirmed", photos: [] })
    const mocks = createMockDb({ bookingData: { _id: "booking_1", openid: "user", latestPickupHandoverId: "pickup_45", latestReturnHandoverId: "return_1" }, handovers })
    const mod = await loadBookingMyDetailWith({ openid: "user", mockDb: mocks.db })
    const result = await mod.main({ id: "booking_1" })
    expect(result.ok).toBe(true)
    expect(mocks.handoverDoc.mock.calls.map(([id]) => id)).toEqual(["pickup_45", "return_1"])
    expect(result.handovers.pickup).toMatchObject({ id: "pickup_45", version: 45 })
    expect(result.handovers.return).toMatchObject({ id: "return_1", version: 1 })
    handovers[44].bookingId = "other"
    handovers[45].stage = "pickup"
    expect((await mod.main({ id: "booking_1" })).handovers).toEqual({ pickup: null, return: null })
  })

  test("用户可查看自己的预约详情", async () => {
    const mocks = createMockDb({
      bookingData: {
        _id: "booking_1",
        openid: "user_openid",
        vehicleId: "car_1",
        vehicleName: "MX-5",
        userName: "张三",
        phone: "13800000000",
        startDate: "2026-07-20",
        endDate: "2026-07-21",
        city: "杭州",
        location: "历史约定地点",
        pickupLocation: "已保存取车网点",
        returnLocation: "已保存还车网点",
        note: "尽快联系",
        latestQuoteId: "",
        latestQuoteVersion: 0,
        latestPickupHandoverId: "",
        latestPickupHandoverVersion: 0,
        latestReturnHandoverId: "",
        latestReturnHandoverVersion: 0,
        pickupHandoverConfirmedAt: "",
        returnHandoverConfirmedAt: "",
        quotedAt: "",
        confirmedAt: "",
        adjustmentRequestedAt: "",
        status: "pending",
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T11:00:00.000Z"
      },
      latestQuote: null,
      handovers: { pickup: null, return: null }
    })

    const mod = await loadBookingMyDetailWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "booking_1" })

    expect(res).toEqual({
      ok: true,
      detail: {
        id: "booking_1",
        vehicleId: "car_1",
        vehicleName: "MX-5",
        vehicleReference: "",
        userName: "张三",
        phone: "13800000000",
        startDate: "2026-07-20",
        endDate: "2026-07-21",
        city: "杭州",
        location: "历史约定地点",
        pickupLocation: "已保存取车网点",
        returnLocation: "已保存还车网点",
        note: "尽快联系",
        latestQuoteId: "",
        latestQuoteVersion: 0,
        latestPickupHandoverId: "",
        latestPickupHandoverVersion: 0,
        latestReturnHandoverId: "",
        latestReturnHandoverVersion: 0,
        pickupHandoverConfirmedAt: "",
        returnHandoverConfirmedAt: "",
        quotedAt: "",
        confirmedAt: "",
        adjustmentRequestedAt: "",
        status: "pending",
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T11:00:00.000Z"
      },
      latestQuote: null,
      handovers: { pickup: null, return: null }
    })
    expect(mocks.doc).toHaveBeenCalledWith("booking_1")
    const fields = mocks.field.mock.calls[0][0]
    expect(fields.openid).toBe(true)
    expect(fields).toMatchObject({ location: true, pickupLocation: true, returnLocation: true })
    expect(fields.adminRemark).toBeUndefined()
    expect(fields.coordinationStatus).toBeUndefined()
    expect(fields.coordinationNote).toBeUndefined()
  })

  test("不能查看别人的预约详情", async () => {
    const mocks = createMockDb({
      bookingData: {
        _id: "booking_1",
        openid: "other_openid"
      }
    })

    const mod = await loadBookingMyDetailWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "booking_1" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "只能查看自己的预约"
    })
  })

  test("预约详情不会返回历史记录中的完整车牌", async () => {
    const mocks = createMockDb({
      bookingData: {
        _id: "booking_2",
        openid: "user_openid",
        vehicleName: "粤A12345"
      }
    })

    const mod = await loadBookingMyDetailWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "booking_2" })

    expect(res.detail).toMatchObject({
      vehicleName: "预约车辆",
      vehicleReference: "车牌尾号 45"
    })
    expect(JSON.stringify(res.detail)).not.toContain("粤A12345")
  })
})
