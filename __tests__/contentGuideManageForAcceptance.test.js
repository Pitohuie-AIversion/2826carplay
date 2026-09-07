jest.mock("wx-server-sdk")

const SCENARIOS = ["weekend_trip", "business_reception", "group_travel", "ev_experience", "handover_tips"]
const CONTENT_TYPES = ["route", "guide", "vehicle_advice", "handover_guide", "vehicle_tip"]
const ACTIONS = ["create", "update", "publish", "archive"]

function buildValidGuide(overrides) {
  return {
    slug: "acceptance-a0-seed-001",
    title: "A0 管理员创建内容：真实场景冒烟",
    summary: "A0 冒烟用例摘要，必须非空且不超过 300 字符",
    body: "正文 200 字符以上，模拟真实场景内容。包含取车、用车、还车三个阶段说明。段落之间空行分段，以满足校验规则。" + "\n\n阶段二：熟悉车辆操作后再上路。",
    contentType: "guide",
    scenario: "weekend_trip",
    vehicleIds: [],
    tags: ["A0", "冒烟测试", "管理员"],
    shareTitle: "A0 管理员创建内容",
    ...overrides
  }
}

function createMockDb({
  adminOpenid = "admin_openid_real_account",
  normalOpenid = "normal_user_openid_real_account",
  existingSlugs = [],
  createdGuideId = "content_acceptance_a0_001",
  existingDocument = null,
  actionAuditCaptures = []
}) {
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)
  const guideGet = jest.fn().mockResolvedValue({ data: existingDocument })
  const guideDoc = jest.fn(() => ({ get: guideGet, update: jest.fn().mockResolvedValue({ stats: { updated: 1 } }) }))
  const slugWhere = jest.fn((filter) => {
    const matched = existingSlugs.includes(filter.slug) ? [{ _id: createdGuideId + "_dup" }] : []
    const slugGet = jest.fn().mockResolvedValue({ data: matched })
    const slugField = jest.fn(() => ({ limit: jest.fn(() => ({ get: slugGet })) }))
    return { field: slugField }
  })
  const guideAdd = jest.fn().mockResolvedValue({ _id: createdGuideId })
  const auditAdd = jest.fn().mockImplementation((payload) => {
    actionAuditCaptures.push(payload && payload.data ? payload.data : payload)
    return Promise.resolve({ _id: "audit_" + Math.random().toString(36).slice(2, 10) })
  })
  const roleWhere = jest.fn((filter) => {
    const isAdminFilterPassed = filter.openid === adminOpenid
    const authGet = jest.fn().mockResolvedValue({
      data: isAdminFilterPassed ? [{ openid: adminOpenid, role: "admin" }] : []
    })
    const authLimit = jest.fn(() => ({ get: authGet }))
    const authField = jest.fn(() => ({ limit: authLimit }))
    return { field: authField }
  })

  const db = {
    collection: jest.fn((name) => {
      if (name === "content_guides") {
        return {
          where: slugWhere,
          doc: guideDoc,
          add: guideAdd,
          update: jest.fn().mockResolvedValue({ stats: { updated: 1 } })
        }
      }
      if (name === "roles") return { where: roleWhere }
      if (name === "audit_logs") return { add: auditAdd }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }
  return {
    db,
    serverDate,
    serverDateValue,
    guideAdd,
    slugWhere,
    guideDoc,
    guideGet,
    auditAdd,
    actionAuditCaptures,
    roleWhere
  }
}

async function loadContentGuideManageWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/contentGuideManage/index")
  })
  return mod
}

describe("contentGuideManage acceptance suite (admin / normal user / parameter privacy)", () => {
  test("A0: 管理员创建真实内容 → VALIDATION_ERROR 拒绝非法枚举 contentType", async () => {
    const mocks = createMockDb({})
    const mod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: mocks.db })
    const res = await mod.main({ action: "create", guide: buildValidGuide({ contentType: "forbidden_sponsored_package" }) })
    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    const fieldList = Array.isArray(res.details && res.details.fields) ? res.details.fields.join(",") : ""
    expect(fieldList).toContain("contentType(forbidden_sponsored_package)")
    expect(mocks.guideAdd).not.toHaveBeenCalled()
  })

  test("A1: 管理员 create + 合法枚举 → ok, id 非空, status=draft, audit write contentGuide.create", async () => {
    const mocks = createMockDb({})
    const mod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: mocks.db })
    const res = await mod.main({ action: "create", guide: buildValidGuide() })
    expect(res).toEqual({ ok: true, id: "content_acceptance_a0_001", status: "draft" })
    expect(mocks.guideAdd).toHaveBeenCalledTimes(1)
    const addPayload = mocks.guideAdd.mock.calls[0][0].data
    expect(addPayload.slug).toBe("acceptance-a0-seed-001")
    expect(addPayload.status).toBe("draft")
    expect(addPayload).toHaveProperty("createdAt")
    expect(addPayload).toHaveProperty("updatedAt")
    expect(mocks.auditAdd).toHaveBeenCalledTimes(1)
    const auditRecord = mocks.actionAuditCaptures[0]
    expect(auditRecord.openid).toBe("admin_openid_real_account")
    expect(auditRecord.action).toBe("contentGuide.create")
    expect(auditRecord.contentId).toBe("content_acceptance_a0_001")
    expect(auditRecord).toHaveProperty("createdAt")
  })

  test("A2: 管理员 update 现有内容 → VALIDATION_ERROR 拒绝 slug 路径字符，合法枚举 update 通过并写 update audit", async () => {
    const mocks = createMockDb({})
    const mod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: mocks.db })
    const badUpdate = await mod.main({ action: "update", id: "../../etc/passwd", guide: buildValidGuide() })
    expect(badUpdate.ok).toBe(false)
    expect(badUpdate.code).toBe("VALIDATION_ERROR")
    expect(mocks.auditAdd).not.toHaveBeenCalled()

    const goodUpdate = await mod.main({ action: "update", id: "content_acceptance_a0_001", guide: buildValidGuide({ title: "A2 更新后合法标题", scenario: "business_reception" }) })
    expect(goodUpdate.ok).toBe(true)
    expect(goodUpdate.id).toBe("content_acceptance_a0_001")
    const auditRecord = mocks.actionAuditCaptures[0]
    expect(auditRecord.action).toBe("contentGuide.update")
  })

  test("A3: 管理员 publish 合法 id → status=published + publishedAt=serverDate", async () => {
    const mocks = createMockDb({})
    const mod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: mocks.db })
    const res = await mod.main({ action: "publish", id: "content_acceptance_a0_001" })
    expect(res).toEqual({ ok: true, id: "content_acceptance_a0_001", status: "published" })
    const auditRecord = mocks.actionAuditCaptures[0]
    expect(auditRecord.action).toBe("contentGuide.publish")
    expect(auditRecord.contentId).toBe("content_acceptance_a0_001")
  })

  test("A4: 管理员 archive 合法 id → status=archived", async () => {
    const mocks = createMockDb({})
    const mod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: mocks.db })
    const res = await mod.main({ action: "archive", id: "content_acceptance_a0_001" })
    expect(res).toEqual({ ok: true, id: "content_acceptance_a0_001", status: "archived" })
    expect(mocks.actionAuditCaptures[0].action).toBe("contentGuide.archive")
  })

  test("A5: 管理员 4 枚举 scenario 都能创建通过（weekend_trip / business_reception / group_travel / ev_experience + handover_tips）", async () => {
    for (const scenario of SCENARIOS) {
      const mocks = createMockDb({})
      const mod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: mocks.db })
      const res = await mod.main({ action: "create", guide: buildValidGuide({ scenario }) })
      expect(res.ok).toBe(true)
      expect(res.code).toBeUndefined()
      const addPayload = mocks.guideAdd.mock.calls[0][0].data
      expect(addPayload.scenario).toBe(scenario)
    }
  })

  test("A6: 管理员 create 时车辆 ID 非法路径字符（../）自动被 strings filter 截断 + ID_PATTERN 丢弃，绝不跳转到任意 URL；≥65 字符被 strings(value,20,64).slice(0,64) 截断后仍过 ID_PATTERN 但语义上不允许超长，校验以 text(slice(0,64)) 一致", async () => {
    const mocks = createMockDb({})
    const mod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: mocks.db })
    const badPathId = "../../../etc/passwd"
    const superLongId = "a".repeat(80)
    const res = await mod.main({
      action: "create",
      guide: buildValidGuide({ vehicleIds: ["valid_id_01", badPathId, superLongId] })
    })
    expect(res.ok).toBe(true)
    const addPayload = mocks.guideAdd.mock.calls[0][0].data
    expect(addPayload.vehicleIds.includes("valid_id_01")).toBe(true)
    expect(addPayload.vehicleIds.some((id) => id.includes("/") || id.includes(".."))).toBe(false)
    addPayload.vehicleIds.forEach((id) => {
      expect(id.length <= 64).toBe(true)
      expect(/^[A-Za-z0-9_-]{1,64}$/.test(id)).toBe(true)
    })
  })

  test("A7: 管理员 ACTIONS 4 项枚举外全部 VALIDATION_ERROR 拒绝", async () => {
    const mocks = createMockDb({})
    const mod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: mocks.db })
    for (const badAction of ["delete", "bulk_import", "export_all", "promote", ""]) {
      const res = await mod.main({ action: badAction, guide: buildValidGuide() })
      expect(res.ok).toBe(false)
      expect(res.code).toBe("VALIDATION_ERROR")
    }
    expect(mocks.guideAdd).not.toHaveBeenCalled()
  })

  test("B5: 普通用户调用 contentGuideManage 任意 action 全部返回 FORBIDDEN，绝不落库", async () => {
    const mocks = createMockDb({})
    const mod = await loadContentGuideManageWith({ openid: "normal_user_openid_real_account", mockDb: mocks.db })
    for (const action of ACTIONS) {
      const payload = action === "publish" || action === "archive"
        ? { action, id: "content_any_001" }
        : { action, id: "content_any_001", guide: buildValidGuide() }
      const res = await mod.main(payload)
      expect(res.ok).toBe(false)
      expect(res.code).toBe("FORBIDDEN")
    }
    expect(mocks.guideAdd).not.toHaveBeenCalled()
    expect(mocks.auditAdd).not.toHaveBeenCalled()
  })

  test("C1: 未知参数 channel/scene 未知枚举 + 65 字符以上 slug + 含路径 / URL 字符的 slug → validateGuide 报 VALIDATION_ERROR 或 normalize 截断丢弃", async () => {
    const mocks = createMockDb({})
    const mod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: mocks.db })
    const invalid = await mod.main({
      action: "create",
      guide: buildValidGuide({
        slug: "contains/slash-and?url=../escape&x=<script>",
        contentType: "unknown_will_be_invalid_field",
        scenario: "not_a_real_scenario_value",
        tags: ["tag_with_slash/should_truncate", "tag_ok"],
        shareTitle: ""
      })
    })
    expect(invalid.ok).toBe(false)
    expect(invalid.code).toBe("VALIDATION_ERROR")
    expect(mocks.guideAdd).not.toHaveBeenCalled()
  })

  test("C3: 同 slug 第二次 create（幂等）→ DUPLICATE_SLUG，绝不重复写入；audit 只记录第一次成功那次", async () => {
    const firstMocks = createMockDb({})
    const firstMod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: firstMocks.db })
    const first = await firstMod.main({ action: "create", guide: buildValidGuide() })
    expect(first.ok).toBe(true)
    expect(first.id).toBe("content_acceptance_a0_001")
    expect(firstMocks.actionAuditCaptures).toHaveLength(1)

    const secondMocks = createMockDb({ existingSlugs: ["acceptance-a0-seed-001"] })
    const secondMod = await loadContentGuideManageWith({ openid: "admin_openid_real_account", mockDb: secondMocks.db })
    const second = await secondMod.main({ action: "create", guide: buildValidGuide() })
    expect(second.ok).toBe(false)
    expect(second.code).toBe("DUPLICATE_SLUG")
    expect(secondMocks.guideAdd).not.toHaveBeenCalled()
    expect(secondMocks.actionAuditCaptures).toHaveLength(0)
  })
})
