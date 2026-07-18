jest.mock("wx-server-sdk")

function createMockDb({ bookingData }) {
  const get = jest.fn().mockResolvedValue({ data: bookingData })
  const doc = jest.fn(() => ({ get }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "bookings") {
        return { doc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    doc
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
        note: "尽快联系",
        status: "pending",
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T11:00:00.000Z"
      }
    })

    const mod = await loadBookingMyDetailWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "booking_1" })

    expect(res).toEqual({
      ok: true,
      detail: {
        id: "booking_1",
        vehicleId: "car_1",
        vehicleName: "MX-5",
        userName: "张三",
        phone: "13800000000",
        startDate: "2026-07-20",
        endDate: "2026-07-21",
        city: "杭州",
        note: "尽快联系",
        status: "pending",
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T11:00:00.000Z"
      }
    })
    expect(mocks.doc).toHaveBeenCalledWith("booking_1")
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
})
