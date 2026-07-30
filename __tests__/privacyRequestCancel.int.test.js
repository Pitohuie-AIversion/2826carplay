jest.mock("wx-server-sdk")

function createMockDb({ current, updateResult = { stats: { updated: 1 } } }) {
  const requestGet = jest.fn().mockResolvedValue({ data: current })
  const requestDoc = jest.fn(() => ({ get: requestGet }))
  const requestUpdate = jest.fn().mockResolvedValue(updateResult)
  const requestWhere = jest.fn(() => ({ update: requestUpdate }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "privacy_requests") {
        return {
          doc: requestDoc,
          where: requestWhere
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
    requestWhere,
    requestUpdate,
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
    mod = require("../cloudfunctions/privacyRequestCancel/index")
  })
  return mod
}

describe("cloudfunctions/privacyRequestCancel integration", () => {
  test("用户可撤回自己的待处理申请", async () => {
    const mocks = createMockDb({
      current: {
        _id: "privacy_1",
        openid: "user_openid",
        type: "deletion",
        status: "pending"
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({ id: "privacy_1" })

    expect(res).toEqual({
      ok: true,
      id: "privacy_1",
      status: "cancelled",
      message: "隐私申请已撤回"
    })
    expect(mocks.requestWhere).toHaveBeenCalledWith({
      _id: "privacy_1",
      openid: "user_openid",
      status: "pending"
    })
    expect(mocks.requestUpdate).toHaveBeenCalledWith({
      data: {
        status: "cancelled",
        resolutionNote: "用户已撤回申请",
        updatedAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        action: "privacyRequestCancel",
        requestId: "privacy_1",
        requestType: "deletion",
        fromStatus: "pending",
        toStatus: "cancelled",
        createdAt: mocks.serverDateValue
      }
    })
  })

  test("不能撤回其他用户的申请", async () => {
    const mocks = createMockDb({
      current: {
        _id: "privacy_1",
        openid: "other_openid",
        status: "pending"
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({ id: "privacy_1" })

    expect(res.code).toBe("FORBIDDEN")
    expect(mocks.requestUpdate).not.toHaveBeenCalled()
  })

  test("处理中申请不能撤回", async () => {
    const mocks = createMockDb({
      current: {
        _id: "privacy_1",
        openid: "user_openid",
        status: "processing"
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({ id: "privacy_1" })

    expect(res.code).toBe("STATUS_NOT_ALLOWED")
    expect(mocks.requestUpdate).not.toHaveBeenCalled()
  })

  test("管理员并发开始处理时撤回不会覆盖新状态", async () => {
    const mocks = createMockDb({
      current: {
        _id: "privacy_1",
        openid: "user_openid",
        status: "pending"
      },
      updateResult: { stats: { updated: 0 } }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({ id: "privacy_1" })

    expect(res.code).toBe("STATUS_CONFLICT")
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })
})
