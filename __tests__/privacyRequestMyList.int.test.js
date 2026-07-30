jest.mock("wx-server-sdk")

function createMockDb({ records, orderedError = null }) {
  const orderedGet = orderedError
    ? jest.fn().mockRejectedValue(orderedError)
    : jest.fn().mockResolvedValue({ data: records })
  const orderedLimit = jest.fn(() => ({ get: orderedGet }))
  const orderedSkip = jest.fn(() => ({ limit: orderedLimit }))
  const orderBy = jest.fn(() => ({ skip: orderedSkip }))
  const fallbackGet = jest.fn().mockResolvedValue({ data: records })
  const fallbackLimit = jest.fn(() => ({ get: fallbackGet }))
  const where = jest.fn(() => ({
    orderBy,
    limit: fallbackLimit
  }))

  return {
    db: {
      collection: jest.fn((name) => {
        if (name === "privacy_requests") {
          return { where }
        }
        throw new Error(`Unexpected collection: ${name}`)
      })
    },
    where,
    orderBy,
    fallbackLimit
  }
}

async function loadModule(openid, mockDb) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/privacyRequestMyList/index")
  })
  return mod
}

describe("cloudfunctions/privacyRequestMyList integration", () => {
  test("只按当前 OpenID 查询并返回用户可见字段", async () => {
    const mocks = createMockDb({
      records: [
        {
          _id: "p1",
          openid: "user_openid",
          type: "access",
          description: "查询信息",
          status: "completed",
          resolutionNote: "已通过客服反馈",
          handledBy: "admin_openid",
          createdAt: "2026-07-20T00:00:00.000Z"
        }
      ]
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({})

    expect(res.ok).toBe(true)
    expect(mocks.where).toHaveBeenCalledWith({ openid: "user_openid" })
    expect(res.list[0]).toEqual({
      id: "p1",
      type: "access",
      description: "查询信息",
      status: "completed",
      resolutionNote: "已通过客服反馈",
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: ""
    })
    expect(res.list[0].handledBy).toBeUndefined()
    expect(res.list[0].openid).toBeUndefined()
  })

  test("缺少复合索引时自动降级并按时间排序", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      orderedError: new Error("missing index"),
      records: [
        { _id: "old", createdAt: "2026-07-01T00:00:00.000Z" },
        { _id: "new", createdAt: "2026-07-02T00:00:00.000Z" }
      ]
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({ pageSize: 1 })

    expect(res.ok).toBe(true)
    expect(res.list[0].id).toBe("new")
    expect(mocks.fallbackLimit).toHaveBeenCalledWith(501)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test("没有 OpenID 时拒绝查询", async () => {
    const mocks = createMockDb({ records: [] })
    const mod = await loadModule("", mocks.db)

    const res = await mod.main({})

    expect(res.code).toBe("UNAUTHORIZED")
    expect(mocks.where).not.toHaveBeenCalled()
  })
})
