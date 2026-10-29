jest.mock("wx-server-sdk")

const NOW = Date.parse("2026-10-30T02:00:00.000Z")
const OLD = NOW - 3600000
const textId = (index) => `guide_${String(index).padStart(4, "0")}`

function guide(index, overrides = {}) {
  const id = textId(index)
  return {
    _id: id, slug: id, title: id, status: "published",
    contentType: "guide", scenario: "handover_tips", vehicleIds: [],
    publishedAt: new Date(OLD), ...overrides
  }
}

function rows(count) {
  return Array.from({ length: count }, (_, index) => guide(index + 1))
}

// Execute the query against records, rather than returning a pre-arranged page per call.
// Numbers and strings have distinct identities and sort groups, as database IDs do.
function setup(records, { responses = {} } = {}) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  const requests = []
  const command = {
    eq: jest.fn((value) => ({ operation: "eq", value })),
    elemMatch: jest.fn((condition) => ({ operation: "elemMatch", condition }))
  }
  const matches = (record, where) => Object.entries(where).every(([key, expected]) => {
    if (expected && expected.operation === "elemMatch") {
      return Array.isArray(record[key]) && record[key].some((value) => value === expected.condition.value)
    }
    return record[key] === expected
  })
  function query(state = {}) {
    return {
      where: (where) => query({ ...state, where }),
      field: (fields) => query({ ...state, fields }),
      orderBy: (key, direction) => query({ ...state, order: { key, direction } }),
      skip: (offset) => query({ ...state, offset }),
      limit: (limit) => query({ ...state, limit }),
      get: async () => {
        const request = { where: state.where || {}, order: state.order, offset: state.offset || 0, limit: state.limit }
        requests.push(request)
        if (Object.prototype.hasOwnProperty.call(responses, requests.length)) {
          const response = responses[requests.length]
          if (response instanceof Error) throw response
          return response
        }
        let found = records.filter((record) => matches(record, request.where))
        if (request.order) {
          const { key, direction } = request.order
          found.sort((left, right) => {
            const a = left[key]
            const b = right[key]
            const result = typeof a !== typeof b ? (typeof a === "number" ? -1 : 1) : (a < b ? -1 : a > b ? 1 : 0)
            return direction === "desc" ? -result : result
          })
        }
        found = found.slice(request.offset, request.offset + (request.limit === undefined ? found.length : request.limit))
        request.ids = found.map((record) => `${typeof record._id}:${record._id}`)
        return { data: found.map((record) => state.fields
          ? Object.fromEntries(Object.entries(record).filter(([key]) => state.fields[key]))
          : { ...record }) }
      }
    }
  }
  const db = { command, collection: jest.fn((name) => {
    if (name !== "content_guides") throw new Error(`Unexpected collection: ${name}`)
    return query()
  }) }
  cloud.__setMockDb(db)
  return { main: require("../cloudfunctions/contentGuideList/index").main, requests, command }
}

function expectFailure(result, code = "INTERNAL_ERROR") {
  expect(result).toMatchObject({ ok: false, code })
  expect(result).not.toHaveProperty("list")
}

describe("content list scans all bounded candidates before selecting recommendations", () => {
  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW)
    jest.spyOn(console, "error").mockImplementation(() => {})
  })
  afterEach(() => jest.restoreAllMocks())

  test("the 101st document can be the only linked-vehicle recommendation", async () => {
    const records = rows(101)
    records[100].vehicleIds = ["car_target"]
    const { main } = setup(records)
    const result = await main({ vehicleId: "car_target", limit: 1 })
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual([textId(101)])
  })

  test("a newer 101st document outranks the first batch even when limit is one", async () => {
    const records = rows(101)
    records[100].publishedAt = new Date(NOW - 1000)
    const { main, requests } = setup(records)
    const result = await main({ limit: 1 })
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual([textId(101)])
    expect(requests.map(({ offset }) => offset)).toEqual([0, 100])
  })

  test("more than 100 scheduled future publications cannot hide content already due", async () => {
    const records = rows(151).map((record) => ({ ...record, publishedAt: NOW + 60000 }))
    records[150].publishedAt = new Date(NOW - 1000)
    const { main } = setup(records)
    const result = await main({ limit: 6 })
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual([textId(151)])
  })

  test("Date, number, string and toDate timestamps compete in one global top N across batches", async () => {
    const records = rows(220)
    records[2].publishedAt = new Date(NOW - 4000)
    records[103].publishedAt = NOW - 3000
    records[201].publishedAt = new Date(NOW - 2000).toISOString()
    const toDate = jest.fn(() => new Date(NOW - 1000))
    records[218].publishedAt = { toDate }
    const { main, requests } = setup(records)
    const result = await main({ limit: 4 })
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual([219, 202, 104, 3].map(textId))
    expect(toDate).toHaveBeenCalledTimes(1)
    expect(requests.map(({ offset }) => offset)).toEqual([0, 100, 200])
  })

  test("all recognized filters are applied before candidate pagination and the 2000-record budget", async () => {
    const records = rows(2400).map((record, index) => ({
      ...record,
      contentType: index % 3 === 0 ? "route" : "guide",
      scenario: index % 3 === 1 ? "weekend_trip" : "handover_tips",
      vehicleIds: index % 3 === 2 ? ["car_other"] : ["car_target"]
    }))
    const match = [guide(2401), guide(2402), guide(2403)].map((record) => ({ ...record, vehicleIds: ["car_target"] }))
    records.push(...match)
    const { main, requests, command } = setup(records)
    const result = await main({ contentType: "guide", scenario: "handover_tips", vehicleId: "car_target", limit: 2 })
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual([textId(2401), textId(2402)])
    expect(requests).toHaveLength(1)
    expect(requests[0].where).toMatchObject({ status: "published", contentType: "guide", scenario: "handover_tips" })
    expect(requests[0].ids).toHaveLength(3)
    expect(command.eq).toHaveBeenCalledWith("car_target")
    expect(command.elemMatch).toHaveBeenCalledWith({ operation: "eq", value: "car_target" })
  })

  test("equal timestamps have a stable ID order despite unordered storage and batch boundaries", async () => {
    const records = rows(205)
    records.forEach((record, index) => { record.publishedAt = index % 11 === 0 ? NOW - 1000 : OLD })
    const { main, requests } = setup(records.reverse())
    const result = await main({ limit: 20 })
    expect(result.ok).toBe(true)
    const newest = Array.from({ length: 19 }, (_, index) => textId(index * 11 + 1))
    expect(result.list.map(({ id }) => id)).toEqual([...newest, textId(2)])
    const fetchedIds = requests.flatMap(({ ids }) => ids)
    expect(fetchedIds).toHaveLength(205)
    expect(new Set(fetchedIds).size).toBe(205)
    expect(requests.every(({ order }) => order.key === "_id" && order.direction === "asc")).toBe(true)
  })

  test("finite numeric IDs and text IDs coexist across pages, including number 123 and text 123", async () => {
    const ids = [-1, 0, 1.5, ...Array.from({ length: 101 }, (_, index) => index + 2), 123, "123", "text_id"]
    const records = ids.map((id, index) => guide(index + 1, {
      _id: id, slug: `${typeof id}_${String(id).replace(".", "_")}`,
      publishedAt: id === "123" ? NOW - 1000 : id === 123 ? NOW - 2000 : OLD
    }))
    const { main, requests } = setup(records.reverse())
    const result = await main({ limit: 2 })
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual(["string_123", "number_123"])
    expect(requests.map(({ offset }) => offset)).toEqual([0, 100])
    expect(requests.flatMap(({ ids: fetched }) => fetched)).toEqual(expect.arrayContaining(["number:123", "string:123"]))
  })

  test.each([
    ["rejected query", new Error("second page unavailable")],
    ["missing response", undefined], ["missing data", {}],
    ["null data", { data: null }], ["object data", { data: {} }]
  ])("a %s on the second page cannot become a partial successful recommendation", async (label, response) => {
    const { main, requests } = setup(rows(101), { responses: { 2: response } })
    expectFailure(await main({ limit: 1 }))
    expect(requests).toHaveLength(2)
  })

  test("a repeated full page is rejected instead of duplicating content or looping", async () => {
    const records = rows(101)
    const { main, requests } = setup(records, { responses: { 2: { data: records.slice(0, 100) } } })
    expectFailure(await main({ limit: 20 }))
    expect(requests).toHaveLength(2)
  })

  test("duplicate document IDs within a page are rejected", async () => {
    const { main } = setup([], { responses: { 1: { data: [guide(1), guide(1, { slug: "different_slug" })] } } })
    expectFailure(await main({}))
  })

  test.each([undefined, null, NaN, Infinity, -Infinity, {}, [], true].map((id) => [id]))(
    "a record with invalid document ID %p cannot make an incomplete list look complete", async (id) => {
      const malformed = guide(1, { _id: id })
      if (id === undefined) delete malformed._id
      const { main } = setup([], { responses: { 1: { data: [malformed, guide(2)] } } })
      expectFailure(await main({}))
    }
  )

  test("non-object rows remain skippable without discarding a valid recommendation", async () => {
    const { main } = setup([], { responses: { 1: { data: [null, [], 123, guide(1)] } } })
    const result = await main({})
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual([textId(1)])
  })

  test("exactly 2000 candidates succeed only after an empty one-record probe", async () => {
    const records = rows(2000)
    records[1999].publishedAt = NOW - 1000
    const { main, requests } = setup(records)
    const result = await main({ limit: 1 })
    expect(result.ok).toBe(true)
    expect(result.list.map(({ id }) => id)).toEqual([textId(2000)])
    expect(requests).toHaveLength(21)
    expect(requests[20]).toMatchObject({ offset: 2000, limit: 1, ids: [] })
    expect(requests.slice(0, 20).every(({ limit }) => limit === 100)).toBe(true)
  })

  test("a 2001st candidate returns an explicit limit error even after finding enough recommendations", async () => {
    const { main, requests } = setup(rows(2001))
    expectFailure(await main({ limit: 1 }), "QUERY_LIMIT_EXCEEDED")
    expect(requests).toHaveLength(21)
    expect(requests[20]).toMatchObject({ offset: 2000, limit: 1 })
    expect(requests.flatMap(({ ids }) => ids)).toHaveLength(2001)
  })

  test("a future-dated 2001st candidate still means the scanned candidate set is incomplete", async () => {
    const records = rows(2001)
    records[2000].publishedAt = NOW + 60000
    const { main } = setup(records)
    expectFailure(await main({}), "QUERY_LIMIT_EXCEEDED")
  })

  test("a failed final probe cannot turn exactly 2000 candidates into success", async () => {
    const { main, requests } = setup(rows(2000), { responses: { 21: new Error("probe unavailable") } })
    expectFailure(await main({ limit: 1 }))
    expect(requests).toHaveLength(21)
  })
})
