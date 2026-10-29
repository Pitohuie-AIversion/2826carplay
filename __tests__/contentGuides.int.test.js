jest.mock("wx-server-sdk")

const command = {
  eq: (value) => ({ operator: "eq", value }),
  elemMatch: (condition) => ({ operator: "elemMatch", condition })
}

function matchesContentQuery(row, filter) {
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

function loadFunction(relativePath, { openid = "user", collections = {} } = {}) {
  jest.resetModules()
  const cloud = require("wx-server-sdk")
  cloud.__reset()
  cloud.__setMockContext({ OPENID: openid })
  cloud.__setMockDb({
    command,
    collection: jest.fn((name) => {
      if (!collections[name]) throw new Error(`Unexpected collection: ${name}`)
      return collections[name]
    }),
    serverDate: jest.fn(() => ({ __type: "serverDate" })),
    runTransaction: jest.fn(async (callback) => {
      const staged = collections.content_guides.beginTransaction()
      const result = await callback({ collection: (name) => {
        if (name !== "content_guides") throw new Error(`Unexpected transaction collection: ${name}`)
        return staged.collection
      } })
      staged.commit()
      return result
    })
  })
  let mod
  jest.isolateModules(() => { mod = require(relativePath) })
  if (relativePath.includes("contentGuideManage")) {
    expect(cloud.database).toHaveBeenCalledWith({ throwOnNotFound: false })
  }
  return mod
}

function queryCollection(options = {}) {
  const docsMap = options.docs || {}
  let filter = {}, ordering = null, offset = 0, count = Infinity
  const get = jest.fn(async () => {
    if ("queryResponse" in options) return options.queryResponse
    // Role fixtures supply permission results directly; content queries model database selection.
    const contentQuery = Object.keys(filter).some((key) => ["status", "scenario", "contentType", "vehicleIds", "slug"].includes(key))
    const rows = (options.data || []).filter((row) => !contentQuery || matchesContentQuery(row, filter))
    if (ordering) rows.sort((left, right) => compareIds(left && left[ordering.field], right && right[ordering.field]) * (ordering.direction === "desc" ? -1 : 1))
    return { data: rows.slice(offset, offset + count) }
  })
  const add = jest.fn().mockResolvedValue({ _id: options.addId || ("gen_" + Math.random().toString(36).slice(2, 10)) })
  const chain = {}
  chain.where = jest.fn((value) => { filter = value; return chain })
  chain.field = jest.fn(() => chain)
  chain.limit = jest.fn((value) => { count = value; return chain })
  chain.orderBy = jest.fn((field, direction) => { ordering = { field, direction }; return chain })
  chain.skip = jest.fn((value) => { offset = value; return chain })
  chain.get = get
  chain.add = add
  const document = (source, id) => ({
    update: jest.fn().mockImplementation((payload) => {
      if (!source[id]) return Promise.resolve({ stats: { updated: 0 } })
      source[id] = { ...source[id], _id: id, ...(payload && payload.data ? payload.data : payload) }
      return Promise.resolve({ stats: { updated: 1 } })
    }),
    get: jest.fn(async () => ({ data: source[id] || null })),
    field: jest.fn(() => ({
      get: jest.fn(async () => ({ data: source[id] || null }))
    }))
  })
  chain.doc = jest.fn((id) => document(docsMap, id))
  chain.beginTransaction = () => {
    const staged = { ...docsMap }
    return {
      collection: { doc: jest.fn((id) => document(staged, id)) },
      commit: () => Object.assign(docsMap, staged)
    }
  }
  return chain
}

describe("Phase 16 content guide cloud functions", () => {
  test("关联车辆封面缺失时沿用管理员保存的相册首图", async () => {
    const guides = queryCollection({ data: [{ slug: "guide-images", status: "published", publishedAt: new Date(Date.now() - 1000), vehicleIds: ["car"] }] })
    const vehicles = queryCollection({ docs: { car: { brandModel: "车辆", imageList: ["", "cloud://saved-image"], status: "idle" } } })
    const mod = loadFunction("../cloudfunctions/contentGuideDetail/index", { collections: { content_guides: guides, vehicles } })
    const result = await mod.main({ contentId: "guide-images" })
    expect(result.vehicles).toEqual([expect.objectContaining({ id: "car", cover: "cloud://saved-image" })])
  })

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
    expect(collection.where).toHaveBeenCalledWith({ status: "published", vehicleIds: command.elemMatch(command.eq("car_1")) })
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
    const publishedAt = new Date("2026-10-01T00:00:00Z")
    const docs = { content_30: { _id: "content_30", slug: "c30", status: "published", publishedAt } }
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
    expect(updated.publishedAt).toEqual(publishedAt)
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

  test("管理员权限查询失败时返回内部错误且不写入内容或成功审计", async () => {
    const roles = queryCollection()
    roles.get.mockRejectedValue(new Error("Simulated database failure"))
    const guides = queryCollection()
    const audit = { add: jest.fn() }
    const mod = loadFunction("../cloudfunctions/contentGuideManage/index", {
      openid: "admin",
      collections: { roles, content_guides: guides, audit_logs: audit }
    })
    const errorLog = jest.spyOn(console, "error").mockImplementation(() => {})
    try {
      const res = await mod.main({ action: "create", guide: {
        slug: "valid-guide", title: "标题", summary: "摘要", body: "正文",
        contentType: "guide", scenario: "weekend_trip"
      } })
      expect(roles.get).toHaveBeenCalledTimes(1)
      expect(res).toMatchObject({ ok: false, code: "INTERNAL_ERROR" })
      expect(errorLog).toHaveBeenCalledWith(expect.objectContaining({ function: "contentGuideManage", action: "create" }))
      expect(guides.add).not.toHaveBeenCalled()
      expect(guides.doc).not.toHaveBeenCalled()
      expect(audit.add).not.toHaveBeenCalled()
    } finally {
      errorLog.mockRestore()
    }
  })

})
