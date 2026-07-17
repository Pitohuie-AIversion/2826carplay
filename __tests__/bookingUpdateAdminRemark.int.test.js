jest.mock("wx-server-sdk")

function createMockDb({ rolesData, currentData, updateResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = jest.fn().mockResolvedValue(updateResult)

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const bookingsDoc = jest.fn(() => ({
    get: currentGet,
    update
  }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return { doc: bookingsDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesWhere,
    bookingsDoc,
    update,
    serverDateValue
  }
}

async function loadBookingUpdateAdminRemarkWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingUpdateAdminRemark/index")
  })

  return mod
}

describe("cloudfunctions/bookingUpdateAdminRemark integration", () => {
  test("admin 可保存管理员备注", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "booking_1" },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateAdminRemarkWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({
      id: "booking_1",
      adminRemark: "已电话联系，客户周末到店试驾"
    })

    expect(res).toEqual({
      ok: true,
      id: "booking_1",
      adminRemark: "已电话联系，客户周末到店试驾",
      message: "管理员备注已保存"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.bookingsDoc).toHaveBeenCalledWith("booking_1")
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        adminRemark: "已电话联系，客户周末到店试驾",
        adminRemarkUpdatedAt: mocks.serverDateValue,
        updatedAt: mocks.serverDateValue
      }
    })
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      currentData: { _id: "booking_1" },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateAdminRemarkWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({
      id: "booking_1",
      adminRemark: "test"
    })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
