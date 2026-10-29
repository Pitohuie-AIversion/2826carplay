jest.mock("wx-server-sdk")

function validGuide(overrides = {}) {
  return {
    slug: "weekend-guide", title: "周末用车", summary: "出行准备", body: "核对档期与报价",
    contentType: "guide", scenario: "weekend_trip", vehicleIds: [], ...overrides
  }
}

function setup({ admin = true, updateResult = { stats: { updated: 1 } }, documents = {} } = {}) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "operator" })
  const roles = { get: jest.fn().mockResolvedValue({ data: admin ? [{ role: "admin" }] : [] }) }
  for (const method of ["where", "field", "limit"]) roles[method] = jest.fn(() => roles)
  const update = jest.fn(async (source, id, { data }) => {
    if (!source[id]) return { stats: { updated: 0 } }
    if (updateResult && updateResult.stats && updateResult.stats.updated === 1) {
      source[id] = { ...source[id], ...data }
    }
    return updateResult
  })
  const documentGet = jest.fn(async (source, id) => ({ data: source[id] || null }))
  const document = (source, id) => {
    const ref = {
      get: () => documentGet(source, id),
      update: (payload) => update(source, id, payload)
    }
    ref.field = jest.fn(() => ref)
    return ref
  }
  const transactionDoc = jest.fn()
  const guides = {
    get: jest.fn().mockResolvedValue({ data: [] }),
    add: jest.fn().mockResolvedValue({ _id: "new_content" }),
    doc: jest.fn((id) => document(documents, id))
  }
  for (const method of ["where", "field", "limit"]) guides[method] = jest.fn(() => guides)
  const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_1" }) }
  cloud.__setMockDb({
    collection: jest.fn((name) => ({ roles, content_guides: guides, audit_logs: audit })[name]),
    serverDate: jest.fn(() => ({ __type: "serverDate" })),
    runTransaction: jest.fn(async (callback) => {
      const staged = { ...documents }
      const result = await callback({ collection: (name) => {
        if (name !== "content_guides") throw new Error(`Unexpected transaction collection: ${name}`)
        return { doc: (id) => {
          transactionDoc(id)
          return document(staged, id)
        } }
      } })
      Object.assign(documents, staged)
      return result
    })
  })
  const main = require("../cloudfunctions/contentGuideManage/index").main
  expect(cloud.database).toHaveBeenCalledWith({ throwOnNotFound: false })
  return { main, roles, guides, update, audit, documentGet, transactionDoc }
}

describe("content guide mutation boundaries", () => {
  beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  test.each(["update", "publish", "archive"])("%s rejects an overlong ID before looking up its valid prefix", async (action) => {
    const { main, guides, update, audit, transactionDoc } = setup()
    const result = await main({ action, id: "a".repeat(64) + "b", guide: validGuide() })
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(guides.doc).not.toHaveBeenCalled()
    expect(transactionDoc).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test.each([123, ["content_1"], { id: "content_1" }])("non-text ID %p cannot select another record", async (id) => {
    const { main, guides, audit, transactionDoc } = setup()
    expect(await main({ action: "archive", id })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(guides.doc).not.toHaveBeenCalled()
    expect(transactionDoc).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test.each([undefined, null, [], "guide", true])("missing or malformed guide %p is a validation failure", async (guide) => {
    const { main, guides, audit, transactionDoc } = setup()
    for (const action of ["create", "update"]) {
      expect(await main({ action, id: "content_1", guide })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    }
    expect(guides.add).not.toHaveBeenCalled()
    expect(guides.doc).not.toHaveBeenCalled()
    expect(transactionDoc).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  test.each(["a".repeat(65), ["valid-slug"], 123])("invalid slug %p is rejected without truncation or coercion", async (slug) => {
    const { main, guides, audit, transactionDoc } = setup()
    for (const action of ["create", "update"]) {
      expect(await main({ action, id: "content_1", guide: validGuide({ slug }) })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    }
    expect(guides.where).not.toHaveBeenCalled()
    expect(guides.add).not.toHaveBeenCalled()
    expect(guides.doc).not.toHaveBeenCalled()
    expect(transactionDoc).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test("vehicle references retain only complete valid text IDs", async () => {
    const { main, guides } = setup()
    const boundary = "v".repeat(64)
    const result = await main({ action: "create", guide: validGuide({
      slug: "s".repeat(64),
      vehicleIds: [boundary + "x", ["array_car"], 123, "../invalid", " car_1 ", "car_1", boundary]
    }) })
    expect(result).toMatchObject({ ok: true, id: "new_content", status: "draft" })
    expect(guides.add.mock.calls[0][0].data).toMatchObject({ slug: "s".repeat(64), vehicleIds: ["car_1", boundary] })
  })

  test.each(["update", "publish", "archive"])("%s reports zero affected documents instead of a successful mutation", async (action) => {
    const { main, update, audit } = setup({
      documents: { content_1: { _id: "content_1", status: "draft" } },
      updateResult: { stats: { updated: 0 } }
    })
    const result = await main({ action, id: "content_1", guide: validGuide() })
    expect(update).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(audit.add).not.toHaveBeenCalled()
  })

  test.each([null, {}, { stats: {} }, { stats: { updated: "1" } }, { stats: { updated: 2 } }])("an unconfirmed database result %p cannot produce a success audit", async (updateResult) => {
    const { main, update, audit } = setup({
      documents: { content_1: { _id: "content_1", status: "draft" } }, updateResult
    })
    expect(await main({ action: "publish", id: "content_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(update).toHaveBeenCalledTimes(1)
    expect(audit.add).not.toHaveBeenCalled()
  })

  test("a non-text action cannot be coerced into a valid mutation", async () => {
    const { main, guides, audit, transactionDoc } = setup()
    expect(await main({ action: ["archive"], id: "content_1" })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(guides.doc).not.toHaveBeenCalled()
    expect(transactionDoc).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test.each(["update", "publish", "archive"])("%s still accepts a full 64-character ID and records one successful audit", async (action) => {
    const id = "a".repeat(64)
    const { main, guides, update, audit, transactionDoc } = setup({ documents: { [id]: { _id: id, status: "draft" } } })
    expect(await main({ action, id: ` ${id} `, guide: validGuide() })).toMatchObject({ ok: true, id })
    expect(action === "update" ? guides.doc : transactionDoc).toHaveBeenCalledWith(id)
    expect(update).toHaveBeenCalledTimes(1)
    expect(audit.add).toHaveBeenCalledTimes(1)
    expect(audit.add.mock.calls[0][0].data).toMatchObject({ action: `contentGuide.${action}`, contentId: id })
  })

  test("authorization precedes malformed input diagnostics and all content access", async () => {
    const { main, guides, audit, transactionDoc } = setup({ admin: false })
    for (const action of ["create", "update", "publish", "archive"]) {
      expect(await main({ action, id: "a".repeat(65), guide: null })).toMatchObject({ ok: false, code: "FORBIDDEN" })
    }
    expect(guides.where).not.toHaveBeenCalled()
    expect(guides.doc).not.toHaveBeenCalled()
    expect(transactionDoc).not.toHaveBeenCalled()
    expect(guides.add).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test("authorization lookup failure records bounded diagnostics without unvalidated identifiers", async () => {
    const { main, roles, guides, audit, transactionDoc } = setup()
    roles.get.mockRejectedValue(new Error("roles unavailable"))
    const result = await main({ action: "a".repeat(5000), id: "b".repeat(5000) })
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith({
      function: "contentGuideManage", action: "", id: "", authenticated: true, errorMessage: "roles unavailable"
    })
    expect(guides.doc).not.toHaveBeenCalled()
    expect(transactionDoc).not.toHaveBeenCalled()
    expect(guides.add).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })
})
