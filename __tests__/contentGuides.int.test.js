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

function queryCollection(options = {}) {
  const docsMap = options.docs || {}
  const get = jest.fn().mockResolvedValue({ data: options.data || [] })
  const add = jest.fn().mockResolvedValue({ _id: options.addId || ("gen_" + Math.random().toString(36).slice(2, 10)) })
  const chain = {}
  chain.where = jest.fn(() => chain)
  chain.field = jest.fn(() => chain)
  chain.limit = jest.fn(() => chain)
  chain.orderBy = jest.fn(() => chain)
  chain.skip = jest.fn(() => chain)
  chain.get = get
  chain.add = add
  chain.doc = jest.fn((id) => ({
    update: jest.fn().mockImplementation((payload) => {
      docsMap[id] = { ...(docsMap[id] || {}), _id: id, ...(payload && payload.data ? payload.data : payload) }
      return Promise.resolve({ stats: { updated: 1 } })
    }),
    get: jest.fn().mockResolvedValue({ data: docsMap[id] || null }),
    field: jest.fn(() => ({
      get: jest.fn().mockResolvedValue({ data: docsMap[id] || null })
    }))
  }))
  return chain
}

describe("Phase 16 content guide cloud functions", () => {
  test("公开列表只返回当前已发布内容", async () => {
    const now = Date.now()
    const collection = queryCollection({ data: [
      { _id: "1", slug: "published", status: "published", publishedAt: new Date(now - 1000), scenario: "weekend_trip", vehicleIds: ["car_1"] },
      { _id: "2", slug: "draft", status: "draft", publishedAt: new Date(now - 2000), scenario: "weekend_trip", vehicleIds: ["car_1"] },
      { _id: "3", slug: "future", status: "published", publishedAt: new Date(now + 60000), scenario: "weekend_trip", vehicleIds: ["car_1"] }
    ]})
    const mod = loadFunction("../cloudfunctions/contentGuideList/index", { collections: { content_guides: collection } })
    const res = await mod.main({ vehicleId: "car_1", limit: 10 })
    expect(res.ok).toBe(true)
    expect(res.list.map((item) => item.id)).toEqual(["published"])
    expect(collection.where).toHaveBeenCalledWith({ status: "published" })
  })

  test("草稿与归档内容不能通过公开详情读取", async () => {
    for (const status of ["draft", "archived"]) {
      const collection = queryCollection({ data: [{ _id: "1", slug: "guide_1", status, publishedAt: new Date() }] })
      const mod = loadFunction("../cloudfunctions/contentGuideDetail/index", { collections: { content_guides: collection } })
      const res = await mod.main({ contentId: "guide_1" })
      expect(res.code).toBe("NOT_FOUND")
    }
  })

  test("非管理员不能维护内容", async () => {
    const roles = queryCollection({ data: [{ role: "user" }] })
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", { openid: "normal_user", collections: { roles } })
    const res = await mod.main({ action: "create", guide: {} })
    expect(res.code).toBe("FORBIDDEN")
  })

  test("管理员创建内容时固定为草稿并写入审计", async () => {
    const roles = queryCollection({ data: [{ role: "admin" }] })
    const guides = queryCollection()
    guides.add.mockResolvedValue({ _id: "content_1" })
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

  test("白名单支持新增的 contentType=guide 与 scenario=handover_tips", async () => {
    const roles = queryCollection({ data: [{ role: "admin" }] })
    const guides = queryCollection()
    guides.add.mockResolvedValue({ _id: "content_2" })
    const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_2" }) }
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: guides, audit_logs: audit }
    })
    const res = await mod.main({ action: "create", guide: {
      slug: "handover-tips-2026",
      title: "取还车避坑指南",
      summary: "四角照片、里程与油量的正确核对方式",
      body: "1. 四角照片标准拍法\n正前/正后/左前45度/右后45度",
      contentType: "guide",
      scenario: "handover_tips",
      vehicleIds: [],
      tags: ["交接", "新手必看"]
    } })
    expect(res).toMatchObject({ ok: true, id: "content_2", status: "draft" })
    expect(guides.add.mock.calls[0][0].data).toMatchObject({ contentType: "guide", scenario: "handover_tips" })
  })

  test("非法 contentType 或 scenario 仍被拒绝，字段清单明确返回", async () => {
    const roles = queryCollection({ data: [{ role: "admin" }] })
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: queryCollection() }
    })
    const res = await mod.main({ action: "create", guide: {
      slug: "bad-case-1",
      title: "错误分类",
      summary: "用来触发校验失败",
      body: "任意正文内容",
      contentType: "scenario",
      scenario: "family",
      vehicleIds: [],
      tags: []
    } })
    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(res.details.fields).toContain("contentType(scenario)")
    expect(res.details.fields).toContain("scenario(family)")
  })

  test("update 修改正文和标签时按 ID 更新并写入审计，同 ID slug 不算重复", async () => {
    const roles = queryCollection({ data: [{ role: "admin" }] })
    const docs = { content_10: { _id: "content_10", slug: "old-slug" } }
    const guides = queryCollection({ docs })
    guides.get.mockImplementation(() => Promise.resolve({ data: [{ _id: "content_10", slug: "old-slug" }] }))
    const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_10" }) }
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: guides, audit_logs: audit }
    })
    const res = await mod.main({
      action: "update",
      id: "content_10",
      guide: {
        slug: "old-slug",
        title: "新能源试驾全流程 2026 修订",
        summary: "修改摘要",
        body: "修订后的正文，补充充电建议",
        contentType: "vehicle_tip",
        scenario: "ev_experience",
        vehicleIds: ["car_ev_1", "car_ev_2"],
        tags: ["充电", "高速", "试驾"]
      }
    })
    expect(res).toMatchObject({ ok: true, id: "content_10" })
    expect(res.status).toBeUndefined()
    const updated = docs["content_10"]
    expect(updated.title).toBe("新能源试驾全流程 2026 修订")
    expect(updated.contentType).toBe("vehicle_tip")
    expect(updated.scenario).toBe("ev_experience")
    expect(updated.tags).toEqual(["充电", "高速", "试驾"])
    expect(updated).toHaveProperty("updatedAt")
    expect(audit.add).toHaveBeenCalledTimes(1)
    expect(audit.add.mock.calls[0][0].data.action).toBe("contentGuide.update")
    expect(audit.add.mock.calls[0][0].data.contentId).toBe("content_10")
  })

  test("重复 slug 在不同 ID 创建时返回 DUPLICATE_SLUG", async () => {
    const roles = queryCollection({ data: [{ role: "admin" }] })
    const guides = queryCollection({ docs: { old: { _id: "old", slug: "shared-slug" } } })
    guides.get.mockImplementationOnce(() => Promise.resolve({ data: [{ _id: "old", slug: "shared-slug" }] }))
      .mockImplementationOnce(() => Promise.resolve({ data: [{ _id: "old", slug: "shared-slug" }] }))
    const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_dup" }) }
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: guides, audit_logs: audit }
    })
    const createRes = await mod.main({ action: "create", guide: {
      slug: "shared-slug",
      title: "重名尝试",
      summary: "摘要",
      body: "正文",
      contentType: "guide",
      scenario: "weekend_trip",
      vehicleIds: [],
      tags: []
    } })
    expect(createRes.code).toBe("DUPLICATE_SLUG")
    expect(guides.add).not.toHaveBeenCalled()
    expect(audit.add).not.toHaveBeenCalled()
  })

  test("publish 把草稿改为 published 并写入 publishedAt 与审计", async () => {
    const roles = queryCollection({ data: [{ role: "admin" }] })
    const docs = { content_20: { _id: "content_20", slug: "c20", status: "draft" } }
    const guides = queryCollection({ docs })
    const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_20" }) }
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: guides, audit_logs: audit }
    })
    const res = await mod.main({ action: "publish", id: "content_20" })
    expect(res).toMatchObject({ ok: true, id: "content_20", status: "published" })
    const updated = docs["content_20"]
    expect(updated.status).toBe("published")
    expect(updated).toHaveProperty("publishedAt")
    expect(updated).toHaveProperty("updatedAt")
    expect(audit.add).toHaveBeenCalledTimes(1)
    expect(audit.add.mock.calls[0][0].data.action).toBe("contentGuide.publish")
  })

  test("archive 把已发布内容归档，审计写 contentGuide.archive", async () => {
    const roles = queryCollection({ data: [{ role: "admin" }] })
    const docs = { content_30: { _id: "content_30", slug: "c30", status: "published" } }
    const guides = queryCollection({ docs })
    const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_30" }) }
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: guides, audit_logs: audit }
    })
    const res = await mod.main({ action: "archive", id: "content_30" })
    expect(res).toMatchObject({ ok: true, id: "content_30", status: "archived" })
    const updated = docs["content_30"]
    expect(updated.status).toBe("archived")
    expect(updated).not.toHaveProperty("publishedAt")
    expect(updated).toHaveProperty("updatedAt")
    expect(audit.add).toHaveBeenCalledTimes(1)
    expect(audit.add.mock.calls[0][0].data.action).toBe("contentGuide.archive")
  })

  test("publish/archive/update 非法 ID 格式时返回 VALIDATION_ERROR", async () => {
    const roles = queryCollection({ data: [{ role: "admin" }] })
    const docs = {}
    const guides = queryCollection({ docs })
    const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_x" }) }
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: guides, audit_logs: audit }
    })
    for (const action of ["publish", "archive", "update"]) {
      const payload = action === "update" ? { action, id: "含有空格 错误", guide: {
        slug: "ok",
        title: "OK",
        summary: "OK",
        body: "OK",
        contentType: "guide",
        scenario: "weekend_trip",
        vehicleIds: [],
        tags: []
      } } : { action, id: "含有空格 错误" }
      const res = await mod.main(payload)
      expect(res.code).toBe("VALIDATION_ERROR")
    }
    expect(audit.add).not.toHaveBeenCalled()
  })

  test("未知 action 也被拒绝，不触发审计和 doc 更新", async () => {
    const roles = queryCollection({ data: [{ role: "admin" }] })
    const docs = { content_99: { _id: "content_99", slug: "ok-cg", status: "draft" } }
    const guides = queryCollection({ docs })
    const audit = { add: jest.fn().mockResolvedValue({ _id: "audit_99" }) }
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: guides, audit_logs: audit }
    })
    const res = await mod.main({ action: "destroy", id: "content_99" })
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(docs["content_99"].status).toBe("draft")
    expect(audit.add).not.toHaveBeenCalled()
  })
})
