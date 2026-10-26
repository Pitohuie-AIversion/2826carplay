jest.mock("wx-server-sdk")

function createMockDb({ rolesData }) {
  const rolesUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const rolesSet = jest.fn().mockResolvedValue({ _id: "new_role_id" })
  const rolesDoc = jest.fn(() => ({
    update: rolesUpdate,
    set: rolesSet
  }))
  const rolesField = jest.fn()
  const rolesWhere = jest.fn((filter) => ({
    field: jest.fn((fields) => {
      rolesField(fields)
      return {
        limit: jest.fn((limitValue) => ({
          get: jest.fn().mockResolvedValue({
            data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
          })
        }))
      }
    })
  }))
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return {
          where: rolesWhere,
          doc: rolesDoc
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesDoc,
    rolesSet,
    rolesUpdate,
    rolesWhere,
    rolesField,
    serverDateValue
  }
}

async function loadRoleUpsertWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/roleUpsert/index")
  })

  return mod
}

describe("cloudfunctions/roleUpsert integration", () => {
  test.each([undefined, null, false, "vehicle_manage", {}, [null], [false], [""], ["   "], [["vehicle_manage"]]].map((value) => [value]))("拒绝非法权限列表 %j，不把错误输入当作撤销全部权限", async (permissions) => {
    const target = { _id: "role_ops", openid: "ops_openid", role: "operator", permissions: ["vehicle_manage"] }
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }, target] })
    mocks.rolesUpdate.mockImplementation(async ({ data }) => { Object.assign(target, data); return { stats: { updated: 1 } } })
    const mod = await loadRoleUpsertWith({ openid: "admin_openid", mockDb: mocks.db })
    expect(await mod.main({ openid: "ops_openid", permissions })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(mocks.rolesUpdate).not.toHaveBeenCalled()
    expect(mocks.rolesSet).not.toHaveBeenCalled()
    expect(target.permissions).toEqual(["vehicle_manage"])
  })

  test.each([123456, ["ops_openid"]].map((value) => [value]))("拒绝非文本账号 %j，不通过强制转换写入其他账号", async (openid) => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }] })
    const mod = await loadRoleUpsertWith({ openid: "admin_openid", mockDb: mocks.db })
    expect(await mod.main({ openid, permissions: ["vehicle_manage"] })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(mocks.rolesSet).not.toHaveBeenCalled()
    expect(mocks.rolesUpdate).not.toHaveBeenCalled()
  })

  test("合法权限仍可去除首尾空格和重复项", async () => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }] })
    const mod = await loadRoleUpsertWith({ openid: "admin_openid", mockDb: mocks.db })
    expect(await mod.main({ openid: " ops_openid ", permissions: [" vehicle_manage ", "vehicle_manage", "booking_manage"] })).toMatchObject({
      ok: true,
      openid: "ops_openid",
      permissions: ["vehicle_manage", "booking_manage"]
    })
    expect(mocks.rolesSet).toHaveBeenCalledTimes(1)
  })

  test("非法参数不会绕过管理员权限检查", async () => {
    const mocks = createMockDb({ rolesData: [{ openid: "member_openid", role: "member" }] })
    const mod = await loadRoleUpsertWith({ openid: "member_openid", mockDb: mocks.db })
    expect(await mod.main({ openid: 123456, permissions: null })).toMatchObject({ ok: false, code: "FORBIDDEN" })
    expect(mocks.rolesSet).not.toHaveBeenCalled()
    expect(mocks.rolesUpdate).not.toHaveBeenCalled()
  })

  test("撤销历史角色别名后，实际权限读取不再保留车辆或预约权限", async () => {
    const target = { _id: "role_ops", openid: "ops_openid", role: "vehicle_manager", roles: ["vehicle_manager", "booking_manager"], permissions: ["booking_manage"] }
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }, target] })
    mocks.rolesUpdate.mockImplementation(async ({ data }) => {
      Object.assign(target, data)
      return { stats: { updated: 1 } }
    })
    const mod = await loadRoleUpsertWith({ openid: "admin_openid", mockDb: mocks.db })
    expect((await mod.main({ openid: "ops_openid", permissions: [] })).ok).toBe(true)
    const cloud = require("wx-server-sdk")
    cloud.__setMockContext({ OPENID: "ops_openid" })
    const permissions = await require("../cloudfunctions/getMyPermissions/index").main()
    expect(permissions).toMatchObject({ ok: true, permissions: [], canManageVehicles: false, canManageBookings: false })
  })

  test("admin 可新增 scoped 权限", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }]
    })

    const mod = await loadRoleUpsertWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({
      openid: "ops_openid",
      permissions: ["vehicle_manage"]
    })

    expect(res).toEqual({
      ok: true,
      openid: "ops_openid",
      permissions: ["vehicle_manage"],
      updated: false,
      message: "权限已创建"
    })
    expect(mocks.rolesField).toHaveBeenCalledTimes(2)
    expect(mocks.rolesField.mock.calls[0][0]).not.toHaveProperty("openid")
    expect(mocks.rolesField.mock.calls[1][0]).not.toHaveProperty("createdByOpenid")
    expect(mocks.rolesField.mock.calls[1][0]).not.toHaveProperty("updatedByOpenid")
    expect(mocks.rolesDoc).toHaveBeenCalledWith("role_ec29837e250492cf7ed652e81e9")
    expect(mocks.rolesSet).toHaveBeenCalledWith({
      data: {
        openid: "ops_openid",
        role: "operator",
        roles: [],
        permissions: ["vehicle_manage"],
        updatedAt: mocks.serverDateValue,
        updatedByOpenid: "admin_openid",
        createdAt: mocks.serverDateValue,
        createdByOpenid: "admin_openid"
      }
    })
  })

  test("admin 可更新已有 scoped 权限", async () => {
    const mocks = createMockDb({
      rolesData: [
        { openid: "admin_openid", role: "admin" },
        { _id: "role_ops", openid: "ops_openid", role: "operator", permissions: ["vehicle_manage"] }
      ]
    })

    const mod = await loadRoleUpsertWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({
      openid: "ops_openid",
      permissions: ["booking_manage"]
    })

    expect(res).toEqual({
      ok: true,
      openid: "ops_openid",
      permissions: ["booking_manage"],
      updated: true,
      message: "权限已更新"
    })
    expect(mocks.rolesDoc).toHaveBeenCalledWith("role_ops")
    expect(mocks.rolesUpdate).toHaveBeenCalledWith({
      data: {
        openid: "ops_openid",
        role: "operator",
        roles: [],
        permissions: ["booking_manage"],
        updatedAt: mocks.serverDateValue,
        updatedByOpenid: "admin_openid"
      }
    })
  })

  test("不能修改管理员权限", async () => {
    const mocks = createMockDb({
      rolesData: [
        { openid: "admin_openid", role: "admin" },
        { openid: "target_admin", role: "admin" }
      ]
    })

    const mod = await loadRoleUpsertWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({
      openid: "target_admin",
      permissions: ["booking_manage"]
    })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "不能修改管理员权限"
    })
  })

  test("非法 OpenID 在写入数据库前被拒绝", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }]
    })
    const mod = await loadRoleUpsertWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({
      openid: "错误 OpenID",
      permissions: ["vehicle_manage"]
    })

    expect(res.code).toBe("VALIDATION_ERROR")
    expect(res.message).toBe("OpenID 格式不正确")
    expect(mocks.rolesSet).not.toHaveBeenCalled()
    expect(mocks.rolesUpdate).not.toHaveBeenCalled()
  })

  test("重复角色记录会全部同步，避免旧权限继续生效", async () => {
    const mocks = createMockDb({
      rolesData: [
        { openid: "admin_openid", role: "admin" },
        { _id: "role_ops_1", openid: "ops_openid", role: "operator", permissions: ["vehicle_manage"] },
        { _id: "role_ops_2", openid: "ops_openid", role: "operator", permissions: ["booking_manage"] }
      ]
    })

    const mod = await loadRoleUpsertWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({
      openid: "ops_openid",
      permissions: []
    })

    expect(res.ok).toBe(true)
    expect(res.updated).toBe(true)
    expect(mocks.rolesDoc).toHaveBeenCalledWith("role_ops_1")
    expect(mocks.rolesDoc).toHaveBeenCalledWith("role_ops_2")
    expect(mocks.rolesUpdate).toHaveBeenCalledTimes(2)
    expect(mocks.rolesUpdate).toHaveBeenNthCalledWith(1, {
      data: expect.objectContaining({
        openid: "ops_openid",
        role: "member",
        permissions: []
      })
    })
    expect(mocks.rolesUpdate).toHaveBeenNthCalledWith(2, {
      data: expect.objectContaining({
        openid: "ops_openid",
        role: "member",
        permissions: []
      })
    })
  })
})
