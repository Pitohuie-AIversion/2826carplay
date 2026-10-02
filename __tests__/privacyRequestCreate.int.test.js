jest.mock("wx-server-sdk")

function createMockDb({ existing = [] } = {}) {
  const records = Object.fromEntries(existing.map((item) => [item._id, { openid: "user_openid", ...item }]))
  const existingField = jest.fn()
  const privacyWhere = jest.fn((filter) => {
    const query = { field: (fields) => { existingField(fields); return query }, limit: (limit) => ({ get: async () => ({
      data: Object.entries(records).filter(([, record]) => Object.entries(filter).every(([key, value]) => {
        if (value && value.in) return value.in.includes(record[key])
        if (value && value.gte) return new Date(record[key]).getTime() >= value.gte
        return record[key] === value
      })).slice(0, limit).map(([id, record]) => ({ _id: id, ...record }))
    }) }) }
    return query
  })
  const privacySet = jest.fn((id, data) => { records[id] = { ...data } })
  const privacyDoc = (id) => ({
    get: async () => ({ data: records[id] ? { _id: id, ...records[id] } : null }),
    field: (fields) => ({
      get: async () => ({ data: records[id] ? {
        _id: id,
        ...Object.fromEntries(Object.entries(records[id]).filter(([key]) => fields[key]))
      } : null })
    }),
    set: async ({ data }) => privacySet(id, data)
  })
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const serverDateValue = new Date().toISOString()
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "privacy_requests") {
        return {
          where: privacyWhere,
          doc: privacyDoc
        }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate,
    command: { in: (values) => ({ in: values }), gte: (value) => ({ gte: value.getTime() }) }
  }
  let tail = Promise.resolve()
  db.runTransaction = jest.fn((callback) => {
    const run = tail.then(async () => {
      const snapshot = JSON.parse(JSON.stringify(records))
      try {
        return await callback({ collection: () => ({ doc: privacyDoc }) })
      } catch (error) {
        Object.keys(records).forEach((key) => delete records[key])
        Object.assign(records, snapshot)
        throw error
      }
    })
    tail = run.catch(() => {})
    return run
  })

  return {
    db,
    privacyWhere,
    existingField,
    privacySet,
    records,
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
  test("守卫写入失败会回滚申请，原请求号可安全重试", async () => {
    const mocks = createMockDb()
    const mod = await loadModule("user_openid", mocks.db)
    mocks.privacySet.mockImplementationOnce((id, data) => { mocks.records[id] = { ...data } })
      .mockImplementationOnce(() => { throw new Error("guard write failed") })
    const payload = { type: "access", description: "查询个人信息", requestId: "retry_rollback_1" }
    expect(await mod.main(payload)).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(Object.keys(mocks.records)).toHaveLength(0)
    expect(mocks.auditAdd).not.toHaveBeenCalled()
    expect(await mod.main(payload)).toMatchObject({ ok: true, status: "pending" })
    expect(Object.values(mocks.records).filter((item) => item.type === "access")).toHaveLength(1)
  })

  test("不同请求号并发提交同类型时只生成一笔活动申请", async () => {
    const mocks = createMockDb()
    const mod = await loadModule("user_openid", mocks.db)
    const results = await Promise.all(["request_one", "request_two"].map((requestId) => mod.main({ type: "access", description: "查询个人信息", requestId })))
    expect(results.filter((item) => item.ok)).toHaveLength(1)
    expect(results.find((item) => !item.ok).code).toBe("ACTIVE_REQUEST_EXISTS")
    expect(Object.values(mocks.records).filter((item) => item.type === "access")).toHaveLength(1)
    const guard = Object.values(mocks.records).find((item) => item.recordKind === "submission_guard")
    expect(guard).not.toHaveProperty("openid")
    expect(guard).not.toHaveProperty("type")
    expect(guard).not.toHaveProperty("status")
  })

  test("同请求号并发和结果不明重试均返回原申请，不重复写审计", async () => {
    const mocks = createMockDb()
    const mod = await loadModule("user_openid", mocks.db)
    const payload = { type: "access", description: "查询个人信息", requestId: "retry_request_1" }
    const [first, second] = await Promise.all([mod.main(payload), mod.main(payload)])
    expect(first.ok && second.ok).toBe(true)
    expect(first.id).toBe(second.id)
    expect(await mod.main(payload)).toMatchObject({ ok: true, id: first.id, duplicate: true })
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
    expect(await mod.main({ ...payload, description: "修改提交内容" })).toMatchObject({ ok: false, code: "IDEMPOTENCY_CONFLICT" })
  })

  test("100条历史记录后的活动申请仍会阻止重复提交", async () => {
    const existing = Array.from({ length: 101 }, (_, index) => ({ _id: `old_${index}`, type: "access", status: index === 100 ? "processing" : "completed", createdAt: "2020-01-01" }))
    const mocks = createMockDb({ existing })
    const mod = await loadModule("user_openid", mocks.db)
    expect(await mod.main({ type: "access", description: "再次查询信息" })).toMatchObject({ ok: false, code: "ACTIVE_REQUEST_EXISTS", details: { requestId: "old_100" } })
    expect(mocks.privacySet).not.toHaveBeenCalled()
  })

  test("无请求号旧客户端仍受跨类型频率约束，结束后新申请保留历史", async () => {
    const mocks = createMockDb()
    const mod = await loadModule("user_openid", mocks.db)
    const first = await mod.main({ type: "access", description: "查询个人信息" })
    expect(await mod.main({ type: "correction", description: "更正联系方式" })).toMatchObject({ ok: false, code: "RATE_LIMITED" })
    mocks.records[first.id].status = "completed"
    mocks.records[first.id].createdAt = "2020-01-01"
    Object.values(mocks.records).find((item) => item.recordKind === "submission_guard").lastCreatedAtMs = Date.now() - 61000
    const next = await mod.main({ type: "access", description: "再次查询信息" })
    expect(next.ok).toBe(true)
    expect(next.id).not.toBe(first.id)
    expect(mocks.records[first.id].status).toBe("completed")
  })

  test("用户可提交隐私申请且审计日志不记录申请正文", async () => {
    const mocks = createMockDb()
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main({
      type: "deletion",
      description: "请删除不再需要保留的个人资料"
    })

    expect(res).toEqual({
      ok: true,
      id: expect.stringMatching(/^privacy_[a-f0-9]{40}$/),
      status: "pending",
      message: "隐私申请已提交"
    })
    expect(mocks.privacyWhere).toHaveBeenCalledWith({ openid: "user_openid", type: "deletion", status: { in: ["pending", "processing"] } })
    expect(mocks.existingField).toHaveBeenCalledWith({
      _id: true,
      type: true,
      status: true,
      createdAt: true
    })
    expect(mocks.privacySet).toHaveBeenCalledWith(res.id, {
        openid: "user_openid",
        type: "deletion",
        description: "请删除不再需要保留的个人资料",
        submissionFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        status: "pending",
        resolutionNote: "",
        createdAt: mocks.serverDateValue,
        updatedAt: mocks.serverDateValue
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "user_openid",
        action: "privacyRequestCreate",
        requestId: res.id,
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
    expect(mocks.privacySet).not.toHaveBeenCalled()
  })

  test("拒绝无效类型和过短说明", async () => {
    const mocks = createMockDb()
    const mod = await loadModule("user_openid", mocks.db)

    const invalidType = await mod.main({ type: "export", description: "导出信息" })
    const invalidDescription = await mod.main({ type: "access", description: "查" })

    expect(invalidType.code).toBe("VALIDATION_ERROR")
    expect(invalidDescription.code).toBe("VALIDATION_ERROR")
    expect(mocks.privacySet).not.toHaveBeenCalled()
  })
})
