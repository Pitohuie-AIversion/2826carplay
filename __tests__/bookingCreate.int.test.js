jest.mock("wx-server-sdk")

function createMockDb({ vehicleData, addResult }) {
  const vehicleGet = jest.fn().mockResolvedValue({ data: vehicleData })
  const add = jest.fn().mockResolvedValue(addResult)

  const vehiclesDoc = jest.fn(() => ({
    get: vehicleGet
  }))

  const bookingsAdd = jest.fn(() => ({
    add
  }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "vehicles") {
        return { doc: vehiclesDoc }
      }
      if (name === "bookings") {
        return { add }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    vehiclesDoc,
    vehicleGet,
    add,
    serverDateValue
  }
}

async function loadBookingCreateWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingCreate/index")
  })

  return mod
}

describe("cloudfunctions/bookingCreate integration", () => {
  test("正常提交预约并写入 bookings", async () => {
    const mocks = createMockDb({
      vehicleData: {
        _id: "car_1",
        name: "MX-5 ND2",
        status: "idle"
      },
      addResult: { _id: "booking_1" }
    })

    const bookingCreate = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await bookingCreate.main({
      vehicleId: "car_1",
      userName: "张三",
      phone: "13800000000",
      startDate: "2026-07-13",
      endDate: "2026-07-14",
      city: "杭州",
      note: "希望下午取车"
    })

    expect(res.ok).toBe(true)
    expect(res.id).toBe("booking_1")
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
    expect(mocks.add).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        vehicleId: "car_1",
        vehicleName: "MX-5 ND2",
        userName: "张三",
        phone: "13800000000",
        startDate: "2026-07-13",
        endDate: "2026-07-14",
        city: "杭州",
        note: "希望下午取车",
        status: "pending",
        createdAt: mocks.serverDateValue,
        updatedAt: mocks.serverDateValue
      }
    })
  })

  test("缺少 vehicleId 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      vehicleData: null,
      addResult: { _id: "booking_1" }
    })

    const bookingCreate = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await bookingCreate.main({
      userName: "张三",
      phone: "13800000000",
      startDate: "2026-07-13",
      endDate: "2026-07-14",
      city: "杭州"
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  test("车辆停用返回 NOT_AVAILABLE", async () => {
    const mocks = createMockDb({
      vehicleData: {
        _id: "car_1",
        name: "MX-5 ND2",
        status: "retired"
      },
      addResult: { _id: "booking_1" }
    })

    const bookingCreate = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await bookingCreate.main({
      vehicleId: "car_1",
      userName: "张三",
      phone: "13800000000",
      startDate: "2026-07-13",
      endDate: "2026-07-14",
      city: "杭州"
    })

    expect(res).toEqual({
      ok: false,
      code: "NOT_AVAILABLE",
      message: "车辆已停用，暂不可预约"
    })
    expect(mocks.add).not.toHaveBeenCalled()
  })
})

