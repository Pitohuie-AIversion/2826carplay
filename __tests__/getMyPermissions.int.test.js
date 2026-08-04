jest.mock("wx-server-sdk")

function createMockDb({ rolesData }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesField = jest.fn(() => ({ limit: rolesLimit }))
  const rolesWhere = jest.fn(() => ({ field: rolesField }))

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
    rolesField,
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
      isAdmin: true,
      permissions: ["admin", "vehicle_manage", "booking_manage"],
      canManageRoles: true,
      canManageConfig: true,
      canViewAuditLogs: true,
      canViewErrorLogs: true,
      canManageVehicles: true,
      canManageBookings: true
    })
    expect(mocks.rolesField).toHaveBeenCalledWith({
      role: true,
      roles: true,
      permissions: true,
      isAdmin: true,
      admin: true
    })
    expect(res).not.toHaveProperty("openid")
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
    expect(res.canViewAuditLogs).toBe(false)
    expect(res.canViewErrorLogs).toBe(false)
    expect(res.canManageVehicles).toBe(true)
    expect(res.canManageBookings).toBe(true)
  })

  test.each([
    [{ roles: ["admin"] }, "roles 数组"],
    [{ isAdmin: true }, "isAdmin 标记"],
    [{ admin: true }, "admin 标记"]
  ])("兼容历史管理员字段：%s（%s）", async (roleRecord) => {
    const mocks = createMockDb({ rolesData: [roleRecord] })
    const mod = await loadGetMyPermissionsWith({
      openid: "legacy_admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main()

    expect(res).toMatchObject({
      ok: true,
      isAdmin: true,
      canManageRoles: true,
      canManageConfig: true,
      canViewAuditLogs: true,
      canViewErrorLogs: true,
      canManageVehicles: true,
      canManageBookings: true
    })
  })

  test("身份缺失时返回 UNAUTHORIZED 且不读取角色集合", async () => {
    const mocks = createMockDb({ rolesData: [{ role: "admin" }] })
    const mod = await loadGetMyPermissionsWith({
      openid: "",
      mockDb: mocks.db
    })

    const res = await mod.main()

    expect(res).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
      message: "未获取到用户身份"
    })
    expect(mocks.db.collection).not.toHaveBeenCalled()
  })

  test("角色查询失败时返回 INTERNAL_ERROR 而不是伪造无权限", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    const get = jest.fn().mockRejectedValue(new Error("database unavailable"))
    const db = {
      collection: jest.fn(() => ({
        where: jest.fn(() => ({
          field: jest.fn(() => ({
            limit: jest.fn(() => ({ get }))
          }))
        }))
      }))
    }
    const mod = await loadGetMyPermissionsWith({
      openid: "admin_openid",
      mockDb: db
    })

    const res = await mod.main()

    expect(res).toEqual({
      ok: false,
      code: "INTERNAL_ERROR",
      message: "获取权限信息失败，请稍后重试"
    })
    errorSpy.mockRestore()
  })
})
