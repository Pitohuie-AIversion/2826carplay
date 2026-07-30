jest.mock("wx-server-sdk")

function createMockDb({ rolesData, currentData, updateResult, configData = [] }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = jest.fn().mockResolvedValue(updateResult)

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const bookingsDoc = jest.fn(() => ({
    get: currentGet
  }))
  const bookingsWhere = jest.fn(() => ({ update }))
  const configGet = jest.fn().mockResolvedValue({ data: configData })
  const configLimit = jest.fn(() => ({ get: configGet }))
  const configWhere = jest.fn(() => ({ limit: configLimit }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const errorLogAdd = jest.fn().mockResolvedValue({ _id: "error_1" })

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "bookings") {
        return {
          doc: bookingsDoc,
          where: bookingsWhere
        }
      }
      if (name === "app_configs") {
        return { where: configWhere }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      if (name === "error_logs") {
        return { add: errorLogAdd }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesWhere,
    rolesLimit,
    bookingsDoc,
    bookingsWhere,
    currentGet,
    update,
    configWhere,
    auditAdd,
    errorLogAdd,
    serverDateValue
  }
}

async function loadBookingUpdateStatusWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/bookingUpdateStatus/index")
  })

  return mod
}

describe("cloudfunctions/bookingUpdateStatus integration", () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  test("admin 更新预约状态成功", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "booking_1",
        status: "pending"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await mod.main({ id: "booking_1", status: "contacted" })

    expect(res).toEqual({
      ok: true,
      id: "booking_1",
      status: "contacted",
      updated: true,
      notificationStatus: "skipped",
      notificationReason: "missing_target",
      message: "预约状态已更新"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.bookingsDoc).toHaveBeenCalledWith("booking_1")
    expect(mocks.bookingsWhere).toHaveBeenCalledWith({
      _id: "booking_1",
      status: "pending"
    })
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        status: "contacted",
        updatedAt: mocks.serverDateValue
      }
    })
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      currentData: { _id: "booking_1" },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await mod.main({ id: "booking_1", status: "contacted" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.bookingsDoc).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("已完成预约不能重新打开", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "booking_1",
        status: "completed"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "booking_1", status: "contacted" })

    expect(res).toEqual({
      ok: false,
      code: "STATUS_TRANSITION_NOT_ALLOWED",
      message: "当前预约状态不允许执行此操作",
      details: {
        currentStatus: "completed",
        allowedStatuses: []
      }
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("并发修改导致条件更新失败时提示刷新", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "booking_1",
        status: "pending"
      },
      updateResult: { stats: { updated: 0 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "booking_1", status: "contacted" })

    expect(res).toEqual({
      ok: false,
      code: "STATUS_CONFLICT",
      message: "预约状态已发生变化，请刷新后重试"
    })
  })

  test("重复设置相同状态时幂等返回", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "booking_1",
        status: "contacted"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await mod.main({ id: "booking_1", status: "contacted" })

    expect(res).toEqual({
      ok: true,
      id: "booking_1",
      status: "contacted",
      updated: false,
      message: "预约状态未变化"
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("配置模板且用户已授权时发送状态订阅通知", async () => {
    jest.useFakeTimers()
    jest.setSystemTime(new Date("2026-07-30T00:05:00.000Z"))
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "booking_notify",
        openid: "user_openid",
        vehicleName: "极境越野",
        status: "pending"
      },
      configData: [
        {
          key: "operation_settings",
          value: {
            bookingStatusTemplateId: "template_1234567890"
          }
        }
      ],
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    const res = await mod.main({ id: "booking_notify", status: "contacted" })

    expect(res.ok).toBe(true)
    expect(res.notificationStatus).toBe("sent")
    expect(res.notificationReason).toBe("")
    expect(cloud.openapi.subscribeMessage.send).toHaveBeenCalledWith(
      expect.objectContaining({
        touser: "user_openid",
        templateId: "template_1234567890",
        page: "pages/booking-detail/booking-detail?id=booking_notify",
        miniprogramState: "formal",
        lang: "zh_CN",
        data: expect.objectContaining({
          thing1: { value: "极境越野" },
          phrase2: { value: "已联系" },
          thing3: { value: "状态已更新，请进入小程序查看" },
          time4: { value: "08:05" }
        })
      })
    )
  })

  test("未配置模板时跳过提醒但状态照常更新", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "booking_without_template",
        openid: "user_openid",
        status: "pending"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    const res = await mod.main({ id: "booking_without_template", status: "contacted" })

    expect(res).toEqual(
      expect.objectContaining({
        ok: true,
        updated: true,
        notificationStatus: "skipped",
        notificationReason: "not_configured"
      })
    )
    expect(cloud.openapi.subscribeMessage.send).not.toHaveBeenCalled()
    expect(mocks.errorLogAdd).not.toHaveBeenCalled()
  })

  test("用户未订阅时不记错误日志且不影响状态更新", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "booking_notify_fail",
        openid: "user_openid",
        vehicleName: "极境越野",
        status: "pending"
      },
      configData: [
        {
          key: "operation_settings",
          value: {
            bookingStatusTemplateId: "template_1234567890"
          }
        }
      ],
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    cloud.openapi.subscribeMessage.send.mockRejectedValueOnce({
      errCode: 43101,
      errMsg: "user refuse to accept the msg"
    })
    const res = await mod.main({ id: "booking_notify_fail", status: "contacted" })

    expect(res.ok).toBe(true)
    expect(res.updated).toBe(true)
    expect(res.notificationStatus).toBe("not_subscribed")
    expect(res.notificationReason).toBe("user_not_subscribed")
    expect(mocks.errorLogAdd).not.toHaveBeenCalled()
  })

  test("真实发送故障会写入脱敏错误日志且不回滚状态", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {})
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "booking_notify_error",
        openid: "private_user_openid",
        phone: "13800138000",
        vehicleName: "极境越野",
        status: "pending"
      },
      configData: [
        {
          key: "operation_settings",
          value: {
            bookingStatusTemplateId: "template_private"
          }
        }
      ],
      updateResult: { stats: { updated: 1 } }
    })

    const mod = await loadBookingUpdateStatusWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    cloud.openapi.subscribeMessage.send.mockRejectedValueOnce({
      errCode: 50002,
      errMsg: "subscribe api temporarily unavailable"
    })
    const res = await mod.main({ id: "booking_notify_error", status: "contacted" })

    expect(res).toEqual(
      expect.objectContaining({
        ok: true,
        updated: true,
        notificationStatus: "failed",
        notificationReason: "send_failed"
      })
    )
    expect(mocks.errorLogAdd).toHaveBeenCalledWith({
      data: {
        function: "bookingUpdateStatus",
        stage: "subscribeMessage",
        bookingId: "booking_notify_error",
        targetStatus: "contacted",
        errorCode: "50002",
        errorMessage: "subscribe api temporarily unavailable",
        createdAt: mocks.serverDateValue
      }
    })
    const persisted = mocks.errorLogAdd.mock.calls[0][0].data
    expect(JSON.stringify(persisted)).not.toContain("private_user_openid")
    expect(JSON.stringify(persisted)).not.toContain("13800138000")
    expect(JSON.stringify(persisted)).not.toContain("template_private")
    warnSpy.mockRestore()
  })
})
