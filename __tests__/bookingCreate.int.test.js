jest.mock("wx-server-sdk")

function createMockDb({
  vehicleData,
  addResult,
  existingBookings = [],
  orderedQueryError = null,
  idempotentBooking = null
}) {
  const vehicleGet = jest.fn().mockResolvedValue({ data: vehicleData })
  const add = jest.fn().mockResolvedValue(addResult)
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

  const vehiclesDoc = jest.fn(() => ({
    get: vehicleGet
  }))

  const bookingsAdd = jest.fn(() => ({
    add
  }))
  const bookingsDocGet = idempotentBooking
    ? jest.fn().mockResolvedValue({ data: idempotentBooking })
    : jest.fn().mockRejectedValue(new Error("booking not found"))
  const bookingsDocSet = jest.fn().mockResolvedValue({ stats: { created: 1 } })
  const bookingsDoc = jest.fn(() => ({
    get: bookingsDocGet,
    set: bookingsDocSet
  }))
  const bookingsGet = orderedQueryError
    ? jest.fn().mockRejectedValue(orderedQueryError)
    : jest.fn().mockResolvedValue({ data: existingBookings })
  const bookingsLimit = jest.fn(() => ({ get: bookingsGet }))
  const bookingsOrderBy = jest.fn(() => ({ limit: bookingsLimit }))
  const fallbackGet = jest.fn().mockResolvedValue({ data: existingBookings })
  const fallbackLimit = jest.fn(() => ({ get: fallbackGet }))
  const fallbackSkip = jest.fn(() => ({ limit: fallbackLimit }))
  const bookingsWhere = jest.fn(() => ({
    orderBy: bookingsOrderBy,
    skip: fallbackSkip
  }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "vehicles") {
        return { doc: vehiclesDoc }
      }
      if (name === "bookings") {
        return {
          add,
          where: bookingsWhere,
          doc: bookingsDoc
        }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
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
    bookingsWhere,
    bookingsOrderBy,
    bookingsGet,
    fallbackSkip,
    fallbackLimit,
    bookingsDoc,
    bookingsDocGet,
    bookingsDocSet,
    auditAdd,
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
  beforeAll(() => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-07-01T00:00:00+08:00"))
  })

  afterAll(() => {
    jest.useRealTimers()
  })

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
    expect(mocks.bookingsWhere).toHaveBeenCalledWith({ openid: "user_openid" })
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
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        action: "bookingCreate",
        bookingId: "booking_1",
        vehicleId: "car_1",
        vehicleName: "MX-5 ND2",
        startDate: "2026-07-13",
        endDate: "2026-07-14",
        city: "杭州",
        createdAt: mocks.serverDateValue
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

  test("相同车辆和日期已有未完成预约时拒绝重复提交", async () => {
    const mocks = createMockDb({
      vehicleData: {
        _id: "car_1",
        name: "MX-5 ND2",
        status: "idle"
      },
      addResult: { _id: "booking_1" },
      existingBookings: [
        {
          vehicleId: "car_1",
          startDate: "2026-07-13",
          endDate: "2026-07-14",
          status: "pending",
          createdAt: new Date()
        }
      ]
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
      code: "DUPLICATE_BOOKING",
      message: "相同车辆和日期的预约已提交，请勿重复预约"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  test("十分钟内已提交五次时触发频率限制", async () => {
    const now = Date.now()
    const mocks = createMockDb({
      vehicleData: {
        _id: "car_1",
        name: "MX-5 ND2",
        status: "idle"
      },
      addResult: { _id: "booking_1" },
      existingBookings: Array.from({ length: 5 }, (_, index) => ({
        vehicleId: `other_${index}`,
        startDate: "2026-08-01",
        endDate: "2026-08-02",
        status: "cancelled",
        createdAt: new Date(now - index * 1000)
      }))
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
      code: "RATE_LIMITED",
      message: "预约提交过于频繁，请稍后再试"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  test("缺少复合索引时仍能识别最近的频繁提交", async () => {
    const now = Date.now()
    const mocks = createMockDb({
      vehicleData: {
        _id: "car_1",
        name: "MX-5 ND2",
        status: "idle"
      },
      addResult: { _id: "booking_1" },
      orderedQueryError: new Error("missing composite index"),
      existingBookings: Array.from({ length: 5 }, (_, index) => ({
        vehicleId: `other_${index}`,
        startDate: "2026-08-01",
        endDate: "2026-08-02",
        status: "cancelled",
        createdAt: new Date(now - index * 1000)
      }))
    })

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const bookingCreate = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await bookingCreate.main({
      vehicleId: "car_1",
      userName: "张三",
      phone: "13800000000",
      startDate: "2026-07-13",
      endDate: "2026-07-14",
      city: "杭州"
    })

    expect(res.code).toBe("RATE_LIMITED")
    expect(mocks.bookingsOrderBy).toHaveBeenCalledWith("createdAt", "desc")
    expect(mocks.fallbackSkip).toHaveBeenCalledWith(0)
    expect(mocks.fallbackLimit).toHaveBeenCalledWith(100)
    expect(warnSpy).toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test("非法日历日期返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      vehicleData: { _id: "car_1", name: "MX-5 ND2", status: "idle" },
      addResult: { _id: "booking_1" }
    })
    const bookingCreate = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await bookingCreate.main({
      vehicleId: "car_1",
      userName: "张三",
      phone: "13800000000",
      startDate: "2026-02-30",
      endDate: "2026-03-01",
      city: "杭州"
    })

    expect(res.code).toBe("VALIDATION_ERROR")
    expect(res.details.errors).toContainEqual({
      field: "startDate",
      message: "取车日期格式不正确"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  test("过去的取车日期返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      vehicleData: { _id: "car_1", name: "MX-5 ND2", status: "idle" },
      addResult: { _id: "booking_1" }
    })
    const bookingCreate = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await bookingCreate.main({
      vehicleId: "car_1",
      userName: "张三",
      phone: "13800000000",
      startDate: "2020-01-01",
      endDate: "2020-01-02",
      city: "杭州"
    })

    expect(res.code).toBe("VALIDATION_ERROR")
    expect(res.details.errors).toContainEqual({
      field: "startDate",
      message: "取车日期不能早于今天"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
  })

  test("相同 requestId 重试时直接返回已有预约", async () => {
    const requestId = "request-abc123456"
    const mocks = createMockDb({
      vehicleData: { _id: "car_1", name: "MX-5 ND2", status: "idle" },
      addResult: { _id: "booking_1" },
      idempotentBooking: {
        openid: "user_openid",
        requestId,
        status: "pending"
      }
    })
    const bookingCreate = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await bookingCreate.main({
      vehicleId: "car_1",
      userName: "张三",
      phone: "13800000000",
      startDate: "2026-07-13",
      endDate: "2026-07-14",
      city: "杭州",
      requestId
    })

    expect(res.ok).toBe(true)
    expect(res.duplicated).toBe(true)
    expect(res.id).toMatch(/^[a-f0-9]{32}$/)
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.bookingsDocSet).not.toHaveBeenCalled()
  })

  test("新 requestId 使用确定性文档 ID 写入", async () => {
    const requestId = "request-new123456"
    const mocks = createMockDb({
      vehicleData: { _id: "car_1", name: "MX-5 ND2", status: "idle" },
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
      requestId
    })

    expect(res.ok).toBe(true)
    expect(res.id).toMatch(/^[a-f0-9]{32}$/)
    expect(mocks.bookingsDoc).toHaveBeenLastCalledWith(res.id)
    expect(mocks.bookingsDocSet).toHaveBeenCalledWith({
      data: expect.objectContaining({
        openid: "user_openid",
        vehicleId: "car_1",
        requestId,
        status: "pending"
      })
    })
    expect(mocks.add).not.toHaveBeenCalled()
  })
})
