jest.mock("wx-server-sdk")

function loadFunction(relativePath, { openid = "user", collections = {} } = {}) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb({
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection: ${name}`)
      return collections[name]
    }),
    serverDate: jest.fn(() => ({ __type: "serverDate" }))
  })
  let mod
  jest.isolateModules(() => { mod = require(relativePath) })
  return mod
}

function queryCollection(data) {
  const get = jest.fn().mockResolvedValue({ data })
  const chain = { where: jest.fn(() => chain), field: jest.fn(() => chain), limit: jest.fn(() => chain), get }
  return chain
}

describe("Phase 16 content guide cloud functions", () => {
  test("公开列表只返回当前已发布内容", async () => {
    const now = Date.now()
    const collection = queryCollection([
      { _id: "1", slug: "published", status: "published", publishedAt: new Date(now - 1000), scenario: "weekend_trip", vehicleIds: ["car_1"] },
      { _id: "2", slug: "draft", status: "draft", publishedAt: new Date(now - 2000), scenario: "weekend_trip", vehicleIds: ["car_1"] },
      { _id: "3", slug: "future", status: "published", publishedAt: new Date(now + 60000), scenario: "weekend_trip", vehicleIds: ["car_1"] }
    ])
    const mod = loadFunction("../cloudfunctions/contentGuideList/index", { collections: { content_guides: collection } })
    const res = await mod.main({ vehicleId: "car_1", limit: 10 })
    expect(res.ok).toBe(true)
    expect(res.list.map((item) => item.id)).toEqual(["published"])
    expect(collection.where).toHaveBeenCalledWith({ status: "published" })
  })

  test("草稿与归档内容不能通过公开详情读取", async () => {
    for (const status of ["draft", "archived"]) {
      const collection = queryCollection([{ _id: "1", slug: "guide_1", status, publishedAt: new Date() }])
      const mod = loadFunction("../cloudfunctions/contentGuideDetail/index", { collections: { content_guides: collection } })
      const res = await mod.main({ contentId: "guide_1" })
      expect(res.code).toBe("NOT_FOUND")
    }
  })

  test("非管理员不能维护内容", async () => {
    const roles = queryCollection([{ role: "user" }])
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", { openid: "normal_user", collections: { roles } })
    const res = await mod.main({ action: "create", guide: {} })
    expect(res.code).toBe("FORBIDDEN")
  })

  test("管理员创建内容时固定为草稿并写入审计", async () => {
    const roles = queryCollection([{ role: "admin" }])
    const guides = queryCollection([])
    guides.add = jest.fn().mockResolvedValue({ _id: "content_1" })
    const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_1" }) }
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: guides, audit_logs: audit }
    })
    const res = await mod.main({ action: "create", guide: {
      slug: "weekend-route",
      title: "周末路线",
      summary: "适合周末短途",
      body: "1. 出发准备\n提前检查车辆",
      contentType: "route",
      scenario: "weekend_trip",
      vehicleIds: ["car_1"],
      tags: ["周末"]
    } })
    expect(res).toMatchObject({ ok: true, id: "content_1", status: "draft" })
    expect(guides.add.mock.calls[0][0].data).toMatchObject({ slug: "weekend-route", status: "draft" })
    expect(audit.add).toHaveBeenCalled()
  })
})
