jest.mock("wx-server-sdk")

function createMockDb({ rolesData, configData }) {
  const records = JSON.parse(JSON.stringify(configData))
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limitValue) => ({
      get: jest.fn().mockResolvedValue({
        data: rolesData.filter((item) => item.openid === filter.openid).slice(0, limitValue)
      })
    }))
  }))

  const configGetFor = (filter, limitValue) => ({
    data: records.filter((item) => item.key === filter.key).slice(0, limitValue).map((item) => JSON.parse(JSON.stringify(item)))
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

  const configSet = jest.fn().mockResolvedValue({})
  const configUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const configDoc = jest.fn((id) => {
    const get = async () => ({ data: JSON.parse(JSON.stringify(records.find((item) => item._id === id) || null)) })
    return {
      field: () => ({ get }), get,
      update: async ({ data }) => {
        await configUpdate({ data })
        const current = records.find((item) => item._id === id)
        Object.assign(current, JSON.parse(JSON.stringify({ ...data, value: data.value.__replace })))
      },
      set: async ({ data }) => {
        await configSet({ data })
        const index = records.findIndex((item) => item._id === id)
        if (index >= 0) records.splice(index, 1)
        records.push({ _id: id, ...data })
      }
    }
  })
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "app_configs") {
        return { where: configWhere, doc: configDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate,
    command: { set: (value) => ({ __replace: value }) }
  }
  let tail = Promise.resolve()
  db.runTransaction = jest.fn((callback) => {
    const run = tail.then(async () => {
      const snapshot = JSON.parse(JSON.stringify(records))
      try { return await callback({ collection: () => ({ doc: configDoc }) }) }
      catch (error) { records.splice(0, records.length, ...snapshot); throw error }
    })
    tail = run.catch(() => {})
    return run
  })

  return {
    db,
    configSet,
    records,
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
  test("规范化后的同内容保存会真正持久化旧记录，响应、存储、再次读取保持一致且重试幂等", async () => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [{
      _id: "legacy", key: "operation_settings", revision: 3,
      value: { brandName: " 当前品牌 ", cityOptions: [...Array(20).fill("杭州"), "上海"] }
    }] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const input = { expectedRevision: 3, config: { brandName: "当前品牌", cityOptions: ["杭州", "上海"] } }
    const saved = await mod.main(input)
    expect(saved).toMatchObject({ ok: true, updated: true, revision: 4 })
    expect(mocks.records[0].value).toEqual(saved.config)
    const getter = require("../cloudfunctions/operationConfigGet/index")
    expect((await getter.main({ requireStoredConfig: true })).config).toEqual(saved.config)
    expect(await mod.main(input)).toMatchObject({ ok: true, updated: false, revision: 4, config: saved.config })
    expect(mocks.configUpdate).toHaveBeenCalledTimes(1)
  })

  test("旧记录需规范化时仍校验版本，过期管理员不能借同内容保存改写记录", async () => {
    const current = { _id: "legacy", key: "operation_settings", revision: 3, value: { brandName: " 当前品牌 " } }
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [current] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    expect(await mod.main({ expectedRevision: 2, config: { brandName: "当前品牌" } })).toMatchObject({ ok: false, code: "CONFIG_CONFLICT" })
    expect(mocks.records[0]).toEqual(current)
    expect(mocks.configUpdate).not.toHaveBeenCalled()
  })

  test.each([
    Array.from({ length: 21 }, (_, i) => `城市${i}`),
    ["城市".repeat(11)]
  ])("城市超出条数或单项限制时失败而非截断保存 %j", async (...cityOptions) => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    expect(await mod.main({ expectedRevision: 0, config: { cityOptions } })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(mocks.configSet).not.toHaveBeenCalled()
  })

  test("已清空业务文案和明确保存的旧文字在保存响应及再次读取中一致", async () => {
    const oldTexts = {
      mineUserDesc: "静态展示页，更多个人功能将在后续版本完善",
      garagePageSubtitle: "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页",
      bookingPrivacyTip: "提交预约即表示您同意我们仅将所填信息用于本次车辆预约沟通与联系确认。您可在【我的预约】查看与取消；如需删除预约记录或个人信息，请联系管理员处理。车辆档期、价格、押金及取还车规则以客服最终确认为准。"
    }
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [{
      _id: "settings", key: "operation_settings", value: { faqContent: "旧FAQ", rulesContent: "旧规则", rentalTerms: { includedText: "旧承诺" } }
    }] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const saved = await mod.main({ expectedRevision: 0, config: { ...oldTexts, faqContent: "", rulesContent: "", rentalTerms: { includedText: "" } } })
    expect(saved).toMatchObject({ ok: true, config: { ...oldTexts, faqContent: "", rulesContent: "" } })
    expect(Object.values(saved.config.rentalTerms)).toEqual(Array(9).fill(""))
    const getter = require("../cloudfunctions/operationConfigGet/index")
    const loaded = await getter.main({ requireStoredConfig: true })
    expect(loaded.config).toEqual(saved.config)
    expect(mocks.records[0].value).toEqual(saved.config)
  })

  test("两位管理员从相同版本编辑，后保存返回冲突且不会恢复已清空字段", async () => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [{
      _id: "legacy_random_id", key: "operation_settings", value: { brandName: "原品牌", servicePhone: "18800000000" }
    }] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const [first, second] = await Promise.all([
      mod.main({ expectedRevision: 0, config: { brandName: "原品牌", servicePhone: "" } }),
      mod.main({ expectedRevision: 0, config: { brandName: "另一个品牌", servicePhone: "18800000000" } })
    ])
    expect(first).toMatchObject({ ok: true, revision: 1 })
    expect(second).toMatchObject({ ok: false, code: "CONFIG_CONFLICT" })
    expect(mocks.records).toHaveLength(1)
    expect(mocks.records[0]).toMatchObject({ _id: "legacy_random_id", revision: 1, value: { servicePhone: "", brandName: "原品牌" } })
    expect(mocks.configSet).not.toHaveBeenCalled()
  })

  test("空集合并发首次保存只创建确定性记录，同内容重试不重复写入", async () => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const input = { expectedRevision: 0, config: { brandName: "首次品牌" } }
    const results = await Promise.all([mod.main(input), mod.main(input)])
    expect(results.every((result) => result.ok && result.revision === 1)).toBe(true)
    expect(results[1].updated).toBe(false)
    expect(mocks.records).toHaveLength(1)
    expect(mocks.records[0]._id).toBe("operation_settings")
    expect(mocks.configSet).toHaveBeenCalledTimes(1)
    expect(await mod.main(input)).toMatchObject({ ok: true, revision: 1, updated: false })
  })

  test("已版本化配置拒绝无版本修改，带最新基线的旧字段省略仍保留", async () => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [{
      _id: "legacy", key: "operation_settings", revision: 3,
      value: { brandName: "当前品牌", serviceHoursText: "营业时间", serviceHubs: [] }
    }] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    expect(await mod.main({ config: { brandName: "旧客户端" } })).toMatchObject({ ok: false, code: "CONFIG_VERSION_REQUIRED" })
    expect(mocks.configUpdate).not.toHaveBeenCalled()
    const saved = await mod.main({ expectedRevision: 3, config: { brandName: "新品牌" } })
    expect(saved).toMatchObject({ ok: true, revision: 4, config: { brandName: "新品牌", serviceHoursText: "营业时间", serviceHubs: [] } })
  })

  test("发现历史重复配置时明确失败，不随机覆盖某一条", async () => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [
      { _id: "one", key: "operation_settings" }, { _id: "two", key: "operation_settings" }
    ] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    expect(await mod.main({ config: { brandName: "新品牌" }, expectedRevision: 0 })).toMatchObject({ ok: false, code: "CONFIG_CONFLICT" })
    expect(mocks.db.runTransaction).not.toHaveBeenCalled()
  })

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
    expect(mocks.configSet).toHaveBeenCalled()
    expect(mocks.configField).toHaveBeenCalledWith(
      { _id: true, key: true, value: true, revision: true },
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
    expect(mocks.configSet).not.toHaveBeenCalled()
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
    expect(mocks.configSet).not.toHaveBeenCalled()
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
    expect(mocks.configSet).toHaveBeenCalledWith({
      data: expect.objectContaining({
        value: expect.objectContaining({
          rentalTerms: expect.objectContaining({
            includedText: "基础日租仅含车辆使用费"
          })
        })
      })
    })
  })

  test("保存客服参数、服务信息和网点并保留旧客户端未传字段", async () => {
    const savedHub = { id: "west_store", city: "杭州", name: "西湖店", address: "已核实地址", feeText: "到店免费取还", type: "store", latitude: 30.2, longitude: 120.1 }
    const current = { _id: "cfg_existing", key: "operation_settings", value: {
      servicePhone: "18800000000", serviceHoursText: "每日 10:00–18:00", emergencyPhone: "18800000001",
      wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/test-link", serviceHubs: [savedHub]
    } }
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [current] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const legacyResult = await mod.main({ config: { brandName: "新品牌" } })
    expect(legacyResult.ok).toBe(true)
    expect(legacyResult.config).toMatchObject(current.value)

    const next = { ...current.value, serviceHoursText: "  工作日 9:00–17:00  ", wxKfExtInfo: "https://work.weixin.qq.com/kfid/updated-link", serviceHubs: [{ ...savedHub, type: "hub", latitude: "0", longitude: "0" }] }
    const result = await mod.main({ config: next, expectedRevision: legacyResult.revision })
    expect(result.ok).toBe(true)
    expect(result.config).toMatchObject({ ...next, serviceHoursText: "工作日 9:00–17:00", serviceHubs: [{ ...savedHub, type: "hub", latitude: 0, longitude: 0 }] })
    expect(mocks.configUpdate).toHaveBeenLastCalledWith({ data: expect.objectContaining({ value: { __replace: result.config } }) })
  })

  test("管理员可显式清空客服与服务配置，不回填示例值", async () => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [{
      _id: "cfg_existing", key: "operation_settings", value: {
        servicePhone: "18800000000", serviceHoursText: "每日营业", emergencyPhone: "18800000001",
        wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/test-link", serviceHubs: [{ id: "store", city: "杭州", name: "门店", address: "真实地址", feeText: "", type: "store", latitude: null, longitude: null }]
      }
    }] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    const cleared = { servicePhone: "", serviceHoursText: "", emergencyPhone: "", wxKfCorpId: "", wxKfExtInfo: "", serviceHubs: [], cityOptions: [] }
    const result = await mod.main({ config: cleared })
    expect(result.ok).toBe(true)
    expect(result.config).toMatchObject(cleared)
    expect(mocks.configUpdate).toHaveBeenCalledWith({ data: expect.objectContaining({ value: { __replace: expect.objectContaining(cleared) } }) })
    expect(mocks.records[0].value).toMatchObject(cleared)
  })

  test.each([
    { wxKfCorpId: "ww123456" },
    { wxKfExtInfo: "info" },
    { wxKfCorpId: "bad id", wxKfExtInfo: "info" },
    { wxKfCorpId: "ww123456", wxKfExtInfo: "Base64EncodedValue" },
    { emergencyPhone: "------" },
    { serviceHoursText: "时".repeat(121) },
    { serviceHubs: [{ id: "store", city: "杭州", name: "门店", address: "真实地址", feeText: "", type: "store", latitude: "30", longitude: "" }] },
    { serviceHubs: [{ id: "store", city: "杭州", name: "门店", address: "真实地址", feeText: "", type: "store", latitude: false, longitude: true }] }
  ])("拒绝不完整或非法的服务配置 %j", async (config) => {
    const mocks = createMockDb({ rolesData: [{ openid: "admin_openid", role: "admin" }], configData: [] })
    const mod = await loadOperationConfigUpdateWith({ openid: "admin_openid", mockDb: mocks.db })
    expect(await mod.main({ config })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(mocks.configSet).not.toHaveBeenCalled()
    expect(mocks.configUpdate).not.toHaveBeenCalled()
  })
})
