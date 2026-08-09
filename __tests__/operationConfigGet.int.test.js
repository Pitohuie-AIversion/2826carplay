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
        estimateDisclaimer: expect.stringContaining("不会自动锁定车辆")
      }),
      bookingPrivacyTip: "仅用于本次预约沟通。"
    })
    expect(mocks.configField).toHaveBeenCalledWith({ value: true })
  })

  test("配置缺失时返回默认值", async () => {
    const mocks = createMockDb({
      configData: []
    })

    const mod = await loadOperationConfigGetWith({ mockDb: mocks.db })
    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.config.brandName).toBe("极境车库")
    expect(res.config.servicePhone).toBe("15715710090")
    expect(res.config.garagePageSubtitle).toBe("甄选座驾，为每一次出发预留专属席位")
    expect(res.config.cityOptions).toEqual(["杭州", "上海"])
    expect(res.config.rentalTerms.protectionText).toContain("不默认包含额外保障")
  })

  test("租赁规则按公开长度归一化并为缺失项补默认文案", async () => {
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
    expect(res.config.rentalTerms.energyText).toContain("油量或电量")
  })

  test("读取遗留后台说明时自动升级为面向用户的品牌文案", async () => {
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

    expect(res.config.garagePageSubtitle).toBe("甄选座驾，为每一次出发预留专属席位")
  })
})
