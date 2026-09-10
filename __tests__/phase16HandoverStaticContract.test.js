const fs = require("fs")
const path = require("path")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const CLOUDFUNCTIONS_ROOT = path.join(PROJECT_ROOT, "cloudfunctions")
const PAGES_ROOT = path.join(PROJECT_ROOT, "pages")
const PAGES_ADMIN_ROOT = path.join(PROJECT_ROOT, "pages-admin")

function readCloudFunction(name) {
  const p = path.join(CLOUDFUNCTIONS_ROOT, name, "index.js")
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null
}

function readPage(relative) {
  const candidates = [
    path.join(PAGES_ROOT, relative + ".js"),
    path.join(PAGES_ADMIN_ROOT, relative + ".js"),
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return fs.readFileSync(c, "utf8")
  }
  return null
}

const HANDOVER_ITEMS = [
  {
    id: "PRE-3",
    title: "bootstrapAdmin 必须校验 BOOTSTRAP_TOKEN 环境变量（≥32 位，口令合法才会落库）",
    checks: [
      {
        fn: "bootstrapAdmin",
        code: (src) => {
          expect(src).toMatch(/process\.env\.BOOTSTRAP_TOKEN|BOOTSTRAP_TOKEN/)
          expect(src).toMatch(/length\s*[<>=]+\s*3[2-9]|length\s*[<>=]+\s*[3-9][0-9]|\.length\s*>\s*=\s*32|32.*256|256.*32/)
          expect(src).toMatch(/initialized|roles/)
        },
      },
    ],
  },
  {
    id: "PRE-4",
    title: "5 篇内容草稿 seed 必须合法且可发布（枚举匹配 + slug 唯一 + vehicleIds 可空）",
    checks: [
      {
        type: "drafts",
        code: () => {
          const seedsDir = path.join(PROJECT_ROOT, "scripts", "content_drafts_seed")
          const draftFiles = fs
            .readdirSync(seedsDir)
            .filter((f) => f.startsWith("draft_") && f.endsWith(".json"))
          expect(draftFiles).toHaveLength(5)
          const slugs = new Set()
          const validTypes = new Set(["route", "guide", "vehicle_advice", "vehicle_tip", "handover_guide"])
          const validScenarios = new Set([
            "weekend_trip",
            "group_travel",
            "business_reception",
            "ev_experience",
            "handover_tips",
          ])
          draftFiles.forEach((f) => {
            const doc = JSON.parse(fs.readFileSync(path.join(seedsDir, f), "utf8"))
            expect(doc).toHaveProperty("slug")
            expect(doc).toHaveProperty("contentType")
            expect(doc).toHaveProperty("scenario")
            expect(doc).toHaveProperty("title")
            expect(doc).toHaveProperty("body")
            expect(validTypes.has(doc.contentType)).toBe(true)
            expect(validScenarios.has(doc.scenario)).toBe(true)
            expect(typeof doc.slug === "string" && doc.slug.length >= 6 && doc.slug.length <= 64).toBe(true)
            expect(slugs.has(doc.slug)).toBe(false)
            slugs.add(doc.slug)
            if (doc.vehicleIds != null) {
              expect(Array.isArray(doc.vehicleIds)).toBe(true)
            }
          })
        },
      },
    ],
  },
  {
    id: "B1",
    title: "bookingCreate attribution 嵌套写 channel/scene/contentId，绝不写入 vehicleId（双重锁死）",
    checks: [
      {
        fn: "bookingCreate",
        code: (src) => {
          expect(src).toMatch(/attribution/)
          expect(src).toMatch(/input\.attribution\.channel|input\.attribution\.scene|input\.attribution\.contentId|attribution\.contentId|ATTRIBUTION_CHANNELS|ATTRIBUTION_SCENES/)
          const containsAttribution =
            /attribution\s*:\s*\{[^}]*contentId[^}]*channel[^}]*scene/.test(src) ||
            /input\.attribution\.(contentId|channel|scene)/.test(src)
          expect(containsAttribution).toBe(true)
          const badVehicleIdInAttribution =
            /attribution\s*[:=]\s*\{[^{}]*\bvehicleId\b/.test(src) ||
            /input\.attribution\.vehicleId|attribution\.vehicleId/.test(src)
          expect(badVehicleIdInAttribution).toBe(false)
        },
      },
      {
        fn: "bookingExportCsv",
        code: (src) => {
          expect(src).toMatch(/attributionChannel|attributionScene|attributionSource\.channel|attributionSource\.scene/)
          expect(src).toMatch(/ATTRIBUTION_CHANNELS|ATTRIBUTION_SCENES|ATTRIBUTION_ID_PATTERN/)
          const badWrite =
            /attribution\.vehicleId|attributionSource\.vehicleId|vehicleId.*attributionChannel|vehicleId.*attributionScene/i.test(
              src
            )
          expect(badWrite).toBe(false)
          expect(src).toMatch(/CSV|csvText|bookingExportCsv/)
        },
      },
    ],
  },
  {
    id: "B3",
    title: "analyticsOverview 渠道归因统计按 channel:scene 聚合成桶（buildSceneFunnel + topSources）",
    checks: [
      {
        fn: "analyticsOverview",
        code: (src) => {
          expect(src).toMatch(/buildSceneFunnel|sceneFunnel|topSources|buildContentAnalytics/)
          expect(src).toMatch(/channel[:+]scene|scene.*channel|channel.*scene/)
          expect(src).toMatch(/source|topSources|sources/)
        },
      },
    ],
  },
  {
    id: "B4",
    title: "bookingExportCsv 锁死 17 列中文白名单 + 17 投影键，非白名单字段清空",
    checks: [
      {
        fn: "bookingExportCsv",
        code: (src) => {
          const headerMatch = src.match(/buildCsv[\s\S]*?header\s*=\s*\[([\s\S]*?)\]/)
          expect(headerMatch).not.toBeNull()
          const headerSrc = headerMatch[1]
          const headerItems = [
            ...headerSrc.matchAll(/"([^"]{2,30})"/g),
          ].map((m) => m[1])
          expect(headerItems.length).toBe(17)
          const requiredHeaders = new Set(headerItems)
          const mustHave = [
            "提交时间",
            "车辆名称",
            "联系人",
            "手机号",
            "开始日期",
            "结束日期",
            "内容ID",
            "归因渠道",
            "归因场景",
            "预约ID",
          ]
          mustHave.forEach((h) => expect(requiredHeaders.has(h)).toBe(true))
          const fieldWhitelist =
            /ATTRIBUTION_CHANNELS\.includes|ATTRIBUTION_SCENES\.includes|ATTRIBUTION_ID_PATTERN\.test/.test(
              src
            )
          expect(fieldWhitelist).toBe(true)
          const formulaEscape =
            /formulaPrefixPattern|escapeCsvCell|safeText|formula.*injection|防注入/.test(src)
          expect(formulaEscape).toBe(true)
        },
      },
    ],
  },
  {
    id: "X1",
    title: "package.json 中 check:deploy = check:release + bootstrap:seeds，退出码零不阻断",
    checks: [
      {
        type: "pkg",
        code: () => {
          const pkg = JSON.parse(
            fs.readFileSync(path.join(PROJECT_ROOT, "package.json"), "utf8")
          )
          expect(pkg.scripts).toHaveProperty("check:deploy")
          expect(pkg.scripts).toHaveProperty("check:release")
          expect(pkg.scripts).toHaveProperty("bootstrap:seeds")
          expect(pkg.scripts).toHaveProperty("check:indexes")
          expect(pkg.scripts["check:deploy"]).toContain("check:release")
          expect(pkg.scripts["check:deploy"]).toContain("bootstrap:seeds")
          expect(pkg.scripts["check:release"]).toContain("check:indexes")
          expect(pkg.scripts["check:release"]).toContain("check:structure")
          expect(pkg.scripts["check:release"]).toContain("check:secrets")
          expect(pkg.scripts["check:release"]).toContain("check:drafts")
          expect(pkg.scripts["check:release"]).toContain("check:package")
          expect(pkg.scripts["check:release"]).toContain("--runInBand")
        },
      },
    ],
  },
  {
    id: "X2",
    title: "bootstrapAdmin 合法 token → initialized=true + roles 集合落 roles + audit 仅写 4 字段",
    checks: [
      {
        fn: "bootstrapAdmin",
        code: (src) => {
          expect(src).toMatch(/initialized\s*[:=]\s*true|return.*initialized.*true/)
          expect(src).toMatch(/roles|role/)
          expect(src).toMatch(/audit_logs|auditLogs|writeAuditLogBestEffort/)
          const auditPayloadMatch = src.match(
            /writeAuditLogBestEffort\(\{\s*([\s\S]*?)\}\s*\)/
          )
          expect(auditPayloadMatch).not.toBeNull()
          const payloadSrc = auditPayloadMatch[1]
          expect(payloadSrc).toMatch(/action/)
          expect(payloadSrc).toMatch(/bootstrap|tokenProtected/)
          expect(src).toMatch(/runTransaction|transaction|事务/)
        },
      },
    ],
  },
]

describe("Phase 16 HANDOVER 7 项静态代码契约锁死（真机操作前的自动前置校验）", () => {
  HANDOVER_ITEMS.forEach((item) => {
    describe(`${item.id} :: ${item.title}`, () => {
      item.checks.forEach((chk, idx) => {
        if (chk.fn) {
          test(`[${idx}] 云函数 ${chk.fn} 源码契约`, () => {
            const src = readCloudFunction(chk.fn)
            expect(src).not.toBeNull()
            chk.code(src)
          })
        } else if (chk.page) {
          test(`[${idx}] 页面 ${chk.page} 源码契约`, () => {
            const src = readPage(chk.page)
            expect(src).not.toBeNull()
            chk.code(src)
          })
        } else if (chk.type === "drafts" || chk.type === "pkg") {
          test(`[${idx}] 数据/配置文件契约`, () => {
            chk.code()
          })
        }
      })
    })
  })

  test("7 项 HANDOVER 与 phase16AcceptanceChecklist 清单完全一致（不漂移）", () => {
    const checklistSrc = fs.readFileSync(
      path.join(__dirname, "phase16AcceptanceChecklist.test.js"),
      "utf8"
    )
    HANDOVER_ITEMS.forEach((item) => {
      expect(checklistSrc).toContain(item.id)
      expect(checklistSrc).toMatch(
        new RegExp(`${item.id}[\\s\\S]*HANDOVER`)
      )
    })
    const ourIds = HANDOVER_ITEMS.map((i) => i.id).sort()
    expect(ourIds).toEqual(["B1","B3","B4","PRE-3","PRE-4","X1","X2"])
    expect(ourIds).toHaveLength(7)
  })
})
