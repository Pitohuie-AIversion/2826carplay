const path = require("path")
const {
  EXPECTED_COLLECTIONS,
  RECOMMENDED_INDEXES,
  checkDatabaseIndexes,
} = require("../scripts/checkDatabaseIndexes")

const PROJECT_ROOT = path.resolve(__dirname, "..")

describe("数据库索引与集合安全巡检契约", () => {
  let result

  beforeAll(() => {
    result = checkDatabaseIndexes(PROJECT_ROOT)
  })

  test("checkDatabaseIndexes 返回结构化结果", () => {
    expect(typeof result.status).toBe("string")
    expect(["pass", "warn", "fail"]).toContain(result.status)
    expect(typeof result.counts).toBe("object")
    expect(Number.isFinite(result.counts.total)).toBe(true)
  })

  test("16 个业务集合清单完整且排序稳定", () => {
    expect(EXPECTED_COLLECTIONS).toHaveLength(16)
    expect([...EXPECTED_COLLECTIONS].sort()).toEqual(EXPECTED_COLLECTIONS)
    expect(new Set(EXPECTED_COLLECTIONS).size).toBe(16)
  })

  test("security-rules/manifest.json 覆盖全部 16 个集合，无缺失", () => {
    expect(result.collections.expected).toBe(16)
    expect(result.collections.protectedInManifest).toBeGreaterThanOrEqual(16)
    expect(result.collections.missing).toEqual([])
  })

  test("阻断级唯一索引 = 3 条（content_guides.slug + roles.openid + vehicles.plateNumber）", () => {
    const blocking = RECOMMENDED_INDEXES.filter((idx) => idx.priority === "blocking")
    expect(blocking).toHaveLength(3)
    expect(blocking.map((i) => `${i.collection}.${i.fields.join("+")}`)).toEqual([
      "content_guides.slug",
      "roles.openid",
      "vehicles.plateNumber",
    ])
    blocking.forEach((idx) => {
      expect(idx.unique).toBe(true)
      expect(idx.category).toBe("correctness")
    })
  })

  test("31 条推荐索引中 3 条阻断级必须声明在 security-rules/database-indexes.json", () => {
    const blockingInDetail = result.indexes.detail.filter(
      (row) => row.priority === "blocking"
    )
    expect(blockingInDetail).toHaveLength(3)
    blockingInDetail.forEach((row) => {
      expect(row.declared).toBe("是")
      expect(row.status).toBe("文档+定义")
    })
  })

  test("RECOMMENDED_INDEXES 31 条全部在 DEPLOY_CHECKLIST 中找到对应字段声明", () => {
    expect(result.indexes.recommended).toBe(31)
    expect(result.indexes.documentedInChecklist).toBe(31)
  })

  test("最终状态不得为 FAIL（不允许阻断项）", () => {
    const blockingViolations = (result.violations || []).filter(
      (v) => v.severity === "blocking"
    )
    expect(blockingViolations).toEqual([])
    expect(result.status).not.toBe("fail")
  })

  test("check:indexes 命令在 package.json check:release 链路中存在", () => {
    const pkg = require(path.join(PROJECT_ROOT, "package.json"))
    expect(typeof pkg.scripts["check:indexes"]).toBe("string")
    expect(pkg.scripts["check:indexes"]).toContain("checkDatabaseIndexes")
    expect(pkg.scripts["check:release"]).toContain("check:indexes")
  })

  test("建议索引集合覆盖 14/16 个业务集合，仅 app_configs 和 pending_file_deletions 允许无索引提示", () => {
    const covered = new Set(RECOMMENDED_INDEXES.map((i) => i.collection))
    const uncovered = EXPECTED_COLLECTIONS.filter((c) => !covered.has(c))
    expect(uncovered.sort()).toEqual(["app_configs", "pending_file_deletions"])
  })

  test("每条推荐索引的字段顺序和 collection 名均已在 manifest.collections 中存在", () => {
    RECOMMENDED_INDEXES.forEach((idx) => {
      expect(EXPECTED_COLLECTIONS).toContain(idx.collection)
      expect(Array.isArray(idx.fields)).toBe(true)
      expect(idx.fields.length).toBeGreaterThanOrEqual(1)
      idx.fields.forEach((f) => {
        expect(typeof f).toBe("string")
        expect(f.length).toBeGreaterThan(0)
      })
    })
  })
})
