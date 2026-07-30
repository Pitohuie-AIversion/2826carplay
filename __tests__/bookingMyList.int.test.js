jest.mock("wx-server-sdk")

function createMockDb({ bookingsData }) {
  const get = jest.fn().mockResolvedValue({ data: bookingsData })
  const limit = jest.fn(() => ({ get }))
  const skip = jest.fn(() => ({ limit }))
  const orderBy = jest.fn(() => ({ skip }))
  const where = jest.fn(() => ({ orderBy }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "bookings") {
        return { where }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    where,
    orderBy,
    skip,
    limit
  }
}

function createFallbackMockDb({ fallbackData }) {
  const orderedGet = jest.fn().mockRejectedValue(new Error("missing composite index"))
  const orderedLimit = jest.fn(() => ({ get: orderedGet }))
  const orderedSkip = jest.fn(() => ({ limit: orderedLimit }))
  const orderBy = jest.fn(() => ({ skip: orderedSkip }))

  const fallbackGet = jest.fn().mockResolvedValue({ data: fallbackData })
  const fallbackLimit = jest.fn(() => ({ get: fallbackGet }))
  const fallbackSkip = jest.fn(() => ({ limit: fallbackLimit }))
  const where = jest.fn(() => ({
    orderBy,
    skip: fallbackSkip
  }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "bookings") {
        return { where }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    orderBy,
    fallbackSkip,
    fallbackLimit
  }
}

async function loadBookingMyListWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingMyList/index")
  })

  return mod
}

describe("cloudfunctions/bookingMyList integration", () => {
  test("分页查询返回 hasMore", async () => {
    const mocks = createMockDb({
      bookingsData: [
        { _id: "b1", vehicleName: "A" },
        { _id: "b2", vehicleName: "B" },
        { _id: "b3", vehicleName: "C" }
      ]
    })

    const mod = await loadBookingMyListWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ page: 1, pageSize: 2 })

    expect(res.ok).toBe(true)
    expect(res.page).toBe(1)
    expect(res.pageSize).toBe(2)
    expect(res.hasMore).toBe(true)
    expect(res.list).toHaveLength(2)
    expect(mocks.where).toHaveBeenCalledWith({ openid: "user_openid" })
    expect(mocks.orderBy).toHaveBeenCalledWith("createdAt", "desc")
    expect(mocks.skip).toHaveBeenCalledWith(2)
    expect(mocks.limit).toHaveBeenCalledWith(3)
  })

  test("未登录返回 UNAUTHORIZED", async () => {
    const mocks = createMockDb({
      bookingsData: []
    })

    const mod = await loadBookingMyListWith({ openid: "", mockDb: mocks.db })
    const res = await mod.main({ page: 0, pageSize: 20 })

    expect(res).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
      message: "未获取到用户身份"
    })
  })

  test("缺少复合索引时在云函数内排序并分页", async () => {
    const mocks = createFallbackMockDb({
      fallbackData: [
        { _id: "b1", vehicleName: "A", createdAt: "2026-07-01T00:00:00.000Z" },
        { _id: "b3", vehicleName: "C", createdAt: "2026-07-03T00:00:00.000Z" },
        { _id: "b2", vehicleName: "B", createdAt: "2026-07-02T00:00:00.000Z" }
      ]
    })

    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mod = await loadBookingMyListWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ page: 0, pageSize: 2 })

    expect(res.ok).toBe(true)
    expect(res.hasMore).toBe(true)
    expect(res.list.map((item) => item.id)).toEqual(["b3", "b2"])
    expect(mocks.orderBy).toHaveBeenCalledWith("createdAt", "desc")
    expect(mocks.fallbackSkip).toHaveBeenCalledWith(0)
    expect(mocks.fallbackLimit).toHaveBeenCalledWith(100)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
