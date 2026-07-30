jest.mock("wx-server-sdk")

function createMockDb({ rolesData, addResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const rolesSet = jest.fn().mockResolvedValue(addResult)
  const rolesDoc = jest.fn(() => ({ set: rolesSet }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { limit: rolesLimit, doc: rolesDoc }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesGet,
    rolesDoc,
    rolesSet,
    rolesLimit,
    auditAdd,
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
  afterEach(() => {
    delete process.env.BOOTSTRAP_TOKEN
  })

  test("roles 为空且口令正确时，当前用户初始化为首个管理员", async () => {
    process.env.BOOTSTRAP_TOKEN = "secret_token"
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "first_admin_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({ token: "secret_token" })

    expect(res).toEqual({
      ok: true,
      openid: "first_admin_openid",
      initialized: true,
      alreadyAdmin: false,
      message: "已初始化为首个管理员"
    })
    expect(mocks.rolesLimit).toHaveBeenCalledWith(100)
    expect(mocks.rolesDoc).toHaveBeenCalledWith("bootstrap_admin")
    expect(mocks.rolesSet).toHaveBeenCalledWith({
      data: {
        openid: "first_admin_openid",
        role: "admin",
        bootstrap: true,
        createdAt: mocks.serverDateValue,
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "first_admin_openid",
        action: "bootstrapAdmin",
        targetOpenid: "first_admin_openid",
        bootstrap: true,
        tokenProtected: true,
        createdAt: mocks.serverDateValue
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
    expect(mocks.rolesSet).not.toHaveBeenCalled()
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
    expect(mocks.rolesSet).not.toHaveBeenCalled()
  })

  test("未设置 BOOTSTRAP_TOKEN 时默认关闭初始化", async () => {
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
      ok: false,
      code: "BOOTSTRAP_DISABLED",
      message: "管理员初始化未启用，请先配置初始化口令"
    })
    expect(mocks.rolesSet).not.toHaveBeenCalled()
  })

  test("设置 BOOTSTRAP_TOKEN 后必须提供正确口令", async () => {
    process.env.BOOTSTRAP_TOKEN = "secret_token"
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "first_admin_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({ token: "wrong_token" })

    expect(res).toEqual({
      ok: false,
      code: "BOOTSTRAP_TOKEN_REQUIRED",
      message: "管理员初始化口令不正确"
    })
    expect(mocks.rolesSet).not.toHaveBeenCalled()
  })

  test("缺少用户身份时拒绝初始化", async () => {
    process.env.BOOTSTRAP_TOKEN = "secret_token"
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({ token: "secret_token" })

    expect(res).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
      message: "未获取到用户身份"
    })
    expect(mocks.rolesGet).not.toHaveBeenCalled()
    expect(mocks.rolesSet).not.toHaveBeenCalled()
  })
})
