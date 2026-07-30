jest.mock("wx-server-sdk")

function createMockDb({ rolesData, bookingData, rangeError = null }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const rolesWhere = jest.fn(() => ({
    limit: jest.fn(() => ({ get: rolesGet }))
  }))
  const rangeWhere = jest.fn()
  const bookingSkip = jest.fn()

  function createBookingQuery(offset, ranged) {
    return {
      where: jest.fn((filter) => {
        rangeWhere(filter)
        return createBookingQuery(0, true)
      }),
      skip: jest.fn((nextOffset) => {
        bookingSkip(nextOffset)
        return createBookingQuery(nextOffset, ranged)
      }),
      limit: jest.fn((limitValue) => ({
        get:
          ranged && rangeError
            ? jest.fn().mockRejectedValue(rangeError)
            : jest.fn().mockResolvedValue({
                data: bookingData.slice(offset, offset + limitValue)
              })
      }))
    }
  }

  const lte = jest.fn((value) => ({ __op: "lte", value }))
  const gte = jest.fn((value) => ({ __op: "gte", value }))
  const errorAdd = jest.fn().mockResolvedValue({ _id: "error_1" })
  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return createBookingQuery(0, false)
      }
      if (name === "error_logs") {
        return { add: errorAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    command: { lte, gte },
    serverDate: jest.fn(() => ({ __type: "serverDate" }))
  }

  return {
    db,
    rolesWhere,
    rangeWhere,
    bookingSkip,
    lte,
    gte,
    errorAdd
  }
}

async function loadFunctionWith({ openid, mockDb }) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingCalendarList/index")
  })
  return mod
}

describe("cloudfunctions/bookingCalendarList integration", () => {
  test("预约管理员按月查询且只返回日历必需字段", async () => {
    const mocks = createMockDb({
      rolesData: [{ permissions: ["booking_manage"] }],
      bookingData: [
        {
          _id: "booking_1",
          openid: "private_openid",
          phone: "13800138000",
          userName: "用户姓名",
          city: "杭州",
          note: "私人备注",
          adminRemark: "内部备注",
          vehicleId: "vehicle_1",
          vehicleName: "BMW M4",
          startDate: "2026-06-30",
          endDate: "2026-07-02",
          status: "pending"
        },
        {
          _id: "booking_cancelled",
          vehicleId: "vehicle_2",
          vehicleName: "已取消车辆",
          startDate: "2026-07-10",
          endDate: "2026-07-12",
          status: "cancelled"
        },
        {
          _id: "booking_invalid",
          vehicleId: "vehicle_3",
          vehicleName: "日期错误",
          startDate: "2026-07-20",
          endDate: "2026-07-19",
          status: "contacted"
        }
      ]
    })
    const mod = await loadFunctionWith({
      openid: "ops_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({ month: "2026-07" })

    expect(res.ok).toBe(true)
    expect(res.monthStart).toBe("2026-07-01")
    expect(res.monthEnd).toBe("2026-07-31")
    expect(mocks.rangeWhere).toHaveBeenCalledWith({
      startDate: { __op: "lte", value: "2026-07-31" },
      endDate: { __op: "gte", value: "2026-07-01" }
    })
    expect(res.list).toEqual([
      {
        id: "booking_1",
        vehicleId: "vehicle_1",
        vehicleName: "BMW M4",
        startDate: "2026-06-30",
        endDate: "2026-07-02",
        status: "pending"
      }
    ])
    const serialized = JSON.stringify(res)
    expect(serialized).not.toContain("private_openid")
    expect(serialized).not.toContain("13800138000")
    expect(serialized).not.toContain("用户姓名")
    expect(serialized).not.toContain("私人备注")
    expect(serialized).not.toContain("内部备注")
  })

  test("月份格式错误时拒绝查询", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: []
    })
    const mod = await loadFunctionWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({ month: "2026-13" })

    expect(res).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "月份格式不正确"
    })
    expect(mocks.rangeWhere).not.toHaveBeenCalled()
  })

  test("非预约管理员不能读取日历数据", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "member" }],
      bookingData: []
    })
    const mod = await loadFunctionWith({
      openid: "user_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({ month: "2026-07" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.rangeWhere).not.toHaveBeenCalled()
  })

  test("缺少范围索引时降级读取并在云端过滤", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: [
        {
          _id: "booking_1",
          vehicleId: "vehicle_1",
          startDate: "2026-07-10",
          endDate: "2026-07-11",
          status: "contacted"
        }
      ],
      rangeError: new Error("missing range index")
    })
    const mod = await loadFunctionWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({ month: "2026-07" })

    expect(res.ok).toBe(true)
    expect(res.list).toHaveLength(1)
    expect(mocks.bookingSkip).toHaveBeenCalledTimes(2)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
