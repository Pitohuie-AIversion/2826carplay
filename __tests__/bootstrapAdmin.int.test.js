jest.mock("wx-server-sdk")

const VALID_BOOTSTRAP_TOKEN = "bootstrap_admin_secure_token_2026_001"

function createMockDb({
  rolesData,
  addResult,
  bootstrapRecord = null,
  transactionSupported = true
}) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const authField = jest.fn()
  const rolesWhere = jest.fn((filter) => {
    const data = rolesData.filter((item) => item.openid === filter.openid)
    const authGet = jest.fn().mockResolvedValue({ data })
    const authLimit = jest.fn(() => ({ get: authGet }))
    const field = jest.fn((fields) => {
      authField(fields, filter)
      return { limit: authLimit }
    })
    return { field, limit: authLimit }
  })
  const rolesSet = jest.fn().mockResolvedValue(addResult)
  const bootstrapGet = jest.fn().mockResolvedValue({ data: bootstrapRecord })
  const rolesDoc = jest.fn(() => ({
    get: bootstrapGet,
    set: rolesSet
  }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const roleExistenceField = jest.fn(() => ({ limit: rolesLimit }))
  const transactionCollection = jest.fn((name) => {
    if (name !== "roles") {
      throw new Error(`Unexpected transaction collection: ${name}`)
    }
    return { doc: rolesDoc }
  })
  const runTransaction = jest.fn(async (callback) => ({
    result: await callback({ collection: transactionCollection }),
    errMsg: "runTransaction:ok"
  }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return {
          where: rolesWhere,
          field: roleExistenceField,
          limit: rolesLimit,
          doc: rolesDoc
        }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate,
    ...(transactionSupported ? { runTransaction } : {})
  }

  return {
    db,
    rolesGet,
    rolesWhere,
    authField,
    roleExistenceField,
    rolesDoc,
    rolesSet,
    rolesLimit,
    bootstrapGet,
    runTransaction,
    transactionCollection,
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
    process.env.BOOTSTRAP_TOKEN = VALID_BOOTSTRAP_TOKEN
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "first_admin_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({ token: VALID_BOOTSTRAP_TOKEN })

    expect(res).toEqual({
      ok: true,
      openid: "first_admin_openid",
      initialized: true,
      alreadyAdmin: false,
      message: "已初始化为首个管理员"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "first_admin_openid" })
    expect(mocks.authField).toHaveBeenCalledWith(
      {
        role: true,
        roles: true,
        permissions: true,
        isAdmin: true,
        admin: true
      },
      { openid: "first_admin_openid" }
    )
    expect(mocks.roleExistenceField).toHaveBeenCalledWith({ _id: true })
    expect(mocks.rolesLimit).toHaveBeenCalledWith(1)
    expect(mocks.runTransaction).toHaveBeenCalledWith(expect.any(Function), 3)
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

  test("并发请求发现初始化记录已被其他账号占用时不会覆盖", async () => {
    process.env.BOOTSTRAP_TOKEN = VALID_BOOTSTRAP_TOKEN
    const mocks = createMockDb({
      rolesData: [],
      bootstrapRecord: {
        openid: "winner_openid",
        role: "admin",
        bootstrap: true
      },
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "later_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({ token: VALID_BOOTSTRAP_TOKEN })

    expect(res).toEqual({
      ok: false,
      code: "BOOTSTRAP_LOCKED",
      message: "管理员已初始化，请联系现有管理员分配权限"
    })
    expect(mocks.bootstrapGet).toHaveBeenCalledTimes(1)
    expect(mocks.rolesSet).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("云函数依赖不支持事务时保持初始化关闭", async () => {
    process.env.BOOTSTRAP_TOKEN = VALID_BOOTSTRAP_TOKEN
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" },
      transactionSupported: false
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "first_admin_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({ token: VALID_BOOTSTRAP_TOKEN })

    expect(res).toEqual({
      ok: false,
      code: "BOOTSTRAP_DISABLED",
      message: "管理员初始化未启用，请升级云函数依赖后重试"
    })
    expect(mocks.rolesSet).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
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
      message: "管理员初始化未启用，请配置 32 至 256 位随机口令"
    })
    expect(mocks.rolesSet).not.toHaveBeenCalled()
  })

  test("配置的 BOOTSTRAP_TOKEN 少于 32 位时拒绝初始化", async () => {
    process.env.BOOTSTRAP_TOKEN = "too_short"
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "first_admin_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({ token: "too_short" })

    expect(res).toEqual({
      ok: false,
      code: "BOOTSTRAP_DISABLED",
      message: "管理员初始化未启用，请配置 32 至 256 位随机口令"
    })
    expect(mocks.rolesSet).not.toHaveBeenCalled()
  })

  test("设置 BOOTSTRAP_TOKEN 后必须提供正确口令", async () => {
    process.env.BOOTSTRAP_TOKEN = VALID_BOOTSTRAP_TOKEN
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "first_admin_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({
      token: "wrong_bootstrap_admin_token_2026_001"
    })

    expect(res).toEqual({
      ok: false,
      code: "BOOTSTRAP_TOKEN_REQUIRED",
      message: "管理员初始化口令不正确"
    })
    expect(mocks.rolesSet).not.toHaveBeenCalled()
  })

  test("超长初始化口令不会进入写入流程", async () => {
    process.env.BOOTSTRAP_TOKEN = VALID_BOOTSTRAP_TOKEN
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "first_admin_openid",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({ token: "x".repeat(257) })

    expect(res).toEqual({
      ok: false,
      code: "BOOTSTRAP_TOKEN_REQUIRED",
      message: "管理员初始化口令不正确"
    })
    expect(mocks.rolesSet).not.toHaveBeenCalled()
  })

  test("缺少用户身份时拒绝初始化", async () => {
    process.env.BOOTSTRAP_TOKEN = VALID_BOOTSTRAP_TOKEN
    const mocks = createMockDb({
      rolesData: [],
      addResult: { _id: "role_1" }
    })

    const bootstrapAdmin = await loadBootstrapAdminWith({
      openid: "",
      mockDb: mocks.db
    })

    const res = await bootstrapAdmin.main({ token: VALID_BOOTSTRAP_TOKEN })

    expect(res).toEqual({
      ok: false,
      code: "UNAUTHORIZED",
      message: "未获取到用户身份"
    })
    expect(mocks.rolesGet).not.toHaveBeenCalled()
    expect(mocks.rolesSet).not.toHaveBeenCalled()
  })
})
