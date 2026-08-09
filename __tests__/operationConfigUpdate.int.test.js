jest.mock("wx-server-sdk")

function createMockDb({ rolesData, configData }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({
        data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
      })
    }))
  }))

  const configGetFor = (filter, limitValue) => ({
    data: configData.filter((item) => item.key === filter.key).slice(0, limitValue)
  })
  const configField = jest.fn((fields, filter) => ({ fields, filter }))
  const configWhere = jest.fn((filter) => {
    const configLimit = jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue(configGetFor(filter, limitValue))
    }))
    const field = jest.fn((fields) => {
      configField(fields, filter)
      return { limit: configLimit }
    })
    return { field, limit: configLimit }
  })

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
    configField,
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
        servicePhone: "18800000000",
        cityOptions: ["杭州", "杭州", "上海"]
      }
    })

    expect(res.ok).toBe(true)
    expect(res.config.brandName).toBe("超跑车库")
    expect(res.config.cityOptions).toEqual(["杭州", "上海"])
    expect(mocks.configAdd).toHaveBeenCalled()
    expect(mocks.configField).toHaveBeenCalledWith(
      { _id: true, value: true },
      { key: "operation_settings" }
    )
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

  test("非法客服电话在写入前被拒绝", async () => {
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
        servicePhone: "请联系客服"
      }
    })

    expect(res.code).toBe("VALIDATION_ERROR")
    expect(res.message).toBe("客服电话格式不正确")
    expect(mocks.configAdd).not.toHaveBeenCalled()
    expect(mocks.configUpdate).not.toHaveBeenCalled()
  })

  test("非法订阅模板 ID 在写入前被拒绝", async () => {
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
        servicePhone: "18800000000",
        bookingStatusTemplateId: "bad id"
      }
    })

    expect(res.code).toBe("VALIDATION_ERROR")
    expect(res.message).toBe("订阅消息模板 ID 格式不正确")
    expect(mocks.configAdd).not.toHaveBeenCalled()
  })

  test("租赁规则会归一化后写入运营配置", async () => {
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
        servicePhone: "18800000000",
        rentalTerms: {
          includedText: "  基础日租仅含车辆使用费  ",
          depositText: "明确告知押金"
        }
      }
    })

    expect(res.ok).toBe(true)
    expect(res.config.rentalTerms.includedText).toBe("基础日租仅含车辆使用费")
    expect(res.config.rentalTerms.depositText).toBe("明确告知押金")
    expect(res.config.rentalTerms.energyText).toEqual(expect.any(String))
    expect(mocks.configAdd).toHaveBeenCalledWith({
      data: expect.objectContaining({
        value: expect.objectContaining({
          rentalTerms: expect.objectContaining({
            includedText: "基础日租仅含车辆使用费"
          })
        })
      })
    })
  })
})
