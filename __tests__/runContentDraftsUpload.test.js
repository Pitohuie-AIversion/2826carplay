jest.mock("@cloudbase/node-sdk", () => ({ init: jest.fn() }))
jest.mock("../scripts/bootstrapContentDrafts.js", () => ({
  loadAndValidateSeeds: jest.fn(), summarize: jest.fn(), SEED_DIR: "/offline/seeds",
  ID_PATTERN: jest.requireActual("../scripts/bootstrapContentDrafts.js").ID_PATTERN
}))

const cloudbase = require("@cloudbase/node-sdk")
const seeds = require("../scripts/bootstrapContentDrafts.js")
const { main } = require("../scripts/runContentDraftsUpload.js")

const guides = ["guide_alpha", "guide_beta"].map((slug) => ({
  slug, title: slug, summary: "摘要", body: "正文", contentType: "guide",
  scenario: "weekend_trip", vehicleIds: ["vehicle_1"], tags: ["周末"], shareTitle: "分享标题"
}))
const argv = (...args) => ["node", "runContentDraftsUpload.js", ...args]
const applyArgs = (...args) => argv("--apply", "--secret-id", "FAKE_TEST_ID", "--secret-key", "FAKE_TEST_KEY", ...args)
const existingDocs = (status) => guides.map((guide) => ({
  ...guide, _id: `content_${guide.slug}`, status, publishedAt: "2026-01-01T00:00:00.000Z"
}))

function createDb({ existing = [], verifyRows, lookupResult } = {}) {
  const docs = new Map(existing.map((doc) => [doc._id, { ...doc }]))
  const queries = []
  const readCounts = new Map()
  const events = []
  const unscopedGet = jest.fn(async () => ({ data: Array.from(docs.values()).slice(0, 50) }))
  const add = jest.fn(async (data) => {
    const id = `content_${data.slug}`
    docs.set(id, { ...data, _id: id })
    events.push({ action: "create", id, status: data.status })
    return { id }
  })
  const update = jest.fn(async (id, data) => {
    if (!docs.has(id)) return { updated: 0 }
    docs.set(id, { ...docs.get(id), ...data })
    events.push({ action: data.status === "published" ? "publish" : "update", id })
    return { updated: 1 }
  })
  const audit = jest.fn(async (data) => {
    events.push({ action: data.action, id: data.contentId })
    return { id: `audit_${events.length}` }
  })
  const collection = {
    add,
    doc: jest.fn((id) => ({ update: (data) => update(id, data) })),
    where: jest.fn((filter) => {
      const query = { filter }
      queries.push(query)
      const chain = {
        field: jest.fn((fields) => { query.fields = fields; return chain }),
        limit: jest.fn((limit) => { query.limit = limit; return chain }),
        get: jest.fn(async () => {
          const count = (readCounts.get(filter.slug) || 0) + 1
          readCounts.set(filter.slug, count)
          if (count === 1 && lookupResult) return lookupResult(filter.slug)
          let rows = Array.from(docs.values()).filter((doc) => doc.slug === filter.slug).map((doc) => ({ ...doc }))
          if (count > 1 && verifyRows) rows = verifyRows(rows, filter.slug)
          return { data: rows.slice(0, query.limit || rows.length) }
        })
      }
      return chain
    }),
    limit: jest.fn(() => ({ field: () => ({ get: unscopedGet }) }))
  }
  const db = {
    serverDate: jest.fn(() => ({ __type: "serverDate" })),
    collection: jest.fn((name) => {
      if (name === "content_guides") return collection
      if (name === "audit_logs") return { add: audit }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }
  cloudbase.init.mockReturnValue({ database: () => db })
  return { db, docs, collection, add, update, audit, queries, unscopedGet, events }
}

async function outcome(args) {
  try { return { code: await main(args) } } catch (error) { return { error } }
}

function expectFailure(result, message) {
  expect(result.error).toBeInstanceOf(Error)
  expect(result.error.message).toMatch(message)
}

describe("runContentDraftsUpload offline import", () => {
  beforeEach(() => {
    jest.resetAllMocks()
    jest.replaceProperty(process, "env", { ...process.env, TENCENT_SECRET_ID: "", TENCENT_SECRET_KEY: "" })
    jest.spyOn(process, "exit").mockImplementation(() => {})
    jest.spyOn(console, "log").mockImplementation(() => {})
    jest.spyOn(console, "error").mockImplementation(() => {})
    jest.spyOn(console, "warn").mockImplementation(() => {})
    const items = guides.map((guide) => ({ fileName: `draft_${guide.slug}.json`, guide, invalidFields: [] }))
    const seedResults = { results: items, duplicates: [] }
    seeds.loadAndValidateSeeds.mockReturnValue(seedResults)
    seeds.summarize.mockReturnValue({ total: items.length, passed: items.length, failed: 0, duplicates: [], items })
  })

  afterEach(() => jest.restoreAllMocks())

  test("default dry-run validates and previews without credentials or initializing CloudBase", async () => {
    const mocks = createDb()
    await expect(main(argv())).resolves.toBe(0)
    expect(seeds.loadAndValidateSeeds).toHaveBeenCalledTimes(1)
    expect(cloudbase.init).not.toHaveBeenCalled()
    expect(mocks.db.serverDate).not.toHaveBeenCalled()
    expect(mocks.db.collection).not.toHaveBeenCalled()
    expect(process.exit).not.toHaveBeenCalled()
  })

  test("apply without credentials fails before initialization", async () => {
    createDb()
    const result = await outcome(argv("--apply"))
    expect(cloudbase.init).not.toHaveBeenCalled()
    expect(result).toEqual({ code: 1 })
  })

  test("dry-run overwrite and cleanup flags still require no credentials or database access", async () => {
    const mocks = createDb()
    await expect(main(argv("--force-overwrite", "--cleanup"))).resolves.toBe(0)
    expect(cloudbase.init).not.toHaveBeenCalled()
    expect(mocks.db.serverDate).not.toHaveBeenCalled()
    expect(mocks.db.collection).not.toHaveBeenCalled()
  })

  test("CloudBase initialization failure returns a failure exit code", async () => {
    cloudbase.init.mockImplementation(() => { throw new Error("init failed") })
    expect(await outcome(applyArgs())).toEqual({ code: 1 })
  })

  test("new guides are created as drafts, published and audited for both successful actions", async () => {
    const mocks = createDb()
    const result = await outcome(applyArgs())
    for (const guide of guides) {
      const id = `content_${guide.slug}`
      expect(mocks.events.filter((event) => event.id === id).map((event) => event.action)).toEqual([
        "create", "contentGuide.create", "publish", "contentGuide.publish"
      ])
      expect(mocks.docs.get(id)).toMatchObject({ slug: guide.slug, status: "published" })
    }
    expect(mocks.add.mock.calls.every(([data]) => data.status === "draft")).toBe(true)
    expect(result).toEqual({ code: 0 })
  })

  test("already-published guides without overwrite produce no writes or audit records", async () => {
    const mocks = createDb({ existing: existingDocs("published") })
    const before = Array.from(mocks.docs.values()).map((doc) => ({ ...doc }))
    const result = await outcome(applyArgs())
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(Array.from(mocks.docs.values())).toEqual(before)
    expect(result).toEqual({ code: 0 })
  })

  test.each([{ code: "DATABASE_ERROR" }, {}])("malformed initial query response %p cannot be treated as an empty collection", async (response) => {
    const mocks = createDb({ lookupResult: () => response })
    const result = await outcome(applyArgs())
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expectFailure(result, /Invalid content query result/)
  })

  test("duplicate initial slug matches cannot overwrite the first matching document", async () => {
    const existing = existingDocs("draft")
    existing.push({ ...existing[0], _id: "duplicate_document" })
    const mocks = createDb({ existing })
    const before = Array.from(mocks.docs.values()).map((doc) => ({ ...doc }))
    const result = await outcome(applyArgs("--force-overwrite"))
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expect(Array.from(mocks.docs.values())).toEqual(before)
    expectFailure(result, /Multiple content records found/)
  })

  test("existing drafts are only published and receive only publish audits", async () => {
    const mocks = createDb({ existing: existingDocs("draft") })
    const result = await outcome(applyArgs())
    expect(mocks.add).not.toHaveBeenCalled()
    expect(mocks.update).toHaveBeenCalledTimes(guides.length)
    expect(mocks.audit.mock.calls.map(([data]) => data.action)).toEqual(guides.map(() => "contentGuide.publish"))
    expect(result).toEqual({ code: 0 })
  })

  test("force-overwrite audits both update and publish after successful writes", async () => {
    const mocks = createDb({ existing: existingDocs("published") })
    const result = await outcome(applyArgs("--force-overwrite"))
    expect(mocks.add).not.toHaveBeenCalled()
    for (const guide of guides) {
      expect(mocks.events.filter((event) => event.id === `content_${guide.slug}`).map((event) => event.action)).toEqual([
        "update", "contentGuide.update", "publish", "contentGuide.publish"
      ])
    }
    expect(result).toEqual({ code: 0 })
  })

  test.each([undefined, null, {}, { updated: 0 }, { updated: 2 }, { updated: "1" }, { stats: { updated: 1 } }].map((value) => [value]))(
    "an invalid Node SDK update receipt %p stops processing without success audits", async (receipt) => {
      const mocks = createDb({ existing: existingDocs("draft") })
      mocks.update.mockResolvedValueOnce(receipt)
      const result = await outcome(applyArgs())
      expect(mocks.update).toHaveBeenCalledTimes(1)
      expect(mocks.audit).not.toHaveBeenCalled()
      expectFailure(result, /Content update was not confirmed/)
    }
  )

  test("a thrown update error does not continue publishing or auditing", async () => {
    const mocks = createDb({ existing: existingDocs("published") })
    mocks.update.mockRejectedValueOnce(new Error("write rejected"))
    const result = await outcome(applyArgs("--force-overwrite"))
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.audit).not.toHaveBeenCalled()
    expectFailure(result, /write rejected/)
  })

  test("a successful create remains audited when its later publish fails", async () => {
    const mocks = createDb()
    mocks.update.mockRejectedValueOnce(new Error("publish failed"))
    const result = await outcome(applyArgs())
    expect(mocks.add).toHaveBeenCalledTimes(1)
    expect(mocks.update).toHaveBeenCalledTimes(1)
    expect(mocks.docs.get("content_guide_alpha").status).toBe("draft")
    expect(mocks.audit.mock.calls.map(([data]) => data.action)).toEqual(["contentGuide.create"])
    expectFailure(result, /publish failed/)
  })

  test("an audit failure does not stop publication or processing the next guide", async () => {
    const mocks = createDb()
    mocks.audit.mockRejectedValueOnce(new Error("audit unavailable"))
    const result = await outcome(applyArgs())
    expect(mocks.add).toHaveBeenCalledTimes(2)
    expect(mocks.update).toHaveBeenCalledTimes(2)
    expect(mocks.audit.mock.calls.map(([data]) => data.action)).toEqual([
      "contentGuide.create", "contentGuide.publish", "contentGuide.create", "contentGuide.publish"
    ])
    expect(Array.from(mocks.docs.values()).every(({ status }) => status === "published")).toBe(true)
    expect(console.warn).toHaveBeenCalledTimes(1)
    expect(result).toEqual({ code: 0 })
  })

  test.each([undefined, {}, { id: "" }, { id: 123 }, { id: ["valid_id"] }, { id: "v".repeat(65) }].map((value) => [value]))("add receipt %p without a valid document ID cannot publish or audit", async (receipt) => {
    const mocks = createDb()
    mocks.add.mockResolvedValueOnce(receipt)
    const result = await outcome(applyArgs())
    expect(mocks.add).toHaveBeenCalledTimes(1)
    expect(mocks.update).not.toHaveBeenCalled()
    expect(mocks.audit).not.toHaveBeenCalled()
    expectFailure(result, /Content creation was not confirmed/)
  })

  test.each([
    ["missing", () => []],
    ["duplicate", (rows) => [rows[0], { ...rows[0], _id: "duplicate_document" }]],
    ["wrong ID", (rows) => [{ ...rows[0], _id: "different_document" }]],
    ["unpublished", (rows) => [{ ...rows[0], status: "draft" }]]
  ])("smoke verification rejects %s target rows", async (label, transform) => {
    const mocks = createDb({ existing: existingDocs("published"), verifyRows: transform })
    const result = await outcome(applyArgs())
    expect(mocks.unscopedGet).not.toHaveBeenCalled()
    expect(result).toEqual({ code: 2 })
  })

  test("verification reports one of two targets when only one slug is missing", async () => {
    const mocks = createDb({
      existing: existingDocs("published"),
      verifyRows: (rows, slug) => slug === "guide_alpha" ? [] : rows
    })
    const result = await outcome(applyArgs())
    expect(result).toEqual({ code: 2 })
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("PARTIAL: 1/2 records verified as published."))
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("ALL SUCCESS"))
    expect(mocks.unscopedGet).not.toHaveBeenCalled()
  })

  test("verification queries every target slug precisely and does not sample the first 50 documents", async () => {
    const unrelated = Array.from({ length: 55 }, (_, index) => ({ _id: `unrelated_${index}`, slug: `unrelated_${index}`, status: "published" }))
    const mocks = createDb({ existing: [...unrelated, ...existingDocs("published")] })
    const result = await outcome(applyArgs())
    expect(mocks.unscopedGet).not.toHaveBeenCalled()
    expect(mocks.queries).toHaveLength(guides.length * 2)
    for (const guide of guides) expect(mocks.queries.filter(({ filter }) => filter.slug === guide.slug)).toHaveLength(2)
    mocks.queries.forEach((query) => {
      expect(query.filter).toEqual({ slug: expect.any(String) })
      expect(query.limit).toBe(2)
      expect(query.fields).toMatchObject({ _id: true, slug: true, status: true })
    })
    expect(result).toEqual({ code: 0 })
  })
})
