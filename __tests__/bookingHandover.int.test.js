jest.mock("wx-server-sdk")

function createMockDb({ roles = [], bookings = {}, handovers = {}, failQueueWrite = false, appConfigs = [{ key: "operation_settings", value: { bookingHandoverTemplateId: "tpl_handover_test_123" } }] } = {}) {
  const queue = []
  const audits = []
  const errorLogs = []
  const now = new Date("2026-08-10T02:00:00.000Z")
  const clone = (value) => {
    if (!value || typeof value !== "object" || value instanceof Date) return value
    if (Array.isArray(value)) return value.map(clone)
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clone(item)]))
  }

  function collection(name) {
    if (name === "roles") {
      return {
        where: ({ openid }) => ({
          field: () => ({
            limit: () => ({ get: jest.fn().mockResolvedValue({ data: roles.filter((item) => item.openid === openid) }) })
          })
        })
      }
    }
    if (name === "app_configs") {
      return {
        where: () => ({
          field: () => ({
            limit: () => ({ get: jest.fn().mockResolvedValue({ data: appConfigs }) })
          })
        })
      }
    }
    if (name === "bookings" || name === "booking_handovers") {
      const store = name === "bookings" ? bookings : handovers
      return {
        doc: (id) => ({
          field: () => ({
            get: jest.fn(async () => {
              if (!store[id]) throw new Error("document not found")
              return { data: { _id: id, ...store[id] } }
            })
          }),
          set: jest.fn(async ({ data }) => { store[id] = { ...data }; return { _id: id } }),
          update: jest.fn(async ({ data }) => { store[id] = { ...(store[id] || {}), ...data }; return { stats: { updated: 1 } } })
        }),
        where: ({ bookingId }) => ({
          field: () => ({ limit: () => ({ get: jest.fn().mockResolvedValue({ data: Object.entries(store).filter(([, item]) => item.bookingId === bookingId).map(([id, item]) => ({ _id: id, ...item })) }) }) })
        })
      }
    }
    if (name === "pending_file_deletions") {
      return {
        add: jest.fn(async ({ data }) => { queue.push(data); return { _id: `queue_${queue.length}` } }),
        doc: (id) => ({
          field: () => ({ get: async () => ({ data: queue.find((item) => item._id === id) || null }) }),
          set: jest.fn(async ({ data }) => {
            if (failQueueWrite) throw new Error("queue unavailable")
            const index = queue.findIndex((item) => item._id === id)
            if (index >= 0) queue[index] = { _id: id, ...data }
            else queue.push({ _id: id, ...data })
            return { _id: id }
          })
        })
      }
    }
    if (name === "audit_logs") {
      return { add: jest.fn(async ({ data }) => { audits.push(data); return { _id: `audit_${audits.length}` } }) }
    }
    if (name === "error_logs") {
      return { add: jest.fn(async ({ data }) => { errorLogs.push(data); return { _id: `error_${errorLogs.length}` } }) }
    }
    throw new Error(`Unexpected collection: ${name}`)
  }

  const db = {
    collection,
    serverDate: jest.fn(() => now),
    runTransaction: jest.fn(async (callback) => {
      const bookingSnapshot = clone(bookings)
      const handoverSnapshot = clone(handovers)
      const queueLength = queue.length
      try {
        return await callback({ collection: (name) => ({ doc: collection(name).doc }) })
      } catch (error) {
        Object.keys(bookings).forEach((key) => delete bookings[key])
        Object.keys(handovers).forEach((key) => delete handovers[key])
        Object.assign(bookings, bookingSnapshot)
        Object.assign(handovers, handoverSnapshot)
        queue.splice(queueLength)
        throw error
      }
    })
  }
  return { db, queue, audits, errorLogs, bookings, handovers, allowQueue: () => { failQueueWrite = false } }
}

async function loadFunction(openid, mocks) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb(mocks.db)
  let mod
  jest.isolateModules(() => { mod = require("../cloudfunctions/bookingHandover/index") })
  return mod
}

function validSubmit(overrides = {}) {
  const bookingId = overrides.bookingId || "booking_1"
  const stage = overrides.stage || "pickup"
  return {
    action: "submit",
    bookingId,
    stage,
    requestId: "request_12345678",
    mileageKm: 12000,
    energyType: "fuel",
    energyLevelPercent: 80,
    damageNote: "未发现已知损伤",
    additionalNote: "钥匙一把",
    photos: ["front", "rear", "left", "right"].map((angle) => ({
      angle,
      fileId: `cloud://env/handover-images/${bookingId}/${stage}/${angle}.jpg`
    })),
    ...overrides
  }
}

describe("cloudfunctions/bookingHandover integration", () => {
  test("清理队列失败会回滚归档，重试保留原照片清单且不会重复排队", async () => {
    const handoverId = "booking_1__pickup__v1"
    const photos = validSubmit().photos
    const mocks = createMockDb({
      roles: [{ openid: "admin", role: "admin" }], failQueueWrite: true,
      bookings: { booking_1: { openid: "user", status: "confirmed", latestPickupHandoverId: handoverId } },
      handovers: { [handoverId]: { bookingId: "booking_1", stage: "pickup", status: "confirmed", version: 1, photos } }
    })
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {})
    const mod = await loadFunction("admin", mocks)
    const input = { action: "archive", bookingId: "booking_1", handoverId, stage: "pickup" }
    await expect(mod.main(input)).resolves.toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(mocks.handovers[handoverId].photos).toEqual(photos)
    expect(mocks.handovers[handoverId].status).toBe("confirmed")
    expect(mocks.queue).toHaveLength(0)
    mocks.allowQueue()
    expect(await mod.main(input)).toMatchObject({ ok: true, duplicate: false })
    expect(await mod.main(input)).toMatchObject({ ok: true, duplicate: true })
    expect(mocks.queue).toHaveLength(1)
    expect(mocks.queue[0].fileList).toEqual(photos.map((photo) => photo.fileId))
    errorSpy.mockRestore()
  })

  test("顾问提交完整四角交接记录并对重复 requestId 幂等", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin", permissions: ["booking_manage"] }],
      bookings: { booking_1: { openid: "user", status: "confirmed" } }
    })
    const mod = await loadFunction("admin", mocks)

    const first = await mod.main(validSubmit())
    const duplicate = await mod.main(validSubmit())

    expect(first).toMatchObject({ ok: true, duplicate: false, version: 1, handoverId: "booking_1__pickup__v1" })
    expect(duplicate).toMatchObject({ ok: true, duplicate: true, version: 1 })
    expect(mocks.handovers["booking_1__pickup__v1"].photos).toHaveLength(4)
    expect(mocks.bookings.booking_1.latestPickupHandoverId).toBe("booking_1__pickup__v1")
    expect(mocks.audits.filter((item) => item.action === "bookingHandoverSubmit")).toHaveLength(1)
  })

  test("照片、里程和能源校验在服务端执行", async () => {
    const mocks = createMockDb({ roles: [{ openid: "admin", role: "admin" }], bookings: { booking_1: { openid: "user", status: "confirmed" } } })
    const mod = await loadFunction("admin", mocks)
    const payload = validSubmit({ mileageKm: 1.5, energyLevelPercent: 101 })
    payload.photos = payload.photos.slice(0, 3)
    const result = await mod.main(payload)
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(result.details.errors.map((item) => item.field)).toEqual(expect.arrayContaining(["mileageKm", "energyLevelPercent", "photos"]))
    const emptyNumbers = await mod.main(validSubmit({ requestId: "request_empty_1", mileageKm: "", energyLevelPercent: "" }))
    expect(emptyNumbers.details.errors.map((item) => item.field)).toEqual(expect.arrayContaining(["mileageKm", "energyLevelPercent"]))
  })

  test("同版本旧提交不能覆盖新记录，旧成功请求在新版后重试仍幂等", async () => {
    const mocks = createMockDb({ roles: [{ openid: "admin", role: "admin" }], bookings: { booking_1: { openid: "user", status: "confirmed" } } })
    const mod = await loadFunction("admin", mocks)
    const original = validSubmit({ expectedVersion: 0, requestId: "first_request_001" })
    await mod.main(original)
    expect(await mod.main(validSubmit({ expectedVersion: 0, requestId: "stale_request_001", mileageKm: 12010 }))).toMatchObject({ ok: false, code: "VERSION_CONFLICT" })
    const replacement = await mod.main(validSubmit({ expectedVersion: 1, requestId: "newer_request_001", mileageKm: 12100 }))
    expect(replacement).toMatchObject({ ok: true, version: 2 })
    expect(await mod.main(original)).toMatchObject({ ok: true, duplicate: true, version: 1 })
    expect(mocks.bookings.booking_1.latestPickupHandoverId).toBe("booking_1__pickup__v2")
    expect(mocks.handovers.booking_1__pickup__v2.mileageKm).toBe(12100)
    expect(mocks.handovers.booking_1__pickup__v3).toBeUndefined()
    expect(mocks.audits.filter((item) => item.action === "bookingHandoverSubmit")).toHaveLength(2)
  })

  test("还车提交前要求用户已核对取车记录", async () => {
    const mocks = createMockDb({ roles: [{ openid: "admin", role: "admin" }], bookings: { booking_1: { openid: "user", status: "confirmed" } } })
    const mod = await loadFunction("admin", mocks)
    expect(await mod.main(validSubmit({ stage: "return" }))).toMatchObject({ ok: false, code: "PICKUP_NOT_CONFIRMED" })
  })

  test("预约本人可确认当前版本，其他用户不可读取式确认", async () => {
    const handoverId = "booking_1__pickup__v1"
    const mocks = createMockDb({
      bookings: { booking_1: { openid: "user", status: "confirmed", latestPickupHandoverId: handoverId, latestPickupHandoverVersion: 1 } },
      handovers: { [handoverId]: { bookingId: "booking_1", stage: "pickup", status: "submitted", version: 1 } }
    })
    const otherMod = await loadFunction("other", mocks)
    expect(await otherMod.main({ action: "confirm", bookingId: "booking_1", handoverId, stage: "pickup" })).toMatchObject({ ok: false, code: "FORBIDDEN" })
    const userMod = await loadFunction("user", mocks)
    const confirmed = await userMod.main({ action: "confirm", bookingId: "booking_1", handoverId, stage: "pickup" })
    expect(confirmed).toMatchObject({ ok: true, duplicate: false })
    expect(mocks.handovers[handoverId].status).toBe("confirmed")
    expect(mocks.bookings.booking_1.pickupHandoverConfirmedAt).toEqual(expect.any(Date))
  })

  test("归档清空照片并进入存储清理队列", async () => {
    const handoverId = "booking_1__pickup__v1"
    const photos = validSubmit().photos
    const mocks = createMockDb({
      roles: [{ openid: "admin", role: "admin" }],
      bookings: { booking_1: { openid: "user", status: "confirmed", latestPickupHandoverId: handoverId } },
      handovers: { [handoverId]: { bookingId: "booking_1", stage: "pickup", status: "confirmed", version: 1, photos } }
    })
    const mod = await loadFunction("admin", mocks)
    const result = await mod.main({ action: "archive", bookingId: "booking_1", handoverId, stage: "pickup" })
    expect(result).toMatchObject({ ok: true, duplicate: false })
    expect(mocks.handovers[handoverId].photos).toEqual([])
    expect(mocks.queue[0]).toMatchObject({ source: "bookingHandoverArchive", fileList: photos.map((item) => item.fileId) })
  })

  test("交接提交成功时向客户下发提车服务通知 (subscribeMessage)", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin", permissions: ["booking_manage"] }],
      bookings: { booking_1: { openid: "user_openid_1", vehicleName: "Porsche 911 GT3", status: "confirmed" } }
    })
    const mod = await loadFunction("admin", mocks)
    const cloud = require("wx-server-sdk")

    const result = await mod.main(validSubmit({ bookingId: "booking_1", stage: "pickup", mileageKm: 8880 }))
    expect(result).toMatchObject({ ok: true, duplicate: false, version: 1 })
    expect(cloud.openapi.subscribeMessage.send).toHaveBeenCalledWith(expect.objectContaining({
      touser: "user_openid_1",
      templateId: "tpl_handover_test_123",
      data: expect.objectContaining({
        thing1: { value: "Porsche 911 GT3" },
        phrase2: { value: "待核对" },
        thing3: { value: "取车记录已提交，请核对里程与车况" }
      })
    }))
  })

  test("微信订阅消息下发返回 43101 (未订阅) 时优雅降级，主流程不中断", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin", permissions: ["booking_manage"] }],
      bookings: { booking_1: { openid: "user_unsub", vehicleName: "Ferrari 488", status: "confirmed" } }
    })
    const mod = await loadFunction("admin", mocks)
    const cloud = require("wx-server-sdk")
    cloud.openapi.subscribeMessage.send.mockRejectedValueOnce({ errCode: 43101, errMsg: "user refuse to accept the msg" })

    const result = await mod.main(validSubmit({ bookingId: "booking_1", stage: "pickup" }))
    expect(result).toMatchObject({ ok: true, duplicate: false, version: 1 })
    // 主交接单成功更新
    expect(mocks.bookings.booking_1.latestPickupHandoverId).toBe("booking_1__pickup__v1")
    // 未订阅时不写入 error_logs
    expect(mocks.errorLogs).toHaveLength(0)
  })

  test("微信订阅消息接口异常时记录 error_logs，不阻断主流程", async () => {
    const mocks = createMockDb({
      roles: [{ openid: "admin", permissions: ["booking_manage"] }],
      bookings: { booking_1: { openid: "user_fail", vehicleName: "Ferrari 488", status: "confirmed" } }
    })
    const mod = await loadFunction("admin", mocks)
    const cloud = require("wx-server-sdk")
    cloud.openapi.subscribeMessage.send.mockRejectedValueOnce(new Error("system network timeout"))

    const result = await mod.main(validSubmit({ bookingId: "booking_1", stage: "pickup" }))
    expect(result).toMatchObject({ ok: true, duplicate: false, version: 1 })
    expect(mocks.errorLogs.filter((l) => l.stage === "subscribeMessage")).toHaveLength(1)
  })

  test("还车交接提交成功时向客户下发入库核验服务通知 (subscribeMessage)", async () => {
    const pickupHandoverId = "booking_1__pickup__v1"
    const mocks = createMockDb({
      roles: [{ openid: "admin", permissions: ["booking_manage"] }],
      bookings: {
        booking_1: {
          openid: "user_openid_2",
          vehicleName: "McLaren 720S",
          status: "confirmed",
          latestPickupHandoverId: pickupHandoverId
        }
      },
      handovers: {
        [pickupHandoverId]: { bookingId: "booking_1", stage: "pickup", status: "confirmed", version: 1 }
      }
    })
    const mod = await loadFunction("admin", mocks)
    const cloud = require("wx-server-sdk")

    const result = await mod.main(validSubmit({ bookingId: "booking_1", stage: "return", requestId: "req_return_99", mileageKm: 9200 }))
    expect(result).toMatchObject({ ok: true, duplicate: false, version: 1 })
    expect(cloud.openapi.subscribeMessage.send).toHaveBeenCalledWith(expect.objectContaining({
      touser: "user_openid_2",
      templateId: "tpl_handover_test_123",
      data: expect.objectContaining({
        thing1: { value: "McLaren 720S" },
        phrase2: { value: "待核对" },
        thing3: { value: "还车记录已提交，请核对里程与车况" }
      })
    }))
  })
})
