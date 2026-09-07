jest.mock("wx-server-sdk")

const {
  SEED_DIR,
  collectSeedGuides,
  loadAndValidateSeeds,
  summarize,
  CONTENT_TYPES,
  SCENARIOS,
  ID_PATTERN
} = require("../scripts/bootstrapContentDrafts.js")

describe("bootstrapContentDrafts scripts (PRE-4 bootstrap toolchain)", () => {
  test("collectSeedGuides 读取 5 篇 draft_*.json，不含 summary.json", () => {
    const list = collectSeedGuides()
    expect(list).toHaveLength(5)
    list.forEach((item) => {
      expect(item.fileName.startsWith("draft_")).toBe(true)
      expect(item.fileName.endsWith(".json")).toBe(true)
      expect(item.fileName).not.toBe("summary.json")
      expect(item.absolutePath.includes(SEED_DIR.replace(/\\/g, "/")) || item.absolutePath.includes(SEED_DIR)).toBe(true)
    })
  })

  test("loadAndValidateSeeds 5/5 通过，invalidFields 全空，无 duplicates", () => {
    const seedResults = loadAndValidateSeeds()
    expect(seedResults.results).toHaveLength(5)
    seedResults.results.forEach((item) => {
      expect(item.invalidFields).toEqual([])
      expect(ID_PATTERN.test(item.guide.slug)).toBe(true)
      expect(CONTENT_TYPES.includes(item.guide.contentType)).toBe(true)
      expect(SCENARIOS.includes(item.guide.scenario)).toBe(true)
      expect(item.guide.title.length > 0).toBe(true)
      expect(item.guide.summary.length > 0).toBe(true)
      expect(item.guide.body.length > 0).toBe(true)
    })
    expect(seedResults.duplicates).toEqual([])
  })

  test("summarize 生成 total=5 passed=5 failed=0 的统计摘要", () => {
    const seedResults = loadAndValidateSeeds()
    const summary = summarize(seedResults)
    expect(summary.total).toBe(5)
    expect(summary.passed).toBe(5)
    expect(summary.failed).toBe(0)
    expect(summary.duplicates).toEqual([])
    const slugs = summary.items.map((item) => item.guide.slug).sort()
    expect(slugs).toEqual([
      "business-reception-guide-2026",
      "ev-first-rental-tips-2026",
      "handover-checklist-2026",
      "long-distance-road-trip-2026",
      "weekend-short-trip-prep-2026"
    ])
  })

  test("5 场景枚举 × 5 content-type 枚举覆盖 SCENARIOS × CONTENT_TYPES 5 个桶位不重复", () => {
    const seedResults = loadAndValidateSeeds()
    const scenarioSet = new Set()
    const contentTypeSet = new Set()
    const pairs = new Set()
    seedResults.results.forEach((item) => {
      scenarioSet.add(item.guide.scenario)
      contentTypeSet.add(item.guide.contentType)
      pairs.add(`${item.guide.scenario}|${item.guide.contentType}`)
    })
    expect(scenarioSet.size).toBe(5)
    expect(contentTypeSet.size).toBe(5)
    expect(pairs.size).toBe(5)
    SCENARIOS.forEach((scenario) => expect(scenarioSet.has(scenario)).toBe(true))
    CONTENT_TYPES.forEach((ct) => expect(contentTypeSet.has(ct)).toBe(true))
  })
})
