jest.mock("wx-server-sdk")

function createMockDb({ rolesData, auditData }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({
        data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
      })
    }))
  }))

  const auditGet = jest.fn().mockResolvedValue({ data: auditData })
  const auditLimit = jest.fn(() => ({ get: auditGet }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "audit_logs") {
        return { limit: auditLimit }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    auditLimit
  }
}

async function loadAuditLogListWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/auditLogList/index")
  })

  return mod
}

describe("cloudfunctions/auditLogList integration", () => {
  test("admin 可查询并分页", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData: [
        { _id: "a1", action: "roleUpsert", openid: "admin_openid", targetOpenid: "u1", createdAt: "2026-07-16T00:00:00.000Z" },
        { _id: "a2", action: "operationConfigUpdate", openid: "admin_openid", changedKeys: ["brandName"], createdAt: "2026-07-16T01:00:00.000Z" }
      ]
    })

    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ page: 0, pageSize: 1 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(2)
    expect(res.list).toHaveLength(1)
    expect(res.hasMore).toBe(true)
  })

  test("action 可筛选", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      auditData: [
        { _id: "a1", action: "roleUpsert", openid: "admin_openid", createdAt: "2026-07-16T00:00:00.000Z" },
        { _id: "a2", action: "operationConfigUpdate", openid: "admin_openid", createdAt: "2026-07-16T01:00:00.000Z" }
      ]
    })

    const mod = await loadAuditLogListWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ action: "roleUpsert" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.list[0].action).toBe("roleUpsert")
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "user_openid", role: "user" }],
      auditData: []
    })

    const mod = await loadAuditLogListWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({})

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.auditLimit).not.toHaveBeenCalled()
  })
})

