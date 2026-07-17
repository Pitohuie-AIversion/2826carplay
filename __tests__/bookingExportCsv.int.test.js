jest.mock("wx-server-sdk")

function createMockDb({ rolesData, bookingData }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const bookingsGet = jest.fn().mockResolvedValue({ data: bookingData })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const bookingsLimit = jest.fn(() => ({ get: bookingsGet }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return { limit: bookingsLimit }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    bookingsLimit
  }
}

async function loadBookingExportCsvWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingExportCsv/index")
  })

  return mod
}

describe("cloudfunctions/bookingExportCsv integration", () => {
  test("admin 可导出 CSV", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: [
        {
          _id: "b1",
          vehicleName: "MX-5",
          userName: "张三",
          phone: "13800000000",
          city: "杭州",
          status: "pending",
          note: "希望下午取车",
          adminRemark: "已联系",
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:00.000Z"
        }
      ]
    })

    const mod = await loadBookingExportCsvWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "all", keyword: "" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(typeof res.csvText).toBe("string")
    expect(res.csvText).toContain("MX-5")
    expect(res.csvText).toContain("张三")
    expect(res.csvText).toContain("已联系")
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      bookingData: []
    })

    const mod = await loadBookingExportCsvWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "all", keyword: "" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
  })
})

