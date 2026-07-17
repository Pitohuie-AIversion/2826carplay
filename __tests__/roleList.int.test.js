jest.mock("wx-server-sdk")

function createMockDb({ rolesData }) {
  const rolesLimit = jest.fn((limitValue) => ({
    get: jest.fn().mockResolvedValue({ data: rolesData.slice(0, limitValue) })
  }))
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({
        data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
      })
    }))
  }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return {
          where: rolesWhere,
          limit: rolesLimit
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    rolesLimit
  }
}

async function loadRoleListWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/roleList/index")
  })

  return mod
}

describe("cloudfunctions/roleList integration", () => {
  test("admin 可查看角色列表", async () => {
    const mocks = createMockDb({
      rolesData: [
        { _id: "r1", openid: "admin_openid", role: "admin" },
        { _id: "r2", openid: "vehicle_ops", roles: ["vehicle_manager"] },
        { _id: "r3", openid: "booking_ops", permissions: ["booking_manage"] }
      ]
    })

    const mod = await loadRoleListWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.list).toEqual([
      expect.objectContaining({
        openid: "admin_openid",
        isAdmin: true,
        permissions: ["admin", "vehicle_manage", "booking_manage"]
      }),
      expect.objectContaining({
        openid: "booking_ops",
        isAdmin: false,
        permissions: ["booking_manage"]
      }),
      expect.objectContaining({
        openid: "vehicle_ops",
        isAdmin: false,
        permissions: ["vehicle_manage"]
      })
    ])
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "user_openid", role: "user" }]
    })

    const mod = await loadRoleListWith({
      openid: "user_openid",
      mockDb: mocks.db
    })

    const res = await mod.main()

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
  })
})
