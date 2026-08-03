jest.mock("wx-server-sdk")

function createMockDb({ roles, current, updateResult = { stats: { updated: 1 } } }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limit) => ({
      get: jest.fn().mockResolvedValue({
        data: roles.filter((item) => item.openid === filter.openid).slice(0, limit)
      })
    }))
  }))
  const privacyGet = jest.fn().mockResolvedValue({ data: current })
  const privacyField = jest.fn(() => ({ get: privacyGet }))
  const privacyDoc = jest.fn(() => ({ field: privacyField, get: privacyGet }))
  const privacyUpdate = jest.fn().mockResolvedValue(updateResult)
  const privacyWhere = jest.fn(() => ({ update: privacyUpdate }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  return {
    db: {
      collection: jest.fn((name) => {
        if (name === "roles") {
          return { where: rolesWhere }
        }
        if (name === "privacy_requests") {
          return {
            doc: privacyDoc,
            where: privacyWhere
          }
        }
        if (name === "audit_logs") {
          return { add: auditAdd }
        }
        throw new Error(`Unexpected collection: ${name}`)
      }),
      serverDate
    },
    privacyWhere,
    privacyUpdate,
    privacyField,
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
    mod = require("../cloudfunctions/privacyRequestUpdateStatus/index")
  })
  return mod
}

describe("cloudfunctions/privacyRequestUpdateStatus integration", () => {
  test("管理员可完成申请并写入不含处理正文的审计记录", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      current: {
        _id: "p1",
        type: "correction",
        status: "processing"
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      id: "p1",
      status: "completed",
      resolutionNote: "已完成信息更正"
    })

    expect(res.ok).toBe(true)
    expect(mocks.privacyField).toHaveBeenCalledWith({
      type: true,
      status: true,
      dataExportedAt: true
    })
    expect(mocks.privacyWhere).toHaveBeenCalledWith({
      _id: "p1",
      status: "processing"
    })
    expect(mocks.privacyUpdate).toHaveBeenCalledWith({
      data: {
        status: "completed",
        resolutionNote: "已完成信息更正",
        updatedAt: mocks.serverDateValue,
        handledBy: "admin_openid"
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "admin_openid",
        action: "privacyRequestUpdateStatus",
        requestId: "p1",
        requestType: "correction",
        fromStatus: "processing",
        toStatus: "completed",
        createdAt: mocks.serverDateValue
      }
    })
    expect(JSON.stringify(mocks.auditAdd.mock.calls)).not.toContain("已完成信息更正")
  })

  test("终态申请不可重新打开", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      current: {
        _id: "p1",
        type: "deletion",
        status: "completed"
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      id: "p1",
      status: "processing"
    })

    expect(res.code).toBe("STATUS_TRANSITION_NOT_ALLOWED")
    expect(mocks.privacyUpdate).not.toHaveBeenCalled()
  })

  test("查询申请未生成个人数据时不可标记为完成", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      current: {
        _id: "p_access",
        type: "access",
        status: "processing"
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      id: "p_access",
      status: "completed",
      resolutionNote: "已经反馈用户"
    })

    expect(res).toEqual({
      ok: false,
      code: "DATA_EXPORT_REQUIRED",
      message: "请先核验并导出完整个人数据，再完成查询申请"
    })
    expect(mocks.privacyUpdate).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("并发状态变化不会被覆盖", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      current: {
        _id: "p1",
        type: "access",
        status: "pending",
        dataExportedAt: "2026-07-30T08:00:00.000Z"
      },
      updateResult: { stats: { updated: 0 } }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main({
      id: "p1",
      status: "completed",
      resolutionNote: "已经反馈用户"
    })

    expect(res.code).toBe("STATUS_CONFLICT")
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("非管理员不可处理申请", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "user_openid", role: "user" }],
      current: {
        _id: "p1",
        status: "pending"
      }
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      id: "p1",
      status: "processing"
    })

    expect(res.code).toBe("FORBIDDEN")
    expect(mocks.privacyUpdate).not.toHaveBeenCalled()
  })
})
