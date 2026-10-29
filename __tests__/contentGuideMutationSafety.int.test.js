jest.mock("wx-server-sdk")

function validGuide(overrides = {}) {
  return {
    slug: "weekend-guide", title: "周末用车", summary: "出行准备", body: "核对档期与报价",
    contentType: "guide", scenario: "weekend_trip", vehicleIds: [], ...overrides
  }
}

function setup({ admin = true, updateResult = { stats: { updated: 1 } } } = {}) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: "operator" })
  const roles = { get: jest.fn().mockResolvedValue({ data: admin ? [{ role: "admin" }] : [] }) }
  for (const method of ["where", "field", "limit"]) roles[method] = jest.fn(() => roles)
  const update = jest.fn().mockResolvedValue(updateResult)
  const guides = {
    get: jest.fn().mockResolvedValue({ data: [] }),
    add: jest.fn().mockResolvedValue({ _id: "new_content" }),
    doc: jest.fn(() => ({ update }))
  }
  for (const method of ["where", "field", "limit"]) guides[method] = jest.fn(() => guides)
  const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_1" }) }
  cloud.__setMockDb({
    collection: jest.fn((name) => ({ roles, content_guides: guides, audit_logs: audit })[name]),
    serverDate: jest.fn(() => ({ __type: "serverDate" }))
  })
  const main = require("../cloudfunctions/contentGuideManage/index").main
  return { main, roles, guides, update, audit }
}

describe("content guide mutation boundaries", () => {
  beforeEach(() => jest.spyOn(console, "error").mockImplementation(() => {}))
  afterEach(() => jest.restoreAllMocks())

  test.each(["update", "publish", "archive"])("%s rejects an overlong ID before looking up its valid prefix", async (action) => {
    const { main, guides, update, audit } = setup()
    const result = await main({ action, id: "a".repeat(64) + "b", guide: validGuide() })
    expect(result).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(guides.doc).not.toHaveBeenCalled()
    expect(update).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test.each([123, ["content_1"], { id: "content_1" }])("non-text ID %p cannot select another record", async (id) => {
    const { main, guides, audit } = setup()
    expect(await main({ action: "archive", id })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(guides.doc).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test.each([undefined, null, [], "guide", true])("missing or malformed guide %p is a validation failure", async (guide) => {
    const { main, guides, audit } = setup()
    for (const action of ["create", "update"]) {
      expect(await main({ action, id: "content_1", guide })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    }
    expect(guides.add).not.toHaveBeenCalled()
    expect(guides.doc).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
    expect(console.error).not.toHaveBeenCalled()
  })

  test.each(["a".repeat(65), ["valid-slug"], 123])("invalid slug %p is rejected without truncation or coercion", async (slug) => {
    const { main, guides, audit } = setup()
    for (const action of ["create", "update"]) {
      expect(await main({ action, id: "content_1", guide: validGuide({ slug }) })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    }
    expect(guides.where).not.toHaveBeenCalled()
    expect(guides.add).not.toHaveBeenCalled()
    expect(guides.doc).not.toHaveBeenCalled()
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

  test.each(["update", "publish", "archive"])("%s reports a missing target instead of a successful mutation", async (action) => {
    const { main, update, audit } = setup({ updateResult: { stats: { updated: 0 } } })
    const result = await main({ action, id: "missing_content", guide: validGuide() })
    expect(update).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ ok: false, code: "NOT_FOUND" })
    expect(audit.add).not.toHaveBeenCalled()
  })

  test.each([null, {}, { stats: {} }, { stats: { updated: "1" } }, { stats: { updated: 2 } }])("an unconfirmed database result %p cannot produce a success audit", async (updateResult) => {
    const { main, audit } = setup({ updateResult })
    expect(await main({ action: "publish", id: "content_1" })).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(audit.add).not.toHaveBeenCalled()
  })

  test("a non-text action cannot be coerced into a valid mutation", async () => {
    const { main, guides, audit } = setup()
    expect(await main({ action: ["archive"], id: "content_1" })).toMatchObject({ ok: false, code: "VALIDATION_ERROR" })
    expect(guides.doc).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test.each(["update", "publish", "archive"])("%s still accepts a full 64-character ID and records one successful audit", async (action) => {
    const { main, guides, update, audit } = setup()
    const id = "a".repeat(64)
    expect(await main({ action, id: ` ${id} `, guide: validGuide() })).toMatchObject({ ok: true, id })
    expect(guides.doc).toHaveBeenCalledWith(id)
    expect(update).toHaveBeenCalledTimes(1)
    expect(audit.add).toHaveBeenCalledTimes(1)
    expect(audit.add.mock.calls[0][0].data).toMatchObject({ action: `contentGuide.${action}`, contentId: id })
  })

  test("authorization precedes malformed input diagnostics and all content access", async () => {
    const { main, guides, audit } = setup({ admin: false })
    for (const action of ["create", "update", "publish", "archive"]) {
      expect(await main({ action, id: "a".repeat(65), guide: null })).toMatchObject({ ok: false, code: "FORBIDDEN" })
    }
    expect(guides.where).not.toHaveBeenCalled()
    expect(guides.doc).not.toHaveBeenCalled()
    expect(guides.add).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test("authorization lookup failure records bounded diagnostics without unvalidated identifiers", async () => {
    const { main, roles, guides, audit } = setup()
    roles.get.mockRejectedValue(new Error("roles unavailable"))
    const result = await main({ action: "a".repeat(5000), id: "b".repeat(5000) })
    expect(result).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
    expect(console.error).toHaveBeenCalledTimes(1)
    expect(console.error).toHaveBeenCalledWith({
      function: "contentGuideManage", action: "", id: "", authenticated: true, errorMessage: "roles unavailable"
    })
    expect(guides.doc).not.toHaveBeenCalled()
    expect(guides.add).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })
})
