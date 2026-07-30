jest.mock("wx-server-sdk")

function createMockDb({ roles, records }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limit) => ({
      get: jest.fn().mockResolvedValue({
        data: roles.filter((item) => item.openid === filter.openid).slice(0, limit)
      })
    }))
  }))
  const privacySkip = jest.fn((offset) => ({
    limit: jest.fn((limit) => ({
      get: jest.fn().mockResolvedValue({ data: records.slice(offset, offset + limit) })
    }))
  }))
  const privacyOrderBy = jest.fn(() => ({ skip: privacySkip }))

  return {
    db: {
      collection: jest.fn((name) => {
        if (name === "roles") {
          return { where: rolesWhere }
        }
        if (name === "privacy_requests") {
          return {
            orderBy: privacyOrderBy,
            skip: privacySkip
          }
        }
        throw new Error(`Unexpected collection: ${name}`)
      })
    },
    privacyOrderBy
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
    mod = require("../cloudfunctions/privacyRequestList/index")
  })
  return mod
}

describe("cloudfunctions/privacyRequestList integration", () => {
  test("管理员可按状态和类型筛选", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      records: [
        {
          _id: "p1",
          openid: "user_1",
          type: "deletion",
          status: "pending",
          description: "删除资料",
          createdAt: "2026-07-20T00:00:00.000Z"
        },
        {
          _id: "p2",
          openid: "user_2",
          type: "access",
          status: "completed",
          description: "查询资料",
          createdAt: "2026-07-21T00:00:00.000Z"
        }
      ]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({ type: "deletion", status: "pending" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].id).toBe("p1")
    expect(mocks.privacyOrderBy).toHaveBeenCalledWith("createdAt", "desc")
  })

  test("管理员可按 OpenID 搜索", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", roles: ["admin"] }],
      records: [
        { _id: "p1", openid: "USER_ALPHA", type: "access", status: "pending" },
        { _id: "p2", openid: "USER_BETA", type: "access", status: "pending" }
      ]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({ keyword: "alpha" })

    expect(res.total).toBe(1)
    expect(res.list[0].openid).toBe("USER_ALPHA")
  })

  test("管理员可筛选用户已撤回的申请", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      records: [
        {
          _id: "p_cancelled",
          openid: "user_1",
          type: "correction",
          status: "cancelled",
          description: "更正资料",
          createdAt: "2026-07-20T00:00:00.000Z"
        },
        {
          _id: "p_pending",
          openid: "user_2",
          type: "access",
          status: "pending",
          description: "查询资料",
          createdAt: "2026-07-21T00:00:00.000Z"
        }
      ]
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({ status: "cancelled" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].id).toBe("p_cancelled")
  })

  test("非管理员不可查看申请正文", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "user_openid", role: "user" }],
      records: [{ _id: "p1", description: "敏感申请正文" }]
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({})

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.privacyOrderBy).not.toHaveBeenCalled()
  })
})
