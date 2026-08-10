jest.mock("wx-server-sdk")

function createMockDb({ roles = [], bookings = {}, handovers = {} } = {}) {
  const queue = []
  const audits = []
  const now = new Date("2026-08-10T02:00:00.000Z")

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
      return { add: jest.fn(async ({ data }) => { queue.push(data); return { _id: `queue_${queue.length}` } }) }
    }
    if (name === "audit_logs") {
      return { add: jest.fn(async ({ data }) => { audits.push(data); return { _id: `audit_${audits.length}` } }) }
    }
    if (name === "error_logs") return { add: jest.fn().mockResolvedValue({ _id: "error_1" }) }
    throw new Error(`Unexpected collection: ${name}`)
  }

  const db = {
    collection,
    serverDate: jest.fn(() => now),
    runTransaction: jest.fn(async (callback) => callback({ collection }))
  }
  return { db, queue, audits, bookings, handovers }
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
})
