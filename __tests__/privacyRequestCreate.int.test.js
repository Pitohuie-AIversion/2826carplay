jest.mock("wx-server-sdk")

function createMockDb({ existing = [], addId = "privacy_1" } = {}) {
  const existingGet = jest.fn().mockResolvedValue({ data: existing })
  const existingLimit = jest.fn(() => ({ get: existingGet }))
  const existingField = jest.fn(() => ({ limit: existingLimit }))
  const privacyWhere = jest.fn(() => ({ field: existingField, limit: existingLimit }))
  const privacyAdd = jest.fn().mockResolvedValue({ _id: addId })
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "privacy_requests") {
        return {
          where: privacyWhere,
          add: privacyAdd
        }
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
    privacyWhere,
    existingField,
    privacyAdd,
    auditAdd,
    serverDateValue
  }
}

async function loadModule(openid, mockDb) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/privacyRequestCreate/index")
  })
  return mod
}

describe("cloudfunctions/privacyRequestCreate integration", () => {
  test("用户可提交隐私申请且审计日志不记录申请正文", async () => {
    const mocks = createMockDb()
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      type: "deletion",
      description: "请删除不再需要保留的个人资料"
    })

    expect(res).toEqual({
      ok: true,
      id: "privacy_1",
      status: "pending",
      message: "隐私申请已提交"
    })
    expect(mocks.privacyWhere).toHaveBeenCalledWith({ openid: "user_openid" })
    expect(mocks.existingField).toHaveBeenCalledWith({
      _id: true,
      type: true,
      status: true,
      createdAt: true
    })
    expect(mocks.privacyAdd).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        type: "deletion",
        description: "请删除不再需要保留的个人资料",
        status: "pending",
        resolutionNote: "",
        createdAt: mocks.serverDateValue,
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        action: "privacyRequestCreate",
        requestId: "privacy_1",
        requestType: "deletion",
        createdAt: mocks.serverDateValue
      }
    })
    expect(JSON.stringify(mocks.auditAdd.mock.calls)).not.toContain("请删除不再需要保留的个人资料")
  })

  test("同类型处理中申请不可重复提交", async () => {
    const mocks = createMockDb({
      existing: [
        {
          _id: "privacy_existing",
          type: "access",
          status: "processing",
          createdAt: "2026-01-01T00:00:00.000Z"
        }
      ]
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      type: "access",
      description: "查询当前保存的信息"
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe("ACTIVE_REQUEST_EXISTS")
    expect(res.details).toEqual({ requestId: "privacy_existing" })
    expect(mocks.privacyAdd).not.toHaveBeenCalled()
  })

  test("拒绝无效类型和过短说明", async () => {
    const mocks = createMockDb()
    const mod = await loadModule("user_openid", mocks.db)

    const invalidType = await mod.main({ type: "export", description: "导出信息" })
    const invalidDescription = await mod.main({ type: "access", description: "查" })

    expect(invalidType.code).toBe("VALIDATION_ERROR")
    expect(invalidDescription.code).toBe("VALIDATION_ERROR")
    expect(mocks.privacyAdd).not.toHaveBeenCalled()
  })
})
