const fs = require("fs")
const path = require("path")
const { spawnSync } = require("child_process")
const {
  EXPECTED_COLLECTIONS,
  RECOMMENDED_INDEXES,
  checkDatabaseIndexes,
  printReport,
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

  test("17 个集合清单完整且排序稳定", () => {
    expect(EXPECTED_COLLECTIONS).toHaveLength(17)
    expect([...EXPECTED_COLLECTIONS].sort()).toEqual(EXPECTED_COLLECTIONS)
    expect(new Set(EXPECTED_COLLECTIONS).size).toBe(17)
    expect(EXPECTED_COLLECTIONS).toContain("admin_upload_sessions")
  })

  test("security-rules/manifest.json 声明覆盖全部 17 个集合，无缺失", () => {
    expect(result.collections.expected).toBe(17)
    expect(result.collections.protectedInManifest).toBeGreaterThanOrEqual(17)
    expect(result.collections.missing).toEqual([])
  })

  test("阻断级唯一索引 = 4 条（content_guides.slug + roles.openid + vehicles.plateNumber + app_configs.key）", () => {
    const blocking = RECOMMENDED_INDEXES.filter((idx) => idx.priority === "blocking" && idx.unique)
    expect(blocking).toHaveLength(4)
    expect(blocking.map((i) => `${i.collection}.${i.fields.join("+")}`)).toEqual([
      "content_guides.slug",
      "roles.openid",
      "vehicles.plateNumber",
      "app_configs.key",
    ])
    blocking.forEach((idx) => {
      expect(idx.unique).toBe(true)
      expect(idx.category).toBe("correctness")
    })
  })

  test("37 条索引检查项中 6 条阻断级均已在本地声明", () => {
    const blockingInDetail = result.indexes.detail.filter(
      (row) => row.priority === "blocking"
    )
    expect(blockingInDetail).toHaveLength(6)
    blockingInDetail.forEach((row) => {
      expect(row.declared).toBe("是")
      if (row.collection !== "admin_upload_sessions") expect(row.status).toBe("文档+定义")
    })
  })

  test("37 条索引检查项包含原有 35 条文档建议和 2 条上传清理必需声明", () => {
    expect(result.indexes.recommended).toBe(37)
    expect(result.indexes.documentedInChecklist).toBeGreaterThanOrEqual(35)
    expect(RECOMMENDED_INDEXES.filter((index) => index.requiredInDeclaration)).toEqual([
      expect.objectContaining({ collection: "admin_upload_sessions", fields: ["expiresAt"], unique: false }),
      expect.objectContaining({ collection: "admin_upload_sessions", fields: ["openid", "expiresAt"], unique: false })
    ])
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

  test("索引检查项覆盖 17/17 个集合（全量无空缺）", () => {
    const covered = new Set(RECOMMENDED_INDEXES.map((i) => i.collection))
    const uncovered = EXPECTED_COLLECTIONS.filter((c) => !covered.has(c))
    expect(uncovered.sort()).toEqual([])
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

  test("报告明确仅核验本地声明，集合和索引数量不再硬编码", () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {})
    printReport(result)
    const output = log.mock.calls.map((args) => args.join(" ")).join("\n")
    expect(output).toContain("仅检查仓库中的集合与索引声明，未查询云端")
    expect(output).toContain("17 个集合")
    expect(output).toContain("37 条索引检查项")
  })
})

describe("上传会话索引缺失必须阻断本地检查", () => {
  const cacheRoot = path.join(PROJECT_ROOT, "node_modules/.cache/development-round4")
  let fixture
  const writeJson = (file, value) => fs.writeFileSync(path.join(fixture, "security-rules", file), JSON.stringify(value))
  const readJson = (file) => JSON.parse(fs.readFileSync(path.join(fixture, "security-rules", file), "utf8"))
  beforeAll(() => {
    fs.mkdirSync(cacheRoot, { recursive: true })
    fixture = fs.mkdtempSync(path.join(cacheRoot, "index-check-"))
    fs.mkdirSync(path.join(fixture, "security-rules"))
  })
  beforeEach(() => {
    for (const file of ["manifest.json", "database-indexes.json"]) {
      fs.copyFileSync(path.join(PROJECT_ROOT, "security-rules", file), path.join(fixture, "security-rules", file))
    }
    fs.copyFileSync(path.join(PROJECT_ROOT, "DEPLOY_CHECKLIST.md"), path.join(fixture, "DEPLOY_CHECKLIST.md"))
  })
  afterAll(() => {
    if (!path.resolve(fixture).startsWith(path.resolve(cacheRoot) + path.sep)) throw new Error("Unexpected fixture directory")
    fs.rmSync(fixture, { recursive: true, force: true })
  })

  test("检查指定目录的 manifest；缺少上传会话集合不能读取仓库原件误报通过", () => {
    const manifest = readJson("manifest.json")
    manifest.database.collections = manifest.database.collections.filter((name) => name !== "admin_upload_sessions")
    writeJson("manifest.json", manifest)
    expect(checkDatabaseIndexes(fixture)).toMatchObject({
      status: "fail",
      projectRoot: fixture,
      violations: [expect.objectContaining({ type: "missing_collection_in_manifest", collection: "admin_upload_sessions" })]
    })
  })

  test.each(["admin_upload_sessions_expiresAt", "admin_upload_sessions_openid_expiresAt"])("缺少 %s 声明时阻断", (name) => {
    const indexes = readJson("database-indexes.json")
    indexes.admin_upload_sessions = indexes.admin_upload_sessions.filter((index) => index.name !== name)
    writeJson("database-indexes.json", indexes)
    const result = checkDatabaseIndexes(fixture)
    expect(result.status).toBe("fail")
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: "required_index_missing_in_declared", collection: "admin_upload_sessions", severity: "blocking"
    }))
  })

  test("清单文档写了两条索引也不能代替真实声明文件", () => {
    const indexes = readJson("database-indexes.json")
    delete indexes.admin_upload_sessions
    writeJson("database-indexes.json", indexes)
    fs.appendFileSync(path.join(fixture, "DEPLOY_CHECKLIST.md"), "\n- `admin_upload_sessions.expiresAt`\n- `admin_upload_sessions.openid + expiresAt`\n")
    const result = checkDatabaseIndexes(fixture)
    expect(result.status).toBe("fail")
    expect(result.violations.filter((issue) => issue.type === "required_index_missing_in_declared")).toHaveLength(2)
  })

  test.each(["order", "unique"])("复合索引 %s 错误不能替代所需查询索引", (change) => {
    const indexes = readJson("database-indexes.json")
    const compound = indexes.admin_upload_sessions.find((index) => index.name === "admin_upload_sessions_openid_expiresAt")
    if (change === "order") compound.fields.reverse()
    else compound.unique = true
    writeJson("database-indexes.json", indexes)
    const result = checkDatabaseIndexes(fixture)
    expect(result.status).toBe("fail")
    expect(result.violations).toContainEqual(expect.objectContaining({
      type: "required_index_missing_in_declared", collection: "admin_upload_sessions", fields: ["openid", "expiresAt"]
    }))
  })

  test("缺少整个索引文件时两个必需索引均阻断", () => {
    fs.unlinkSync(path.join(fixture, "security-rules/database-indexes.json"))
    const result = checkDatabaseIndexes(fixture)
    expect(result.status).toBe("fail")
    expect(result.violations.filter((issue) => issue.type === "required_index_missing_in_declared")).toHaveLength(2)
  })

  test("实际 CLI 对缺失必需索引返回退出码 1，且不会改动本地配置", () => {
    const indexes = readJson("database-indexes.json")
    indexes.admin_upload_sessions = []
    writeJson("database-indexes.json", indexes)
    const before = fs.readFileSync(path.join(fixture, "security-rules/database-indexes.json"), "utf8")
    const result = spawnSync(process.execPath, [path.join(PROJECT_ROOT, "scripts/checkDatabaseIndexes.js")], { cwd: fixture, encoding: "utf8" })
    expect(result.status).toBe(1)
    expect(result.stdout).toContain("必需索引未在本地")
    expect(result.stdout).toContain("未查询云端")
    expect(fs.readFileSync(path.join(fixture, "security-rules/database-indexes.json"), "utf8")).toBe(before)
  })
})
