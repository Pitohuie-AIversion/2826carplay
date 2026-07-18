jest.mock("wx-server-sdk")

function createMockDb({ rolesData, bookingData }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const bookingGet = jest.fn().mockResolvedValue({ data: bookingData })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))
  const bookingsDoc = jest.fn(() => ({ get: bookingGet }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return { doc: bookingsDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    bookingsDoc
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
        status: "contacted",
        createdAt: "2026-07-18T10:00:00.000Z",
        updatedAt: "2026-07-18T11:00:00.000Z"
      }
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.bookingsDoc).toHaveBeenCalledWith("booking_1")
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
})
