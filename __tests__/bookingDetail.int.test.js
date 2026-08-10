jest.mock("wx-server-sdk")

function createMockDb({ rolesData, bookingData, conflictBookings = [], conflictQueryError = null }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const bookingGet = jest.fn().mockResolvedValue({ data: bookingData })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))
  const detailField = jest.fn(() => ({ get: bookingGet }))
  const bookingsDoc = jest.fn(() => ({ field: detailField }))
  const conflictField = jest.fn()
  const bookingsWhere = jest.fn(() => {
    let offset = 0
    let limit = 100
    const chain = {
      field: jest.fn((fields) => {
        conflictField(fields)
        return chain
      }),
      skip: jest.fn((value) => {
        offset = value
        return chain
      }),
      limit: jest.fn((value) => {
        limit = value
        return chain
      }),
      get: jest.fn(() => {
        if (conflictQueryError) {
          return Promise.reject(conflictQueryError)
        }
        return Promise.resolve({
          data: conflictBookings.slice(offset, offset + limit)
        })
      })
    }
    return chain
  })

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return {
          doc: bookingsDoc,
          where: bookingsWhere
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    bookingsDoc,
    bookingsWhere,
    detailField,
    conflictField
  }
}

async function loadBookingDetailWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingDetail/index")
  })

  return mod
}

describe("cloudfunctions/bookingDetail integration", () => {
  test("admin 可查询单条预约详情", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: {
        _id: "booking_1",
        openid: "user_openid",
        vehicleId: "vehicle_1",
        vehicleName: "BMW M4",
        userName: "张三",
        phone: "13800000000",
        startDate: "2026-07-20",
        endDate: "2026-07-21",
        city: "杭州",
        note: "下午取车",
        adminRemark: "已联系",
        status: "contacted",
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T11:00:00.000Z"
      }
    })

    const mod = await loadBookingDetailWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "booking_1" })

    expect(res).toEqual({
      ok: true,
      detail: {
        id: "booking_1",
        openid: "user_openid",
        vehicleId: "vehicle_1",
        vehicleName: "BMW M4",
        userName: "张三",
        phone: "13800000000",
        startDate: "2026-07-20",
        endDate: "2026-07-21",
        city: "杭州",
        note: "下午取车",
        adminRemark: "已联系",
        adminRemarkUpdatedAt: "",
        schedulePriority: "normal",
        coordinationStatus: "pending",
        coordinationUpdatedAt: "",
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
        status: "contacted",
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T11:00:00.000Z"
      },
      conflicts: [],
      conflictTotal: 0,
      conflictsTruncated: false,
      conflictsUnavailable: false,
      conflictCheckSkipped: false,
      quoteDraft: null,
      quoteHistory: [],
      quotesUnavailable: false,
      handoverHistory: []
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.bookingsDoc).toHaveBeenCalledWith("booking_1")
    expect(mocks.bookingsWhere).toHaveBeenCalledWith({ vehicleId: "vehicle_1" })
    const detailFields = mocks.detailField.mock.calls[0][0]
    expect(detailFields).toEqual(
      expect.objectContaining({
        _id: true,
        openid: true,
        phone: true,
        note: true,
        adminRemark: true,
        coordinationUpdatedAt: true
      })
    )
    expect(detailFields).not.toHaveProperty("subscribeMessageAccepted")
    expect(detailFields).not.toHaveProperty("futureInternalField")
    const conflictFields = mocks.conflictField.mock.calls[0][0]
    expect(conflictFields).toEqual(
      expect.objectContaining({
        _id: true,
        vehicleId: true,
        phone: true,
        startDate: true,
        endDate: true,
        status: true
      })
    )
    expect(conflictFields).not.toHaveProperty("openid")
    expect(conflictFields).not.toHaveProperty("note")
    expect(conflictFields).not.toHaveProperty("adminRemark")
  })

  test("缺少 id 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: null
    })

    const mod = await loadBookingDetailWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({})

    expect(res).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "参数校验失败",
      details: {
        errors: [{ field: "id", message: "预约 ID 不能为空" }]
      }
    })
    expect(mocks.bookingsDoc).not.toHaveBeenCalled()
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      bookingData: null
    })

    const mod = await loadBookingDetailWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "booking_1" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.bookingsDoc).not.toHaveBeenCalled()
  })

  test("只返回同车且日期重叠的未取消预约", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "booking_manager" }],
      bookingData: {
        _id: "booking_target",
        vehicleId: "vehicle_1",
        vehicleName: "BMW M4",
        startDate: "2026-08-10",
        endDate: "2026-08-12",
        status: "pending"
      },
      conflictBookings: [
        {
          _id: "booking_target",
          vehicleId: "vehicle_1",
          startDate: "2026-08-10",
          endDate: "2026-08-12",
          status: "pending"
        },
        {
          _id: "booking_overlap",
          vehicleId: "vehicle_1",
          userName: "李四",
          phone: "13900000000",
          city: "杭州",
          startDate: "2026-08-12",
          endDate: "2026-08-14",
          status: "contacted"
        },
        {
          _id: "booking_cancelled",
          vehicleId: "vehicle_1",
          startDate: "2026-08-11",
          endDate: "2026-08-13",
          status: "cancelled"
        },
        {
          _id: "booking_other_vehicle",
          vehicleId: "vehicle_2",
          startDate: "2026-08-11",
          endDate: "2026-08-13",
          status: "pending"
        },
        {
          _id: "booking_later",
          vehicleId: "vehicle_1",
          startDate: "2026-08-20",
          endDate: "2026-08-21",
          status: "pending"
        }
      ]
    })

    const mod = await loadBookingDetailWith({
      openid: "manager_openid",
      mockDb: mocks.db
    })
    const res = await mod.main({ id: "booking_target" })

    expect(res.conflictTotal).toBe(1)
    expect(res.conflicts).toEqual([
      {
        id: "booking_overlap",
        userName: "李四",
        phone: "13900000000",
        city: "杭州",
        startDate: "2026-08-12",
        endDate: "2026-08-14",
        status: "contacted",
        schedulePriority: "normal",
        coordinationStatus: "pending"
      }
    ])
  })

  test("冲突查询失败不影响主预约详情", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: {
        _id: "booking_1",
        vehicleId: "vehicle_1",
        startDate: "2026-08-10",
        endDate: "2026-08-12",
        status: "pending"
      },
      conflictQueryError: new Error("temporary database error")
    })

    const mod = await loadBookingDetailWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })
    const res = await mod.main({ id: "booking_1" })

    expect(res.ok).toBe(true)
    expect(res.detail.id).toBe("booking_1")
    expect(res.conflicts).toEqual([])
    expect(res.conflictsUnavailable).toBe(true)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
