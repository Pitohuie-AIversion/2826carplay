jest.mock("wx-server-sdk")

function createMockDb({ rolesData, errorData }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({
        data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
      })
    }))
  }))

  const errorGet = jest.fn().mockResolvedValue({ data: errorData })
  const errorLimit = jest.fn(() => ({ get: errorGet }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "error_logs") {
        return { limit: errorLimit }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    errorLimit
  }
}

async function loadErrorLogListWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/errorLogList/index")
  })

  return mod
}

describe("cloudfunctions/errorLogList integration", () => {
  test("admin 可查询并分页", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      errorData: [
        { _id: "e1", function: "roleUpsert", openid: "admin_openid", errorMessage: "x", createdAt: "2026-07-16T00:00:00.000Z" },
        { _id: "e2", function: "operationConfigUpdate", openid: "admin_openid", errorMessage: "y", createdAt: "2026-07-16T01:00:00.000Z" }
      ]
    })

    const mod = await loadErrorLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ page: 0, pageSize: 1 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(2)
    expect(res.list).toHaveLength(1)
    expect(res.hasMore).toBe(true)
  })

  test("func 可筛选", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      errorData: [
        { _id: "e1", function: "roleUpsert", openid: "admin_openid", errorMessage: "x", createdAt: "2026-07-16T00:00:00.000Z" },
        { _id: "e2", function: "operationConfigUpdate", openid: "admin_openid", errorMessage: "y", createdAt: "2026-07-16T01:00:00.000Z" }
      ]
    })

    const mod = await loadErrorLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ func: "roleUpsert" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].function).toBe("roleUpsert")
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "user_openid", role: "user" }],
      errorData: []
    })

    const mod = await loadErrorLogListWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({})

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.errorLimit).not.toHaveBeenCalled()
  })
})

