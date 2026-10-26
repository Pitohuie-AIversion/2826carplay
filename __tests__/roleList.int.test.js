jest.mock("wx-server-sdk")

function createMockDb({ rolesData }) {
  const rolesLimit = jest.fn((limitValue) => ({
    get: jest.fn().mockResolvedValue({ data: rolesData.slice(0, limitValue) })
  }))
  const rolesSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({ data: rolesData.slice(offset, offset + limitValue) })
    }))
  }))
  const authField = jest.fn()
  const rolesWhere = jest.fn((filter) => ({
    field: jest.fn((fields) => {
      authField(fields)
      return {
        limit: jest.fn((limitValue) => ({
          get: jest.fn().mockResolvedValue({
            data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
          })
        }))
      }
    })
  }))
  const listField = jest.fn(() => ({
    limit: rolesLimit,
    skip: rolesSkip
  }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return {
          where: rolesWhere,
          field: listField
        }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    authField,
    listField,
    rolesLimit,
    rolesSkip
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
    expect(res.page).toBe(0)
    expect(res.pageSize).toBe(20)
    expect(res.hasMore).toBe(false)
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
    expect(mocks.authField.mock.calls[0][0]).not.toHaveProperty("openid")
    expect(mocks.listField.mock.calls[0][0]).toEqual(
      expect.objectContaining({ _id: true, openid: true, permissions: true })
    )
    expect(mocks.listField.mock.calls[0][0]).not.toHaveProperty("createdByOpenid")
    expect(mocks.listField.mock.calls[0][0]).not.toHaveProperty("updatedByOpenid")
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

  test("角色超过 200 条时仍可分页读取后续记录", async () => {
    const rolesData = [
      { _id: "admin", openid: "admin_openid", role: "admin" },
      ...Array.from({ length: 204 }, (_, index) => ({
        _id: `r${index}`,
        openid: `user_${String(index).padStart(3, "0")}`,
        permissions: ["vehicle_manage"]
      }))
    ]
    const mocks = createMockDb({ rolesData })
    const mod = await loadRoleListWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({ page: 10, pageSize: 20 })

    expect(res.ok).toBe(true)
    expect(res.page).toBe(10)
    expect(res.pageSize).toBe(20)
    expect(res.hasMore).toBe(false)
    expect(res.list).toHaveLength(5)
    expect(res.list.map((item) => item.openid)).toEqual([
      "user_199",
      "user_200",
      "user_201",
      "user_202",
      "user_203"
    ])
    expect(mocks.rolesSkip).toHaveBeenCalledWith(0)
    expect(mocks.rolesSkip).toHaveBeenCalledWith(100)
    expect(mocks.rolesSkip).toHaveBeenCalledWith(200)
  })

  test.each([
    [2000, 99, 20, false, false],
    [2001, 0, 20, true, true],
    [2001, 99, 20, true, false],
    [2001, 100, 0, true, false]
  ])("%i 条角色的第 %i 页明确标记截断且不引导空页", async (recordCount, page, expectedLength, truncated, hasMore) => {
    const rolesData = [
      { _id: "admin", openid: "admin_openid", role: "admin" },
      ...Array.from({ length: recordCount - 1 }, (_, index) => ({
        _id: `r${index}`,
        openid: `user_${String(index).padStart(4, "0")}`,
        permissions: ["vehicle_manage"],
        createdByOpenid: "private_creator",
        updatedByOpenid: "private_editor"
      }))
    ]
    const mocks = createMockDb({ rolesData })
    const mod = await loadRoleListWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({ page, pageSize: 20 })

    expect(res).toMatchObject({ ok: true, page, pageSize: 20, truncated, hasMore })
    expect(res.list).toHaveLength(expectedLength)
    expect(res.list).toEqual(rolesData.slice(0, 2000).slice(page * 20, (page + 1) * 20).map((item) => ({
      id: item._id,
      openid: item.openid,
      isAdmin: item.role === "admin",
      permissions: item.role === "admin" ? ["admin", "vehicle_manage", "booking_manage"] : ["vehicle_manage"],
      createdAt: "",
      updatedAt: ""
    })))
    expect(mocks.rolesSkip.mock.calls.map(([offset]) => offset)).toEqual(Array.from({ length: 21 }, (_, index) => index * 100))
    expect(mocks.rolesSkip.mock.results.map(({ value }) => value.limit.mock.calls[0][0])).toEqual([
      ...Array(20).fill(100), 1
    ])
    expect(mocks.authField.mock.calls[0][0]).not.toHaveProperty("openid")
    for (const [fields] of mocks.listField.mock.calls) {
      expect(fields).toMatchObject({ _id: true, openid: true, role: true, roles: true, permissions: true, isAdmin: true, admin: true })
      expect(fields).not.toHaveProperty("createdByOpenid")
      expect(fields).not.toHaveProperty("updatedByOpenid")
    }
  })
})
