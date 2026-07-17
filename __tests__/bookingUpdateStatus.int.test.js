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
    rolesLimit,
    bookingsDoc,
    currentGet,
    update,
    serverDateValue
  }
}

async function loadBookingUpdateStatusWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingUpdateStatus/index")
  })

  return mod
}

describe("cloudfunctions/bookingUpdateStatus integration", () => {
  test("admin 更新预约状态成功", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "booking_1",
        status: "pending"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({ id: "booking_1", status: "contacted" })

    expect(res).toEqual({
      ok: true,
      id: "booking_1",
      status: "contacted",
      message: "预约状态已更新"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.bookingsDoc).toHaveBeenCalledWith("booking_1")
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        status: "contacted",
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

    const mod = await loadBookingUpdateStatusWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await mod.main({ id: "booking_1", status: "contacted" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.bookingsDoc).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })
})

