jest.mock("wx-server-sdk")

function createMockDb({ rolesData, bookingData, bookingsError = null, orderedError = null }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const errorAdd = jest.fn().mockResolvedValue({ _id: "error_1" })
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const readBatch = (offset, limitValue, error) =>
    error
      ? jest.fn().mockRejectedValue(error)
      : jest.fn().mockResolvedValue({ data: bookingData.slice(offset, offset + limitValue) })
  const bookingsSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: readBatch(offset, limitValue, bookingsError)
    }))
  }))
  const bookingsOrderedSkip = jest.fn((offset) => ({
    limit: jest.fn((limitValue) => ({
      get: readBatch(offset, limitValue, orderedError || bookingsError)
    }))
  }))
  const bookingsOrderBy = jest.fn(() => ({ skip: bookingsOrderedSkip }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return {
          skip: bookingsSkip,
          orderBy: bookingsOrderBy
        }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      if (name === "error_logs") {
        return { add: errorAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesWhere,
    bookingsSkip,
    bookingsOrderedSkip,
    bookingsOrderBy,
    auditAdd,
    errorAdd
  }
}

async function loadBookingExportCsvWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingExportCsv/index")
  })

  return mod
}

describe("cloudfunctions/bookingExportCsv integration", () => {
  test("admin 可导出 CSV", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: [
        {
          _id: "b1",
          vehicleName: "MX-5",
          userName: "张三",
          phone: "13800000000",
          city: "杭州",
          status: "pending",
          note: "希望下午取车",
          adminRemark: "已联系",
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:00.000Z"
        }
      ]
    })

    const mod = await loadBookingExportCsvWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "all", keyword: "13800000000" })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(typeof res.csvText).toBe("string")
    expect(res.csvText).toContain("MX-5")
    expect(res.csvText).toContain("张三")
    expect(res.csvText).toContain("已联系")
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: expect.objectContaining({
        openid: "admin_openid",
        action: "bookingExportCsv",
        status: "all",
        keywordProvided: true,
        limit: 500,
        total: 1,
        matchedTotal: 1,
        sourceTruncated: false,
        exportTruncated: false,
        fileName: res.fileName
      })
    })
    const auditData = mocks.auditAdd.mock.calls[0][0].data
    expect(auditData).not.toHaveProperty("keyword")
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      bookingData: []
    })

    const mod = await loadBookingExportCsvWith({ openid: "user_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "all", keyword: "" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
  })

  test("导出异常日志不保存搜索关键词原文", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: [],
      bookingsError: new Error("database unavailable")
    })
    const mod = await loadBookingExportCsvWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({
      status: "pending",
      keyword: "13800000000",
      limit: 100
    })

    expect(res.code).toBe("INTERNAL_ERROR")
    expect(mocks.errorAdd).toHaveBeenCalled()
    const errorData = mocks.errorAdd.mock.calls[0][0].data
    expect(errorData.status).toBe("pending")
    expect(errorData.limit).toBe(100)
    expect(errorData.keywordProvided).toBe(true)
    expect(errorData).not.toHaveProperty("keyword")
    expect(errorData).not.toHaveProperty("input")
    expect(errorSpy).toHaveBeenCalled()
    errorSpy.mockRestore()
    warnSpy.mockRestore()
  })

  test("用户输入的公式前缀按文本导出", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: [
        {
          _id: "b_formula",
          vehicleName: '=HYPERLINK("https://evil.example")',
          userName: "+SUM(1,1)",
          phone: "13800000000",
          city: "  @SUM(1,1)",
          status: "pending",
          note: "-1+1",
          adminRemark: "＝1+1",
          createdAt: "2026-07-14T00:00:00.000Z",
          updatedAt: "2026-07-14T00:00:00.000Z"
        }
      ]
    })

    const mod = await loadBookingExportCsvWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "all" })

    expect(res.ok).toBe(true)
    expect(res.csvText).toContain(`"'=HYPERLINK(""https://evil.example"")"`)
    expect(res.csvText).toContain(`"'+SUM(1,1)"`)
    expect(res.csvText).toContain(`"'  @SUM(1,1)"`)
    expect(res.csvText).toContain("'-1+1")
    expect(res.csvText).toContain("'＝1+1")
  })

  test("先扫描再筛选，可导出前 500 条之外的匹配预约", async () => {
    const bookingData = Array.from({ length: 550 }, (_, index) => ({
      _id: `b_${index}`,
      vehicleName: `车辆${index}`,
      userName: `用户${index}`,
      phone: "13800000000",
      city: "杭州",
      status: index < 500 ? "pending" : "cancelled",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + index * 1000).toISOString(),
      updatedAt: "2026-01-01T00:00:00.000Z"
    }))
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData
    })

    const mod = await loadBookingExportCsvWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "cancelled", limit: 500 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(50)
    expect(res.matchedTotal).toBe(50)
    expect(res.truncated).toBe(false)
    expect(res.csvText).toContain("b_549")
    expect(res.csvText).toContain("b_500")
    expect(mocks.bookingsOrderedSkip).toHaveBeenCalledWith(500)
  })

  test("匹配结果超过导出上限时返回截断提示", async () => {
    const bookingData = Array.from({ length: 600 }, (_, index) => ({
      _id: `b_${index}`,
      vehicleName: `车辆${index}`,
      userName: `用户${index}`,
      phone: "13800000000",
      city: "杭州",
      status: "pending",
      createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) + index * 1000).toISOString(),
      updatedAt: "2026-01-01T00:00:00.000Z"
    }))
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData
    })

    const mod = await loadBookingExportCsvWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "pending", limit: 500 })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(500)
    expect(res.matchedTotal).toBe(600)
    expect(res.exportTruncated).toBe(true)
    expect(res.sourceTruncated).toBe(false)
    expect(res.truncated).toBe(true)
  })

  test("缺少 createdAt 索引时自动降级并在云函数内排序", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const bookingData = [
      {
        _id: "b_old",
        vehicleName: "旧预约",
        status: "pending",
        createdAt: "2026-01-01T00:00:00.000Z"
      },
      {
        _id: "b_new",
        vehicleName: "新预约",
        status: "pending",
        createdAt: "2026-02-01T00:00:00.000Z"
      }
    ]
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData,
      orderedError: new Error("index not found")
    })

    const mod = await loadBookingExportCsvWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ status: "all" })

    expect(res.ok).toBe(true)
    expect(res.csvText.indexOf("b_new")).toBeLessThan(res.csvText.indexOf("b_old"))
    expect(mocks.bookingsSkip).toHaveBeenCalledWith(0)
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  test("导出沿用候补和协调进度筛选并包含中文列", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      bookingData: [
        {
          _id: "b_standby",
          vehicleName: "MX-5",
          userName: "张三",
          status: "contacted",
          schedulePriority: "standby",
          coordinationStatus: "coordinating",
          createdAt: "2026-07-15T00:00:00.000Z"
        },
        {
          _id: "b_normal",
          vehicleName: "S2000",
          userName: "李四",
          status: "pending",
          createdAt: "2026-07-14T00:00:00.000Z"
        }
      ]
    })
    const mod = await loadBookingExportCsvWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })

    const res = await mod.main({
      status: "all",
      schedulePriority: "standby",
      coordinationStatus: "coordinating"
    })

    expect(res.ok).toBe(true)
    expect(res.total).toBe(1)
    expect(res.filters.schedulePriority).toBe("standby")
    expect(res.filters.coordinationStatus).toBe("coordinating")
    expect(res.csvText).toContain("预约优先级")
    expect(res.csvText).toContain("协调状态")
    expect(res.csvText).toContain("候补")
    expect(res.csvText).toContain("协调中")
    expect(res.csvText).not.toContain("S2000")
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: expect.objectContaining({
        schedulePriority: "standby",
        coordinationStatus: "coordinating",
        total: 1
      })
    })
  })
})
