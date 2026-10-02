jest.mock("wx-server-sdk")

function createMockDb({
  vehicleData,
  addResult,
  existingBookings = [],
  orderedQueryError = null,
  idempotentBooking = null
}) {
  const vehicleGet = jest.fn().mockResolvedValue({ data: vehicleData })
  const vehicleField = jest.fn(() => ({ get: vehicleGet }))
  const vehicleUpdate = jest.fn(async ({ data }) => { Object.assign(vehicleData, data); return { stats: { updated: 1 } } })
  const add = jest.fn().mockResolvedValue(addResult)
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

  const vehiclesDoc = jest.fn(() => ({
    field: vehicleField,
    update: vehicleUpdate
  }))

  const bookingsAdd = jest.fn(() => ({
    add
  }))
  const bookingsDocGet = idempotentBooking
    ? jest.fn().mockResolvedValue({ data: idempotentBooking })
    : jest.fn().mockRejectedValue(new Error("booking not found"))
  const bookingsDocSet = jest.fn().mockResolvedValue({ stats: { created: 1 } })
  const bookingsDoc = jest.fn(() => ({
    field: jest.fn(() => ({ get: bookingsDocGet })),
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
    serverDate,
    runTransaction: jest.fn(async (callback) => {
      const snapshot = vehicleData && { ...vehicleData }
      try { return await callback({ collection: (name) => ({ doc: db.collection(name).doc }) }) }
      catch (error) {
        if (vehicleData) { Object.keys(vehicleData).forEach((key) => delete vehicleData[key]); Object.assign(vehicleData, snapshot) }
        throw error
      }
    })
  }

  return {
    db,
    vehiclesDoc,
    vehicleField,
    vehicleGet,
    vehicleUpdate,
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
        brandModel: "MX-5 ND2",
        plateNumber: "浙A12345",
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
      pickupLocation: "已配置取车门店",
      returnLocation: "已约定还车地点",
      note: "希望下午取车"
    })

    expect(res.ok).toBe(true)
    expect(res.id).toMatch(/^[a-f0-9]{32}$/)
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
    expect(mocks.vehicleField).toHaveBeenCalledWith({
      name: true,
      brandModel: true,
      plateNumber: true,
      status: true,
      bookingReferenceVersion: true
    })
    expect(mocks.bookingsWhere).toHaveBeenCalledWith({ openid: "user_openid" })
    expect(mocks.bookingsDocSet).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        vehicleId: "car_1",
        vehicleName: "MX-5 ND2",
        userName: "张三",
        phone: "13800000000",
        startDate: "2026-07-13",
        endDate: "2026-07-14",
        city: "杭州",
        pickupLocation: "已配置取车门店",
        returnLocation: "已约定还车地点",
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
        bookingId: res.id,
        vehicleId: "car_1",
        createdAt: mocks.serverDateValue
      }
    })
  })

  test("缺少车型名称时只保存脱敏车牌作为预约车辆名", async () => {
    const mocks = createMockDb({
      vehicleData: {
        _id: "car_1",
        plateNumber: "浙A12345",
        status: "idle",
        vin: "VIN-SECRET",
        note: "内部备注"
      },
      addResult: { _id: "booking_1" }
    })
    const bookingCreate = await loadBookingCreateWith({
      openid: "user_openid",
      mockDb: mocks.db
    })

    const res = await bookingCreate.main({
      vehicleId: "car_1",
      userName: "张三",
      phone: "13800000000",
      startDate: "2026-07-13",
      endDate: "2026-07-14",
      city: "杭州"
    })

    expect(res.ok).toBe(true)
    expect(mocks.bookingsDocSet.mock.calls[0][0].data.vehicleName).toBe("浙A***45")
    expect(JSON.stringify(mocks.bookingsDocSet.mock.calls[0][0])).not.toContain("浙A12345")
    expect(mocks.vehicleField.mock.calls[0][0]).not.toHaveProperty("vin")
    expect(mocks.vehicleField.mock.calls[0][0]).not.toHaveProperty("note")
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
    expect(mocks.db.runTransaction).toHaveBeenCalledTimes(1)
  })

  test("请求哈希绑定原始内容，后续编辑预约不破坏同请求成功重试", async () => {
    const mocks = createMockDb({ vehicleData: { name: "预约车辆", status: "idle" } })
    const mod = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })
    const input = { vehicleId: "car_1", userName: "联系人", phone: "13800138000", startDate: "2099-08-01", endDate: "2099-08-02", city: "杭州", pickupLocation: "门店A", returnLocation: "还车B", note: "原始备注", requestId: "hash_request_1234", attribution: { contentId: "guide_1", channel: "direct", scene: "weekend_trip" } }
    const first = await mod.main(input)
    const created = mocks.bookingsDocSet.mock.calls[0][0].data
    expect(created.requestPayloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(first).not.toHaveProperty("requestPayloadHash")
    const stored = { ...created, status: "confirmed", phone: "13900139000", note: "顾问后续编辑" }
    mocks.bookingsDocGet.mockResolvedValue({ data: stored })
    expect(await mod.main({ ...input, userName: " 联系人 " })).toMatchObject({ ok: true, duplicated: true, id: first.id })
    expect(await mod.main({ ...input, attribution: { contentId: "guide_2", channel: "wechat_share", scene: "ev_experience" } })).toMatchObject({ ok: true, duplicated: true, id: first.id })
    expect(stored.attribution).toEqual(input.attribution)
    for (const change of [
      { vehicleId: "car_2" }, { startDate: "2099-08-02" }, { city: "上海" }, { note: "新备注" },
      { pickupLocation: "门店C" }, { returnLocation: "还车C" }
    ]) expect(await mod.main({ ...input, ...change })).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" })
    expect(mocks.bookingsDocSet).toHaveBeenCalledTimes(1)
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
    expect(stored).toMatchObject({ status: "confirmed", phone: "13900139000", note: "顾问后续编辑" })
  })

  test("已成功请求跨日仍幂等，未成功的新请求不能创建过去日期", async () => {
    const mocks = createMockDb({ vehicleData: { name: "预约车辆", status: "idle" } })
    const mod = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })
    const input = { vehicleId: "car_1", userName: "联系人", phone: "13800138000", startDate: "2026-07-01", endDate: "2026-07-02", city: "杭州", requestId: "date_retry_123456" }
    const first = await mod.main(input)
    mocks.bookingsDocGet.mockResolvedValue({ data: mocks.bookingsDocSet.mock.calls[0][0].data })
    jest.setSystemTime(new Date("2026-07-02T00:01:00+08:00"))
    try {
      expect(await mod.main(input)).toMatchObject({ ok: true, duplicated: true, id: first.id })
      mocks.bookingsDocGet.mockResolvedValue({ data: null })
      expect(await mod.main({ ...input, requestId: "new_past_12345678" })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
      expect(mocks.bookingsDocSet).toHaveBeenCalledTimes(1)
    } finally { jest.setSystemTime(new Date("2026-07-01T00:00:00+08:00")) }
  })

  test("事务复查时同ID出现另一份内容，不能覆盖或返回假成功", async () => {
    const mocks = createMockDb({ vehicleData: { name: "预约车辆", status: "idle" } })
    mocks.bookingsDocGet.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: { openid: "user_openid", requestId: "race_hash_1234567", requestPayloadHash: "a".repeat(64) } })
    const mod = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })
    expect(await mod.main({ vehicleId: "car_1", userName: "联系人", phone: "13800138000", startDate: "2099-08-01", endDate: "2099-08-02", city: "杭州", requestId: "race_hash_1234567" })).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" })
    expect(mocks.bookingsDocSet).not.toHaveBeenCalled()
    expect(mocks.vehicleUpdate).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("幂等查询失败不把数据库故障当成无记录并覆盖已有订单", async () => {
    const mocks = createMockDb({ vehicleData: { name: "MX-5", status: "idle" } })
    mocks.bookingsDocGet.mockRejectedValue(new Error("network unavailable"))
    const consoleError = jest.spyOn(console, "error").mockImplementation(() => {})
    const mod = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ vehicleId: "car_1", userName: "张三", phone: "13800000000", startDate: "2099-08-01", endDate: "2099-08-02", city: "杭州", requestId: "request-retry123456" })
    expect(res.code).toBe("INTERNAL_ERROR")
    expect(mocks.bookingsDocSet).not.toHaveBeenCalled()
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })

  test("并发重试在事务复查时已有订单则不重置已确认状态", async () => {
    const requestId = "request-race123456"
    const mocks = createMockDb({ vehicleData: { name: "MX-5", status: "idle" } })
    const existing = { openid: "user_openid", requestId, status: "confirmed" }
    mocks.bookingsDocGet.mockRejectedValueOnce(new Error("document not found")).mockResolvedValue({ data: existing })
    const mod = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ vehicleId: "car_1", userName: "张三", phone: "13800000000", startDate: "2099-08-01", endDate: "2099-08-02", city: "杭州", requestId })
    expect(res).toMatchObject({ ok: true, duplicated: true })
    expect(mocks.bookingsDocSet).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
    expect(existing.status).toBe("confirmed")
    expect(mocks.vehicleUpdate).not.toHaveBeenCalled()
  })

  test.each(["", "request-delete-race"])("车辆预读后被删除或停用时拒绝创建，requestId=%s", async (requestId) => {
    for (const latestVehicle of [null, { name: "MX-5", status: "retired" }]) {
      const mocks = createMockDb({ vehicleData: { name: "MX-5", status: "idle" } })
      mocks.vehicleGet.mockResolvedValueOnce({ data: { name: "MX-5", status: "idle" } }).mockResolvedValue({ data: latestVehicle })
      const mod = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })
      const result = await mod.main({ vehicleId: "car_1", userName: "张三", phone: "13800000000", startDate: "2099-08-01", endDate: "2099-08-02", city: "杭州", requestId })
      expect(result.code).toBe(latestVehicle ? "NOT_AVAILABLE" : "NOT_FOUND")
      expect(mocks.bookingsDocSet).not.toHaveBeenCalled()
      expect(mocks.vehicleUpdate).not.toHaveBeenCalled()
    }
  })

  test("预约与车辆引用版本共同提交，写预约失败时版本也回滚", async () => {
    const vehicleData = { name: "MX-5", status: "idle", bookingReferenceVersion: 3 }
    const mocks = createMockDb({ vehicleData })
    const mod = await loadBookingCreateWith({ openid: "user_openid", mockDb: mocks.db })
    const input = { vehicleId: "car_1", userName: "张三", phone: "13800000000", startDate: "2099-08-01", endDate: "2099-08-02", city: "杭州" }
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    mocks.bookingsDocSet.mockRejectedValueOnce(new Error("write failure"))
    expect((await mod.main(input)).code).toBe("INTERNAL_ERROR")
    expect(vehicleData.bookingReferenceVersion).toBe(3)
    expect(await mod.main(input)).toMatchObject({ ok: true })
    expect(vehicleData.bookingReferenceVersion).toBe(4)
    expect(mocks.add).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })
})
