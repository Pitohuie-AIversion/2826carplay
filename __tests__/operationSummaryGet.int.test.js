jest.mock("wx-server-sdk")

function createMockDb({ roles, counts = {}, errors = {} }) {
  const rolesWhere = jest.fn((filter) => ({
    limit: jest.fn((limit) => ({
      get: jest.fn().mockResolvedValue({
        data: roles.filter((item) => item.openid === filter.openid).slice(0, limit)
      })
    }))
  }))

  function createCount(key) {
    return errors[key]
      ? jest.fn().mockRejectedValue(errors[key])
      : jest.fn().mockResolvedValue({ total: counts[key] || 0 })
  }

  const bookingPendingCount = createCount("bookingPending")
  const privacyPendingCount = createCount("privacyPending")
  const privacyProcessingCount = createCount("privacyProcessing")
  const storageCleanupPendingCount = createCount("storageCleanupPending")
  const bookingsWhere = jest.fn((filter) => {
    if (filter.status === "pending") {
      return { count: bookingPendingCount }
    }
    throw new Error(`Unexpected bookings filter: ${JSON.stringify(filter)}`)
  })
  const privacyWhere = jest.fn((filter) => {
    if (filter.status === "pending") {
      return { count: privacyPendingCount }
    }
    if (filter.status === "processing") {
      return { count: privacyProcessingCount }
    }
    throw new Error(`Unexpected privacy filter: ${JSON.stringify(filter)}`)
  })
  const collection = jest.fn((name) => {
    if (name === "roles") {
      return { where: rolesWhere }
    }
    if (name === "bookings") {
      return { where: bookingsWhere }
    }
    if (name === "privacy_requests") {
      return { where: privacyWhere }
    }
    if (name === "pending_file_deletions") {
      return { count: storageCleanupPendingCount }
    }
    throw new Error(`Unexpected collection: ${name}`)
  })

  return {
    db: { collection },
    collection,
    bookingPendingCount,
    privacyPendingCount,
    privacyProcessingCount,
    storageCleanupPendingCount
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
    mod = require("../cloudfunctions/operationSummaryGet/index")
  })
  return mod
}

describe("cloudfunctions/operationSummaryGet integration", () => {
  test("管理员可查看全部运营待办数量", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      counts: {
        bookingPending: 8,
        privacyPending: 3,
        privacyProcessing: 2,
        storageCleanupPending: 1
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main()

    expect(res).toEqual({
      ok: true,
      counts: {
        bookingPending: 8,
        privacyPending: 3,
        privacyProcessing: 2,
        storageCleanupPending: 1
      },
      unavailable: [],
      partial: false
    })
  })

  test("预约管理员只返回预约待办，不读取隐私申请", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "ops_openid", permissions: ["booking_manage"] }],
      counts: {
        bookingPending: 5,
        privacyPending: 9
      }
    })
    const mod = await loadModule("ops_openid", mocks.db)

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.counts.bookingPending).toBe(5)
    expect(res.counts.privacyPending).toBe(0)
    expect(mocks.privacyPendingCount).not.toHaveBeenCalled()
    expect(mocks.storageCleanupPendingCount).not.toHaveBeenCalled()
  })

  test("普通用户不可读取运营汇总", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "user_openid", role: "user" }]
    })
    const mod = await loadModule("user_openid", mocks.db)

    const res = await mod.main()

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.bookingPendingCount).not.toHaveBeenCalled()
  })

  test("单个集合不可用时保留其他待办数量", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      roles: [{ openid: "admin_openid", role: "admin" }],
      counts: {
        bookingPending: 4,
        storageCleanupPending: 2
      },
      errors: {
        privacyPending: new Error("collection not found"),
        privacyProcessing: new Error("collection not found")
      }
    })
    const mod = await loadModule("admin_openid", mocks.db)

    const res = await mod.main()

    expect(res.ok).toBe(true)
    expect(res.partial).toBe(true)
    expect(res.counts.bookingPending).toBe(4)
    expect(res.counts.storageCleanupPending).toBe(2)
    expect(res.unavailable).toEqual(["privacyPending", "privacyProcessing"])
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})
