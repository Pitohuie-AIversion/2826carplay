jest.mock("wx-server-sdk")

function createMockDb({ rolesData, addResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const rolesAdd = jest.fn().mockResolvedValue(addResult)

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { limit: rolesLimit, add: rolesAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesGet,
    rolesAdd,
    rolesLimit,
    serverDateValue
  }
}

async function loadBootstrapAdminWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bootstrapAdmin/index")
  })

  return mod
}

describe("cloudfunctions/bootstrapAdmin integration", () => {
  test("roles 为空时，当前用户初始化为首个管理员", async () => {
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "first_admin_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main()

    expect(res).toEqual({
      ok: true,
      openid: "first_admin_openid",
      initialized: true,
      alreadyAdmin: false,
      message: "已初始化为首个管理员"
    })
    expect(mocks.rolesLimit).toHaveBeenCalledWith(100)
    expect(mocks.rolesAdd).toHaveBeenCalledWith({
      data: {
        openid: "first_admin_openid",
        role: "admin",
        bootstrap: true,
        createdAt: mocks.serverDateValue,
        updatedAt: mocks.serverDateValue
      }
    })
  })

  test("当前用户已是管理员时直接返回成功", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main()

    expect(res).toEqual({
      ok: true,
      openid: "admin_openid",
      initialized: false,
      alreadyAdmin: true,
      message: "当前账号已是管理员"
    })
    expect(mocks.rolesAdd).not.toHaveBeenCalled()
  })

  test("roles 已存在其他记录时返回 BOOTSTRAP_LOCKED", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "someone_else", role: "admin" }],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "new_user_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main()

    expect(res).toEqual({
      ok: false,
      code: "BOOTSTRAP_LOCKED",
      message: "管理员已初始化，请联系现有管理员分配权限"
    })
    expect(mocks.rolesAdd).not.toHaveBeenCalled()
  })
})
