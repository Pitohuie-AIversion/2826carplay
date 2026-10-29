jest.mock("wx-server-sdk")

const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value))
const initialGuide = (status = "draft") => ({
  _id: "content_1", slug: "weekend-guide", title: "原始标题", status,
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...(status !== "draft" ? { publishedAt: "2025-12-01T00:00:00.000Z" } : {})
})
const validGuide = {
  slug: "weekend-guide", title: "周末用车", summary: "出行准备", body: "核对档期与报价",
  contentType: "guide", scenario: "weekend_trip", vehicleIds: []
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function createDb(options = {}) {
  let committed = options.missing ? {} : { content_1: clone(options.guide || initialGuide()) }
  let revision = 0
  let dateSerial = 0
  let conflictInjected = false
  let concurrentReads = 0
  const readBarrier = deferred()
  const attempts = []
  const committedWrites = []
  const firstReadStatuses = []
  const auditSnapshots = []
  const auditAdd = jest.fn(async () => {
    auditSnapshots.push(clone(committed))
    return { _id: "audit_1" }
  })
  const guideAdd = jest.fn().mockResolvedValue({ _id: "new_content" })
  const updateResult = "updateResult" in options ? options.updateResult : { stats: { updated: 1 } }
  const updateAttempts = jest.fn()

  function documentApi(state, id, transaction) {
    const get = async (fields) => {
      const record = clone(state[id])
      if (transaction && transaction.iteration === 0 && options.synchronizeFirstReads) {
        firstReadStatuses.push(record && record.status)
        if (++concurrentReads === 2) readBarrier.resolve()
        await readBarrier.promise
      }
      if ("readResponse" in options) return clone(options.readResponse)
      return { data: record ? Object.fromEntries(Object.entries(record).filter(([key]) => !fields || fields[key])) : null }
    }
    return {
      get: () => get(),
      field: (fields) => ({ get: () => get(fields) }),
      update: async ({ data }) => {
        updateAttempts(id, clone(data))
        if (options.updateError) throw options.updateError
        if (!state[id]) return { stats: { updated: 0 } }
        if (updateResult && updateResult.stats && updateResult.stats.updated === 1) {
          state[id] = { ...state[id], ...clone(data) }
          const write = { id, data: clone(data) }
          if (transaction) transaction.writes.push(write)
          else { committedWrites.push(write); revision++ }
        }
        return clone(updateResult)
      }
    }
  }

  const roles = { get: async () => ({ data: [{ role: "admin" }] }) }
  for (const method of ["where", "field", "limit"]) roles[method] = () => roles
  const slugQuery = { get: async () => ({ data: [] }) }
  for (const method of ["field", "limit"]) slugQuery[method] = () => slugQuery
  const db = {
    serverDate: jest.fn(() => ({ __type: "serverDate", serial: ++dateSerial })),
    collection: (name) => {
      if (name === "roles") return roles
      if (name === "audit_logs") return { add: auditAdd }
      if (name === "content_guides") return {
        where: () => slugQuery, add: guideAdd, doc: (id) => documentApi(committed, id)
      }
      throw new Error(`Unexpected collection: ${name}`)
    },
    runTransaction: jest.fn(async (callback) => {
      for (let iteration = 0; iteration < 4; iteration++) {
        const snapshotRevision = revision
        const staged = clone(committed)
        const transaction = { iteration, writes: [] }
        attempts.push(transaction)
        const result = await callback({ collection: (name) => {
          if (name === "content_guides") return { doc: (id) => documentApi(staged, id, transaction) }
          if (name === "audit_logs") return { add: auditAdd }
          throw new Error(`Unexpected transaction collection: ${name}`)
        } })
        if (options.failCommit) throw new Error("injected transaction commit failure")
        if (options.conflictOnce && !conflictInjected) {
          conflictInjected = true
          committed.content_1.title = "并发编辑的新标题"
          revision++
        }
        // Only a commit version conflict retries; rejected read/update calls propagate.
        if (snapshotRevision !== revision) continue
        if (transaction.writes.length) {
          committed = staged
          revision++
          committedWrites.push(...transaction.writes)
        }
        return result
      }
      throw new Error("transaction retry limit exceeded")
    })
  }
  return { db, auditAdd, auditSnapshots, guideAdd, attempts, committedWrites, firstReadStatuses, updateAttempts, snapshot: () => clone(committed) }
}

function loadMain(mocks) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "operator" })
  cloud.__setMockDb(mocks.db)
  return require("../cloudfunctions/contentGuideManage/index").main
}

describe("contentGuideManage status transaction semantics", () => {
  beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  test.each([["publish", "published"], ["archive", "archived"]])("repeated %s preserves the record, timestamps and audit history", async (action, status) => {
    const mocks = createDb({ guide: initialGuide(status) })
    const main = loadMain(mocks)
    const before = mocks.snapshot()
    expect(await main({ action, id: "content_1" })).toMatchObject({ ok: true, id: "content_1", status })
    expect(mocks.snapshot()).toEqual(before)
    expect(mocks.committedWrites).toEqual([])
    expect(mocks.updateAttempts).not.toHaveBeenCalled()
    expect(mocks.db.serverDate).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("archiving preserves the previous publication date and republishing sets a new date", async () => {
    const mocks = createDb({ guide: initialGuide("published") })
    const main = loadMain(mocks)
    const before = mocks.snapshot().content_1
    expect(await main({ action: "archive", id: "content_1" })).toMatchObject({ ok: true, status: "archived" })
    const archived = mocks.snapshot().content_1
    expect(archived.publishedAt).toEqual(before.publishedAt)
    expect(await main({ action: "publish", id: "content_1" })).toMatchObject({ ok: true, status: "published" })
    const published = mocks.snapshot().content_1
    expect(published.publishedAt).not.toEqual(before.publishedAt)
    expect(published.updatedAt).not.toEqual(archived.updatedAt)
    expect(mocks.committedWrites).toHaveLength(2)
    expect(mocks.auditAdd.mock.calls.map(([payload]) => payload.data.action)).toEqual(["contentGuide.archive", "contentGuide.publish"])
  })

  test.each([["publish", "draft", "published"], ["archive", "published", "archived"]])(
    "two overlapping %s requests retry a commit conflict, commit one transition and write one audit", async (action, initialStatus, status) => {
    const mocks = createDb({ synchronizeFirstReads: true, guide: initialGuide(initialStatus) })
    const main = loadMain(mocks)
    const results = await Promise.all([
      main({ action, id: "content_1" }), main({ action, id: "content_1" })
    ])
    expect(results).toEqual([
      expect.objectContaining({ ok: true, status }), expect.objectContaining({ ok: true, status })
    ])
    expect(mocks.firstReadStatuses).toEqual([initialStatus, initialStatus])
    expect(mocks.attempts).toHaveLength(3)
    expect(mocks.updateAttempts).toHaveBeenCalledTimes(2)
    expect(mocks.committedWrites).toHaveLength(1)
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
    expect(mocks.auditSnapshots[0].content_1.status).toBe(status)
    expect(mocks.snapshot().content_1.status).toBe(status)
  })

  test("a conflicted callback retries without auditing its discarded write", async () => {
    const mocks = createDb({ conflictOnce: true })
    const main = loadMain(mocks)
    expect(await main({ action: "publish", id: "content_1" })).toMatchObject({ ok: true, status: "published" })
    expect(mocks.attempts).toHaveLength(2)
    expect(mocks.updateAttempts).toHaveBeenCalledTimes(2)
    expect(mocks.committedWrites).toHaveLength(1)
    expect(mocks.snapshot().content_1).toMatchObject({ title: "并发编辑的新标题", status: "published" })
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
    expect(mocks.auditSnapshots[0]).toEqual(mocks.snapshot())
  })

  test("a commit failure rolls back the staged status and produces no success audit", async () => {
    const mocks = createDb({ failCommit: true })
    const main = loadMain(mocks)
    const before = mocks.snapshot()
    expect(await main({ action: "publish", id: "content_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(mocks.updateAttempts).toHaveBeenCalledTimes(1)
    expect(mocks.snapshot()).toEqual(before)
    expect(mocks.committedWrites).toEqual([])
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("an SDK-wrapped update conflict fails safely without assuming an automatic retry", async () => {
    const mocks = createDb({ updateError: { errCode: -501001, errMsg: "Transaction conflict: document version changed" } })
    const main = loadMain(mocks)
    const before = mocks.snapshot()
    expect(await main({ action: "publish", id: "content_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(mocks.db.runTransaction).toHaveBeenCalledTimes(1)
    expect(mocks.attempts).toHaveLength(1)
    expect(mocks.updateAttempts).toHaveBeenCalledTimes(1)
    expect(mocks.snapshot()).toEqual(before)
    expect(mocks.committedWrites).toEqual([])
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test.each(["publish", "archive"])("%s returns NOT_FOUND for a missing document", async (action) => {
    const mocks = createDb({ missing: true })
    const main = loadMain(mocks)
    expect(await main({ action, id: "content_1" })).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(mocks.updateAttempts).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test.each([undefined, {}, { data: [] }, { data: "bad" }, { data: { status: "draft" } }, { data: { _id: "other_content", status: "draft" } }].map((value) => [value]))(
    "malformed document response %p cannot publish or audit", async (readResponse) => {
      const mocks = createDb({ readResponse })
      const main = loadMain(mocks)
      const before = mocks.snapshot()
      expect(await main({ action: "publish", id: "content_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
      expect(mocks.snapshot()).toEqual(before)
      expect(mocks.updateAttempts).not.toHaveBeenCalled()
      expect(mocks.auditAdd).not.toHaveBeenCalled()
    }
  )

  test("a zero update receipt returns NOT_FOUND without a success audit", async () => {
    const mocks = createDb({ updateResult: { stats: { updated: 0 } } })
    const main = loadMain(mocks)
    const before = mocks.snapshot()
    expect(await main({ action: "publish", id: "content_1" })).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(mocks.snapshot()).toEqual(before)
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test.each([null, {}, { stats: {} }, { stats: { updated: "1" } }, { stats: { updated: 2 } }])("invalid update receipt %p does not commit or audit", async (updateResult) => {
    const mocks = createDb({ updateResult })
    const main = loadMain(mocks)
    const before = mocks.snapshot()
    expect(await main({ action: "publish", id: "content_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(mocks.updateAttempts).toHaveBeenCalledTimes(1)
    expect(mocks.snapshot()).toEqual(before)
    expect(mocks.committedWrites).toEqual([])
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test.each([
    undefined, null, {}, { _id: "" }, { _id: 123 }, { _id: ["new_content"] },
    { _id: "a".repeat(65) }, { _id: " new_content " }, { _id: "../content" },
    { _id: null, id: "fallback_id" }, { _id: 123, id: "fallback_id" }
  ].map((value) => [value]))("invalid create receipt %p cannot report success or audit", async (receipt) => {
    const mocks = createDb()
    mocks.guideAdd.mockResolvedValueOnce(receipt)
    const main = loadMain(mocks)
    expect(await main({ action: "create", guide: validGuide })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(mocks.guideAdd).toHaveBeenCalledTimes(1)
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test.each([
    [{ _id: "new_content" }, "new_content"], [{ id: "fallback_id" }, "fallback_id"],
    [{ _id: undefined, id: "fallback_id" }, "fallback_id"], [{ _id: "a".repeat(64) }, "a".repeat(64)]
  ])("valid create receipt %p preserves the exact ID and records one audit", async (receipt, id) => {
    const mocks = createDb()
    mocks.guideAdd.mockResolvedValueOnce(receipt)
    const main = loadMain(mocks)
    expect(await main({ action: "create", guide: validGuide })).toMatchObject({ ok: true, id, status: "draft" })
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
    expect(mocks.auditAdd.mock.calls[0][0].data).toMatchObject({ action: "contentGuide.create", contentId: id })
  })
})
