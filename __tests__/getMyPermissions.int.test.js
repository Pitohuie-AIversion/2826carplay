jest.mock("wx-server-sdk")

function createMockDb({ rolesData }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
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

async function loadGetMyPermissionsWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/getMyPermissions/index")
  })

  return mod
}

describe("cloudfunctions/getMyPermissions integration", () => {
  test("admin 返回全量能力", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }]
    })

    const mod = await loadGetMyPermissionsWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main()

    expect(res).toEqual({
      ok: true,
      openid: "admin_openid",
      isAdmin: true,
      permissions: ["admin", "vehicle_manage", "booking_manage"],
      canManageRoles: true,
      canManageConfig: true,
      canManageVehicles: true,
      canManageBookings: true
    })
  })

  test("scoped role 返回对应能力", async () => {
    const mocks = createMockDb({
      rolesData: [{ roles: ["vehicle_manager"] }, { permissions: ["booking_manage"] }]
    })

    const mod = await loadGetMyPermissionsWith({
      openid: "ops_openid",
      mockDb: mocks.db
    })

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.isAdmin).toBe(false)
    expect(res.permissions).toEqual(["vehicle_manage", "booking_manage"])
    expect(res.canManageRoles).toBe(false)
    expect(res.canManageConfig).toBe(false)
    expect(res.canManageVehicles).toBe(true)
    expect(res.canManageBookings).toBe(true)
  })
})
