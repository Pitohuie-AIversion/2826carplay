jest.mock("wx-server-sdk")

function createMockDb({ configData }) {
  const configGet = jest.fn().mockResolvedValue({ data: configData })
  const configLimit = jest.fn(() => ({ get: configGet }))
  const configField = jest.fn(() => ({ limit: configLimit }))
  const configWhere = jest.fn(() => ({ field: configField, limit: configLimit }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "app_configs") {
        return { where: configWhere }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    configWhere,
    configGet,
    configField,
    configLimit
  }
}

async function loadOperationConfigGetWith({ mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/operationConfigGet/index")
  })

  return mod
}

describe("cloudfunctions/operationConfigGet integration", () => {
  test("历史重复城市先去重再应用条数限制，不丢失后面的有效城市", async () => {
    const mocks = createMockDb({ configData: [{ value: { cityOptions: [...Array(20).fill(" 杭州 "), "上海"] } }] })
    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    const result = await mod.main({ requireStoredConfig: true })
    expect(result).toMatchObject({ ok: true, config: { cityOptions: ["杭州", "上海"] } })
  })

  test.each([[], [{ value: {} }], [{ value: { faqContent: "", rulesContent: "", rentalTerms: { includedText: "" } } }]])("未保存或已清空的业务文案不生成默认承诺 %j", async (...configData) => {
    const mocks = createMockDb({ configData })
    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    const result = await mod.main({ requireStoredConfig: true })
    expect(result).toMatchObject({ ok: true, config: { faqContent: "", rulesContent: "" } })
    expect(Object.values(result.config.rentalTerms)).toEqual(Array(9).fill(""))
  })

  test("损坏网点不能静默变成可保存的空配置，管理员读取明确失败", async () => {
    const hub = { id: "valid", city: "杭州", name: "有效店", address: "真实地址", feeText: "", type: "store" }
    const mocks = createMockDb({ configData: [{ value: { serviceHubs: [hub, { ...hub, id: "invalid", address: "" }] } }] })
    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    expect(await mod.main({ requireStoredConfig: true })).toMatchObject({ ok: false, code: "STORED_CONFIG_INVALID", details: { errors: [{ field: "serviceHubs" }] } })
    expect((await mod.main()).config.serviceHubs).toEqual([])
  })

  test("返回版本基线并拒绝历史重复记录，避免读写选中不同配置", async () => {
    const mocks = createMockDb({ configData: [{ value: { brandName: "唯一品牌" }, revision: 9 }] })
    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    expect(await mod.main({ requireStoredConfig: true })).toMatchObject({ ok: true, revision: 9 })
    expect(mocks.configLimit).toHaveBeenCalledWith(2)
    mocks.configGet.mockResolvedValueOnce({ data: [{ value: { brandName: "一" } }, { value: { brandName: "二" } }] })
    expect(await mod.main({ requireStoredConfig: true })).toMatchObject({ ok: false, code: "CONFIG_CONFLICT" })
  })

  test("配置存在时返回配置值", async () => {
    const mocks = createMockDb({
      configData: [
        {
          key: "operation_settings",
          value: {
            brandName: "超跑车库",
            servicePhone: "18800000000",
            mineUserDesc: "欢迎来到车库",
            garagePageTitle: "超跑车库",
            garagePageSubtitle: "欢迎预约热门车型",
            bookingPrivacyTip: "仅用于本次预约沟通。"
          }
        }
      ]
    })

    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.config).toEqual({
      brandName: "超跑车库",
      servicePhone: "18800000000",
      wxKfCorpId: "",
      wxKfExtInfo: "",
      serviceHoursText: "",
      emergencyPhone: "",
      serviceHubs: [],
      mineUserDesc: "欢迎来到车库",
      garagePageTitle: "超跑车库",
      garagePageSubtitle: "欢迎预约热门车型",
      cityOptions: ["杭州", "上海"],
      faqContent: expect.any(String),
      rulesContent: expect.any(String),
      bookingStatusTemplateId: "",
      rentalTerms: expect.objectContaining({
        includedText: expect.any(String),
        depositText: expect.any(String),
        estimateDisclaimer: ""
      }),
      bookingPrivacyTip: "仅用于本次预约沟通。"
    })
    expect(mocks.configField).toHaveBeenCalledWith({ value: true, revision: true })
  })

  test("配置缺失时返回默认值", async () => {
    const mocks = createMockDb({
      configData: []
    })

    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.config.brandName).toBe("极境车库")
    expect(res.config.servicePhone).toBe("")
    expect(res.config.garagePageSubtitle).toBe("甄选座驾，为每一次出发预留专属席位")
    expect(res.config.cityOptions).toEqual(["杭州", "上海"])
    expect(res.config.rentalTerms.protectionText).toBe("")
  })

  test("显式清空城市列表与缺失字段区别处理，不补回示例城市", async () => {
    const mocks = createMockDb({ configData: [{ value: { cityOptions: [] } }] })
    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    expect((await mod.main({ requireStoredConfig: true })).config.cityOptions).toEqual([])
  })

  test("租赁规则按公开长度归一化，缺失项不补业务承诺", async () => {
    const mocks = createMockDb({
      configData: [
        {
          key: "operation_settings",
          value: {
            rentalTerms: {
              includedText: "仅含车辆使用费",
              depositText: "押金规则".repeat(100)
            }
          }
        }
      ]
    })

    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    const res = await mod.main()

    expect(res.config.rentalTerms.includedText).toBe("仅含车辆使用费")
    expect(res.config.rentalTerms.depositText).toHaveLength(200)
    expect(res.config.rentalTerms.energyText).toBe("")
  })

  test("读取管理员保存的旧文案仍保留原文", async () => {
    const mocks = createMockDb({
      configData: [
        {
          key: "operation_settings",
          value: {
            garagePageSubtitle: "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页"
          }
        }
      ]
    })

    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    const res = await mod.main()

    expect(res.config.garagePageSubtitle).toBe("后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页")
  })

  test("公开读取服务配置并保持显式清空的客服电话", async () => {
    const serviceHubs = [{ id: "west_store", city: "杭州", name: "西湖店", address: "已核实地址", feeText: "到店免费取还", type: "store", latitude: 30.2, longitude: 120.1 }]
    const mocks = createMockDb({ configData: [{ value: {
      servicePhone: "", serviceHoursText: "  周一至周六 10:00–18:00  ", emergencyPhone: "18800000001",
      wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/test-link", serviceHubs
    } }] })
    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    const res = await mod.main({ requireStoredConfig: true })
    expect(res.ok).toBe(true)
    expect(res.config).toMatchObject({ servicePhone: "", serviceHoursText: "周一至周六 10:00–18:00", emergencyPhone: "18800000001", wxKfCorpId: "ww123456", wxKfExtInfo: "https://work.weixin.qq.com/kfid/test-link", serviceHubs })
  })

  test("管理员读取失败不返回可覆盖线上的默认配置", async () => {
    const mocks = createMockDb({ configData: [] })
    mocks.configGet.mockRejectedValue(new Error("database unavailable"))
    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {})
    try {
      expect(await mod.main({ requireStoredConfig: true })).toMatchObject({ ok: false, code: "CONFIG_UNAVAILABLE" })
      const publicResult = await mod.main()
      expect(publicResult.ok).toBe(true)
      expect(publicResult.config).toMatchObject({ servicePhone: "", serviceHubs: [], emergencyPhone: "" })
    } finally {
      errorLog.mockRestore()
    }
  })
})
