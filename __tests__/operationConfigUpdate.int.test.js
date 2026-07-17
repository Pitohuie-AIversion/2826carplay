jest.mock("wx-server-sdk")

function createMockDb({ rolesData, configData }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({
        data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
      })
    }))
  }))

  const configWhere = jest.fn((filter) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({
        data: configData.filter((item) => item.key === filter.key).slice(0, limitValue)
      })
    }))
  }))

  const configAdd = jest.fn().mockResolvedValue({ _id: "cfg_1" })
  const configUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const configDoc = jest.fn(() => ({ update: configUpdate }))
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "app_configs") {
        return { where: configWhere, add: configAdd, doc: configDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    configAdd,
    configDoc,
    configUpdate,
    serverDateValue
  }
}

async function loadOperationConfigUpdateWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/operationConfigUpdate/index")
  })

  return mod
}

describe("cloudfunctions/operationConfigUpdate integration", () => {
  test("admin 可创建运营配置", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      configData: []
    })

    const mod = await loadOperationConfigUpdateWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({
      config: {
        brandName: "超跑车库",
        servicePhone: "18800000000"
      }
    })

    expect(res.ok).toBe(true)
    expect(res.config.brandName).toBe("超跑车库")
    expect(mocks.configAdd).toHaveBeenCalled()
  })

  test("admin 可更新运营配置", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      configData: [{ _id: "cfg_existing", key: "operation_settings" }]
    })

    const mod = await loadOperationConfigUpdateWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({
      config: {
        brandName: "更新后的车库"
      }
    })

    expect(res.ok).toBe(true)
    expect(mocks.configDoc).toHaveBeenCalledWith("cfg_existing")
    expect(mocks.configUpdate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        key: "operation_settings",
        updatedAt: mocks.serverDateValue,
        updatedByOpenid: "admin_openid"
      })
    })
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "user_openid", role: "user" }],
      configData: []
    })

    const mod = await loadOperationConfigUpdateWith({
      openid: "user_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({
      config: {
        brandName: "无权限"
      }
    })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
  })
})
