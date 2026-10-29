jest.mock("wx-server-sdk")

const NOW = Date.parse("2026-10-29T08:00:00.000Z")
const PAST = NOW - 60000
function guide(slug = "guide_1", overrides = {}) {
  return {
    _id: `record_${slug}`, slug, title: slug, summary: "摘要", body: "正文",
    status: "published", publishedAt: new Date(PAST), contentType: "guide",
    scenario: "handover_tips", vehicleIds: [], ...overrides
  }
}

const command = {
  eq: (value) => ({ operator: "eq", value }),
  elemMatch: (condition) => ({ operator: "elemMatch", condition })
}

function matchesQuery(row, filter) {
  // Keep malformed rows available to the handler's defensive validation.
  if (!row || typeof row !== "object" || Array.isArray(row)) return true
  return Object.entries(filter).every(([key, value]) => {
    if (value && value.operator === "elemMatch") {
      return Array.isArray(row[key]) && row[key].some((item) => item === value.condition.value)
    }
    return row[key] === value
  })
}

function compareIds(left, right) {
  if (left === right) return 0
  if (left === undefined || left === null) return -1
  if (right === undefined || right === null) return 1
  if (typeof left !== typeof right) return typeof left === "number" ? -1 : 1
  return left < right ? -1 : 1
}

function setup(functionName, options = {}) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  let filter = {}, ordering = null, offset = 0, count = Infinity
  const query = {
    get: jest.fn(async () => {
      if ("queryResponse" in options) return options.queryResponse
      const rows = (options.rows || []).filter((row) => matchesQuery(row, filter))
      if (ordering) rows.sort((left, right) => compareIds(left && left[ordering.field], right && right[ordering.field]) * (ordering.direction === "desc" ? -1 : 1))
      return { data: rows.slice(offset, offset + count) }
    })
  }
  query.where = jest.fn((value) => { filter = value; return query })
  query.field = jest.fn(() => query)
  query.orderBy = jest.fn((field, direction) => { ordering = { field, direction }; return query })
  query.skip = jest.fn((value) => { offset = value; return query })
  query.limit = jest.fn((value) => { count = value; return query })
  const vehicleGet = jest.fn(async (id) => ({ data: { name: `车辆 ${id}`, status: "idle" } }))
  const vehicles = { doc: jest.fn((id) => ({ field: () => ({ get: () => vehicleGet(id) }) })) }
  const db = { command, collection: jest.fn((name) => {
    if (name === "content_guides") return query
    if (name === "vehicles") return vehicles
    throw new Error(`Unexpected collection: ${name}`)
  }) }
  cloud.__setMockDb(db)
  const main = functionName === "detail"
    ? require("../cloudfunctions/contentGuideDetail/index").main
    : require("../cloudfunctions/contentGuideList/index").main
  return { main, db, query, vehicles, vehicleGet }
}

const invalidTimes = [
  ["invalid Date", () => new Date(NaN)],
  ["toDate returns invalid Date", () => ({ toDate: () => new Date(NaN) })],
  ["toDate throws", () => ({ toDate: () => { throw new Error("invalid timestamp") } })],
  ["toDate returns a number", () => ({ toDate: () => PAST })],
  ["toDate returns null", () => ({ toDate: () => null })],
  ["boolean", () => true],
  ["date string array", () => ["2026-10-01T00:00:00.000Z"]],
  ["number array", () => [123]],
  ["plain object", () => ({})],
  ["non-finite number", () => Infinity]
]

describe("public content read validation", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW)
    jest.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  test.each(invalidTimes)("detail rejects %s publication time before reading linked vehicles", async (label, createTime) => {
    const mocks = setup("detail", { rows: [guide("guide_1", { publishedAt: createTime(), vehicleIds: ["car_1"] })] })
    expect(await mocks.main({ contentId: "guide_1" })).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(mocks.vehicles.doc).not.toHaveBeenCalled()
  })

  test.each(invalidTimes)("list skips %s publication time without losing valid content", async (label, createTime) => {
    const mocks = setup("list", { rows: [guide("invalid", { publishedAt: createTime() }), guide("valid")] })
    const result = await mocks.main({})
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual(["valid"])
  })

  test.each([
    ["Date", () => new Date(PAST)], ["number", () => PAST],
    ["string", () => new Date(PAST).toISOString()], ["toDate", () => ({ toDate: () => new Date(PAST) })]
  ])("both endpoints accept a valid %s publication time", async (label, createTime) => {
    const detail = setup("detail", { rows: [guide("guide_1", { publishedAt: createTime() })] })
    expect(await detail.main({ contentId: "guide_1" })).toMatchObject({ ok: true, guide: { id: "guide_1" } })
    const list = setup("list", { rows: [guide("guide_1", { publishedAt: createTime() })] })
    expect(await list.main({})).toMatchObject({ ok: true, list: [{ id: "guide_1" }] })
  })

  test("detail converts a timestamp once instead of re-reading a changing value", async () => {
    const toDate = jest.fn().mockReturnValueOnce(new Date(PAST)).mockImplementation(() => { throw new Error("converted twice") })
    const mocks = setup("detail", { rows: [guide("guide_1", { publishedAt: { toDate } })] })
    expect(await mocks.main({ contentId: "guide_1" })).toMatchObject({ ok: true })
    expect(toDate).toHaveBeenCalledTimes(1)
  })

  test("list reuses the validated timestamp for sorting", async () => {
    const toDate = jest.fn().mockReturnValueOnce(new Date(PAST)).mockImplementation(() => { throw new Error("converted twice") })
    const mocks = setup("list", { rows: [guide("older", { publishedAt: new Date(PAST - 60000) }), guide("newer", { publishedAt: { toDate } })] })
    const result = await mocks.main({})
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual(["newer", "older"])
    expect(toDate).toHaveBeenCalledTimes(1)
  })

  test.each([undefined, null, {}, { data: null }, { data: {} }, { data: "invalid" }].map((value) => [value]))(
    "malformed query response %p is an error rather than an empty success or NOT_FOUND", async (queryResponse) => {
      for (const functionName of ["detail", "list"]) {
        const mocks = setup(functionName, { queryResponse })
        expect(await mocks.main({ contentId: "guide_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
        expect(mocks.vehicles.doc).not.toHaveBeenCalled()
      }
    }
  )

  test("a valid empty query remains NOT_FOUND for detail and an empty list for listing", async () => {
    const detail = setup("detail", { rows: [] })
    expect(await detail.main({ contentId: "guide_1" })).toMatchObject({ ok: false, code: "NOT_FOUND" })
    const list = setup("list", { rows: [] })
    expect(await list.main({})).toEqual({ ok: true, list: [] })
  })

  test.each([null, [], 123].map((value) => [value]))("detail rejects malformed returned row %p", async (row) => {
    const mocks = setup("detail", { rows: [row] })
    expect(await mocks.main({ contentId: "guide_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(mocks.vehicles.doc).not.toHaveBeenCalled()
  })

  test("detail cannot return a published record for a different slug", async () => {
    const mocks = setup("detail", { queryResponse: { data: [guide("other_guide", { vehicleIds: ["car_1"] })] } })
    expect(await mocks.main({ contentId: "guide_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(mocks.vehicles.doc).not.toHaveBeenCalled()
  })

  test("list ignores malformed rows and unknown statuses without discarding valid content", async () => {
    const mocks = setup("list", { queryResponse: { data: [null, [], 123, guide("unknown", { status: "unknown" }), guide("valid")] } })
    const result = await mocks.main({})
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual(["valid"])
  })

  test.each([false, true])("detail refuses duplicate slug records regardless of returned order: reverse=%s", async (reverse) => {
    const rows = [guide("guide_1", { _id: "draft_record", status: "draft" }), guide("guide_1", { _id: "published_record", vehicleIds: ["car_1"] })]
    const mocks = setup("detail", { rows: reverse ? rows.reverse() : rows })
    expect(await mocks.main({ contentId: "guide_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(mocks.vehicles.doc).not.toHaveBeenCalled()
  })

  test.each([false, 0, null, "", [], 123, ["guide_1"], {}].map((value) => [value]))(
    "explicit invalid contentId %p cannot fall back to a valid slug alias", async (contentId) => {
      const mocks = setup("detail", { rows: [guide()] })
      expect(await mocks.main({ contentId, slug: "guide_1" })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
      expect(mocks.db.collection).not.toHaveBeenCalled()
    }
  )

  test("a text slug alias remains supported when contentId is absent", async () => {
    const mocks = setup("detail", { rows: [guide()] })
    expect(await mocks.main({ slug: "guide_1" })).toMatchObject({ ok: true, guide: { id: "guide_1" } })
    expect(mocks.query.where).toHaveBeenCalledWith({ slug: "guide_1" })
  })

  test("linked vehicle IDs are complete text, trimmed and deduplicated before the 20-ID limit", async () => {
    const boundaryId = "v".repeat(64)
    const vehicleIds = [
      ...Array(22).fill("car_1"), boundaryId, " car_2 ", 123, ["car_3"], "v".repeat(65), "../invalid", "",
      ...Array.from({ length: 22 }, (_, index) => `car_${index + 3}`)
    ]
    const expected = ["car_1", boundaryId, ...Array.from({ length: 18 }, (_, index) => `car_${index + 2}`)]
    const mocks = setup("detail", { rows: [guide("guide_1", { vehicleIds })] })
    const result = await mocks.main({ contentId: "guide_1" })
    expect(result.ok).toBe(true)
    expect(result.guide.vehicleIds).toEqual(expected)
    expect(result.vehicles.map(({ id }) => id)).toEqual(expected)
    expect(mocks.vehicles.doc.mock.calls.map(([id]) => id)).toEqual(expected)
    expect(mocks.vehicleGet).toHaveBeenCalledTimes(20)
  })

  const filterRows = () => [
    guide("match", { vehicleIds: ["car_1", "123"] }),
    guide("other", { scenario: "weekend_trip", contentType: "route", vehicleIds: ["car_2"] })
  ]

  test.each([
    [{ contentType: "guide" }, "match"], [{ scenario: "handover_tips" }, "match"],
    [{ contentType: "guide", scenario: "handover_tips" }, "match"], [{ contentType: "route" }, "other"]
  ])("recognized list filter %p selects the matching content", async (input, expectedId) => {
    const mocks = setup("list", { rows: filterRows() })
    const result = await mocks.main(input)
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual([expectedId])
  })

  test.each([
    { scenario: ["weekend_trip"] }, { scenario: 123 }, { contentType: ["route"] },
    { contentType: 123 }, { vehicleId: ["car_1"] }, { vehicleId: 123 }
  ])("non-text list filters %p are ignored rather than coerced into another selection", async (input) => {
    const mocks = setup("list", { rows: filterRows() })
    const result = await mocks.main(input)
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual(["match", "other"])
  })
})
