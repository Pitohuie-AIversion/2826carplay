jest.mock("wx-server-sdk")

function loadModule({ openid = "user_openid", vehicle, bookings = [], total = bookings.length }) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })

  const bookingWhere = jest.fn(() => {
    let offset = 0
    let limit = 100
    const chain = {
      count: jest.fn().mockResolvedValue({ total }),
      field: jest.fn(() => chain),
      skip: jest.fn((value) => {
        offset = value
        return chain
      }),
      limit: jest.fn((value) => {
        limit = value
        return chain
      }),
      get: jest.fn(() => Promise.resolve({ data: bookings.slice(offset, offset + limit) }))
    }
    return chain
  })
  const vehicleGet = jest.fn().mockResolvedValue({ data: vehicle || null })
  const vehicleField = jest.fn(() => ({ get: vehicleGet }))

  cloud.__setMockDb({
    collection: jest.fn((name) => {
      if (name === "vehicles") {
        return {
          doc: jest.fn(() => ({ field: vehicleField }))
        }
      }
      if (name === "bookings") {
        return { where: bookingWhere }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  })

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleAvailabilityCheck/index")
  })
  return { mod, bookingWhere, vehicleGet, vehicleField }
}

describe("cloudfunctions/vehicleAvailabilityCheck integration", () => {
  test("只返回同期咨询数量，不返回其他用户预约详情", async () => {
    const { mod, bookingWhere, vehicleField } = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle" },
      bookings: [
        {
          openid: "other_user",
          userName: "不应返回",
          phone: "13800000000",
          startDate: "2099-08-10",
          endDate: "2099-08-12",
          status: "pending"
        },
        {
          startDate: "2099-08-11",
          endDate: "2099-08-13",
          status: "cancelled"
        },
        {
          startDate: "2099-09-01",
          endDate: "2099-09-02",
          status: "contacted"
        }
      ]
    })

    const res = await mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-11",
      endDate: "2099-08-14"
    })

    expect(res).toEqual({
      ok: true,
      vehicleId: "vehicle_1",
      startDate: "2099-08-11",
      endDate: "2099-08-14",
      available: false,
      conflictCount: 1,
      truncated: false,
      message: "当前已有 1 条同期咨询，仍可提交候补"
    })
    expect(JSON.stringify(res)).not.toContain("13800000000")
    expect(JSON.stringify(res)).not.toContain("不应返回")
    expect(vehicleField).toHaveBeenCalledWith({ status: true })
    expect(bookingWhere).toHaveBeenCalledWith({ vehicleId: "vehicle_1" })
  })

  test("没有同期咨询时返回可继续提交", async () => {
    const { mod } = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle" },
      bookings: [
        {
          startDate: "2099-07-01",
          endDate: "2099-07-03",
          status: "completed"
        }
      ]
    })

    const res = await mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-01",
      endDate: "2099-08-02"
    })

    expect(res.available).toBe(true)
    expect(res.conflictCount).toBe(0)
    expect(res.message).toContain("未发现同期")
  })

  test("记录超过扫描上限时保守提示顾问确认", async () => {
    const { mod } = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle" },
      bookings: [],
      total: 1001
    })

    const res = await mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-01",
      endDate: "2099-08-02"
    })

    expect(res.available).toBe(false)
    expect(res.truncated).toBe(true)
    expect(res.message).toContain("顾问确认")
  })

  test("未登录、非法日期和停用车辆均不可查询", async () => {
    const unauthorized = loadModule({
      openid: "",
      vehicle: { _id: "vehicle_1", status: "idle" }
    })
    expect((await unauthorized.mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-01",
      endDate: "2099-08-02"
    })).code).toBe("UNAUTHORIZED")

    const invalid = loadModule({
      vehicle: { _id: "vehicle_1", status: "idle" }
    })
    const invalidResult = await invalid.mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-02-30",
      endDate: "2099-03-01"
    })
    expect(invalidResult.code).toBe("VALIDATION_ERROR")
    expect(invalid.vehicleGet).not.toHaveBeenCalled()

    const retired = loadModule({
      vehicle: { _id: "vehicle_1", status: "retired" }
    })
    expect((await retired.mod.main({
      vehicleId: "vehicle_1",
      startDate: "2099-08-01",
      endDate: "2099-08-02"
    })).code).toBe("NOT_AVAILABLE")
  })
})
