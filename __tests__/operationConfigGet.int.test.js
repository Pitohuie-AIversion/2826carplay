jest.mock("wx-server-sdk")

function createMockDb({ configData }) {
  const configGet = jest.fn().mockResolvedValue({ data: configData })
  const configLimit = jest.fn(() => ({ get: configGet }))
  const configWhere = jest.fn(() => ({ limit: configLimit }))

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
      bookingPrivacyTip: "仅用于本次预约沟通。"
    })
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
    expect(res.config.cityOptions).toEqual(["杭州", "上海"])
  })
})
