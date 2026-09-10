const fs = require("fs")
const path = require("path")
const { colorize, printTable, summarize } = require("./_cloudUtil")

const PROJECT_ROOT = process.cwd()
const SECURITY_RULES_DIR = path.join(PROJECT_ROOT, "security-rules")
const DEPLOY_CHECKLIST_PATH = path.join(PROJECT_ROOT, "DEPLOY_CHECKLIST.md")

const EXPECTED_COLLECTIONS = [
  "analytics_events",
  "app_configs",
  "audit_logs",
  "booking_handovers",
  "booking_quotes",
  "bookings",
  "content_guides",
  "error_logs",
  "favorites",
  "pending_file_deletions",
  "privacy_requests",
  "roles",
  "vehicle_availability_blocks",
  "vehicle_calendar_days",
  "vehicle_price_rules",
  "vehicles",
]

const RECOMMENDED_INDEXES = [
  { collection: "analytics_events", fields: ["createdAt"], unique: false, category: "performance", priority: "medium" },
  { collection: "audit_logs", fields: ["createdAt"], unique: false, category: "performance", priority: "medium" },
  { collection: "audit_logs", fields: ["action"], unique: false, category: "performance", priority: "low" },
  { collection: "error_logs", fields: ["createdAt"], unique: false, category: "performance", priority: "medium" },
  { collection: "error_logs", fields: ["function"], unique: false, category: "performance", priority: "low" },
  { collection: "favorites", fields: ["openid", "createdAt"], unique: false, category: "performance", priority: "medium" },
  { collection: "favorites", fields: ["openid", "vehicleId"], unique: false, category: "correctness", priority: "high" },
  { collection: "bookings", fields: ["openid", "createdAt"], unique: false, category: "performance", priority: "high" },
  { collection: "bookings", fields: ["createdAt"], unique: false, category: "performance", priority: "medium" },
  { collection: "bookings", fields: ["vehicleId"], unique: false, category: "performance", priority: "high" },
  { collection: "bookings", fields: ["status", "createdAt"], unique: false, category: "performance", priority: "medium" },
  { collection: "bookings", fields: ["status", "coordinationStatus"], unique: false, category: "performance", priority: "low" },
  { collection: "bookings", fields: ["startDate", "endDate"], unique: false, category: "performance", priority: "high" },
  { collection: "booking_quotes", fields: ["bookingId", "version"], unique: false, category: "correctness", priority: "high" },
  { collection: "booking_quotes", fields: ["bookingId", "status"], unique: false, category: "performance", priority: "medium" },
  { collection: "booking_quotes", fields: ["sentAt"], unique: false, category: "performance", priority: "low" },
  { collection: "booking_handovers", fields: ["bookingId", "stage", "version"], unique: false, category: "correctness", priority: "high" },
  { collection: "booking_handovers", fields: ["bookingId", "status"], unique: false, category: "performance", priority: "medium" },
  { collection: "content_guides", fields: ["slug"], unique: true, category: "correctness", priority: "blocking" },
  { collection: "content_guides", fields: ["status", "publishedAt"], unique: false, category: "performance", priority: "high" },
  { collection: "content_guides", fields: ["scenario", "status"], unique: false, category: "performance", priority: "medium" },
  { collection: "vehicle_availability_blocks", fields: ["status", "startDate", "endDate"], unique: false, category: "performance", priority: "high" },
  { collection: "vehicle_availability_blocks", fields: ["vehicleId", "status"], unique: false, category: "performance", priority: "high" },
  { collection: "vehicle_calendar_days", fields: ["blockId"], unique: false, category: "performance", priority: "medium" },
  { collection: "vehicle_calendar_days", fields: ["bookingId"], unique: false, category: "performance", priority: "medium" },
  { collection: "vehicle_price_rules", fields: ["vehicleId", "status"], unique: false, category: "performance", priority: "medium" },
  { collection: "privacy_requests", fields: ["openid", "createdAt"], unique: false, category: "performance", priority: "medium" },
  { collection: "privacy_requests", fields: ["createdAt"], unique: false, category: "performance", priority: "low" },
  { collection: "roles", fields: ["openid"], unique: true, category: "correctness", priority: "blocking" },
  { collection: "vehicles", fields: ["plateNumber"], unique: true, category: "correctness", priority: "blocking" },
  { collection: "vehicles", fields: ["updatedAt"], unique: false, category: "performance", priority: "low" },
]

function indexKey(idx) {
  const uniqTag = idx.unique ? ":unique" : ""
  return `${idx.collection}:${idx.fields.join("+")}${uniqTag}`
}

function readSecurityRulesManifest() {
  const manifestPath = path.join(SECURITY_RULES_DIR, "manifest.json")
  if (!fs.existsSync(manifestPath)) {
    return { exists: false, collections: [], declaredIndexes: [] }
  }
  try {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"))
    const dbSection = manifest && typeof manifest.database === "object" ? manifest.database : {}
    const collections = Array.isArray(dbSection.collections)
      ? dbSection.collections.map((c) => (typeof c === "string" ? c : c.name))
      : []

    const declaredIndexes = []
    const indexFile = dbSection.indexFile
    if (indexFile) {
      const idxPath = path.join(SECURITY_RULES_DIR, indexFile)
      if (fs.existsSync(idxPath)) {
        try {
          const idxDoc = JSON.parse(fs.readFileSync(idxPath, "utf8"))
          Object.keys(idxDoc).forEach((collection) => {
            const list = Array.isArray(idxDoc[collection]) ? idxDoc[collection] : []
            list.forEach((idx) => {
              const fields = Array.isArray(idx.fields)
                ? idx.fields.map((f) => (typeof f === "string" ? f : f.field))
                : []
              declaredIndexes.push({
                collection,
                name: idx.name || null,
                fields,
                unique: !!idx.unique,
              })
            })
          })
        } catch (e) {
          return { exists: true, parseError: `indexFile 解析失败：${e.message}`, collections, declaredIndexes }
        }
      }
    }
    return { exists: true, collections, declaredIndexes }
  } catch (err) {
    return { exists: true, parseError: err.message, collections: [], declaredIndexes: [] }
  }
}

function readDeployChecklistIndexes() {
  if (!fs.existsSync(DEPLOY_CHECKLIST_PATH)) {
    return { exists: false, foundIndexes: [] }
  }
  try {
    const content = fs.readFileSync(DEPLOY_CHECKLIST_PATH, "utf8")
    const foundIndexes = []
    RECOMMENDED_INDEXES.forEach((idx) => {
      const fieldPart = idx.fields.join(" + ")
      if (content.includes(idx.collection) && content.includes(idx.fields[0])) {
        foundIndexes.push(indexKey(idx))
      }
    })
    return { exists: true, foundIndexes }
  } catch (err) {
    return { exists: true, parseError: err.message, foundIndexes: [] }
  }
}

function checkDatabaseIndexes(projectRoot) {
  const root = path.resolve(projectRoot || PROJECT_ROOT)
  const violations = []
  const warnings = []
  const info = []

  const securityManifest = readSecurityRulesManifest()
  if (!securityManifest.exists) {
    violations.push({
      type: "missing_security_manifest",
      message: "security-rules/manifest.json 不存在，无法核对集合安全规则",
      severity: "blocking",
    })
  } else if (securityManifest.parseError) {
    violations.push({
      type: "invalid_security_manifest",
      message: `security-rules/manifest.json 解析失败：${securityManifest.parseError}`,
      severity: "blocking",
    })
  } else {
    const protectedSet = new Set(securityManifest.collections)
    EXPECTED_COLLECTIONS.forEach((name) => {
      if (!protectedSet.has(name)) {
        violations.push({
          type: "missing_collection_in_manifest",
          collection: name,
          message: `集合 ${name} 未在 security-rules/manifest.json 中声明，客户端安全规则可能未覆盖`,
          severity: "blocking",
        })
      }
    })
  }

  const checklist = readDeployChecklistIndexes()
  const recommendedKeys = new Set(RECOMMENDED_INDEXES.map(indexKey))
  const documentedKeys = new Set(checklist.foundIndexes || [])

  const declaredIndexKeys = new Set()
  const declaredByName = new Map()
  ;(securityManifest.declaredIndexes || []).forEach((idx) => {
    const fields = (idx.fields || []).slice().sort()
    const uniqTag = idx.unique ? ":unique" : ""
    const sortedKey = `${idx.collection}:${fields.join("+")}${uniqTag}`
    declaredIndexKeys.add(sortedKey)
    if (idx.name) {
      declaredByName.set(idx.name, idx)
    }
  })
  function declaredMatches(recommended) {
    const sortedRec = recommended.fields.slice().sort()
    const uniqTag = recommended.unique ? ":unique" : ""
    const recKey = `${recommended.collection}:${sortedRec.join("+")}${uniqTag}`
    if (declaredIndexKeys.has(recKey)) return true
    const sameCol = (securityManifest.declaredIndexes || []).filter(
      (d) => d.collection === recommended.collection
    )
    for (const d of sameCol) {
      if (!!d.unique !== !!recommended.unique) continue
      const df = (d.fields || []).slice().sort()
      if (df.length !== sortedRec.length) continue
      let ok = true
      for (let i = 0; i < sortedRec.length; i++) {
        if (df[i] !== sortedRec[i]) {
          ok = false
          break
        }
      }
      if (ok) return true
    }
    return false
  }

  const blockingIndexes = RECOMMENDED_INDEXES.filter((i) => i.priority === "blocking")
  blockingIndexes.forEach((idx) => {
    const key = indexKey(idx)
    if (!documentedKeys.has(key)) {
      violations.push({
        type: "blocking_index_undocumented",
        collection: idx.collection,
        fields: idx.fields,
        unique: idx.unique,
        message: `阻断级唯一索引未在 DEPLOY_CHECKLIST 中找到对应声明：${idx.collection}(${idx.fields.join(",")})${idx.unique ? " [唯一]" : ""}`,
        severity: "blocking",
      })
    }
    if (!declaredMatches(idx)) {
      warnings.push({
        type: "blocking_index_missing_in_declared",
        collection: idx.collection,
        fields: idx.fields,
        message: `阻断级唯一索引未在 security-rules/database-indexes.json 中声明：${idx.collection}(${idx.fields.join("+")})${idx.unique ? " [唯一]" : ""}。请同步补入 database-indexes.json 并在云控制台创建对应索引。`,
        severity: idx.priority === "blocking" ? "high" : "medium",
      })
    }
  })

  RECOMMENDED_INDEXES.forEach((idx) => {
    const doc = documentedKeys.has(indexKey(idx))
    const decl = declaredMatches(idx)
    let statusLabel
    if (doc && decl) statusLabel = "文档+定义"
    else if (doc) statusLabel = "仅文档"
    else if (decl) statusLabel = "仅定义"
    else statusLabel = "待确认"
    info.push({
      collection: idx.collection,
      fields: idx.fields.join(" + "),
      unique: idx.unique ? "是" : "否",
      category: idx.category,
      priority: idx.priority,
      declared: decl ? "是" : "否",
      status: statusLabel,
    })
  })

  const collectionsWithIndexes = new Set(RECOMMENDED_INDEXES.map((i) => i.collection))
  const collectionsWithoutAnyRecommendation = EXPECTED_COLLECTIONS.filter((c) => !collectionsWithIndexes.has(c))
  collectionsWithoutAnyRecommendation.forEach((name) => {
    warnings.push({
      type: "collection_no_index_hint",
      collection: name,
      message: `集合 ${name} 在 RECOMMENDED_INDEXES 中暂无索引建议，上线前需人工在云控制台核对访问模式`,
      severity: "low",
    })
  })

  const blockingCount = violations.filter((v) => v.severity === "blocking").length
  const warningCount = warnings.length
  const totalChecks =
    EXPECTED_COLLECTIONS.length + RECOMMENDED_INDEXES.length + 1
  const passedChecks = totalChecks - blockingCount - warningCount

  const status = blockingCount > 0 ? "fail" : warningCount > 0 ? "warn" : "pass"

  return {
    status,
    projectRoot: root,
    collections: {
      expected: EXPECTED_COLLECTIONS.length,
      protectedInManifest: new Set(securityManifest.collections || []).size,
      missing: EXPECTED_COLLECTIONS.filter(
        (name) => !(securityManifest.collections || []).includes(name)
      ),
    },
    indexes: {
      recommended: RECOMMENDED_INDEXES.length,
      unique: RECOMMENDED_INDEXES.filter((i) => i.unique).length,
      blocking: blockingIndexes.length,
      documentedInChecklist: documentedKeys.size,
      declaredInDbIndexesFile: (securityManifest.declaredIndexes || []).length,
      declaredMatched: info.filter((r) => r.declared === "是").length,
      detail: info,
    },
    violations,
    warnings,
    counts: {
      total: totalChecks,
      passed: Math.max(0, passedChecks),
      blocking: blockingCount,
      warning: warningCount,
    },
  }
}

function printReport(result) {
  const title = colorize("【数据库索引与集合安全巡检 checkDatabaseIndexes】", "bold")
  console.log(title)
  console.log("")

  console.log(colorize("【16 个业务集合 × security-rules/manifest.json 覆盖】", "cyan"))
  const collectionRows = result.collections.missing.length === 0
    ? [{ name: "（全部覆盖）", count: result.collections.protectedInManifest }]
    : result.collections.missing.map((name) => ({ name, count: "缺" }))
  printTable(
    collectionRows,
    [
      { key: "name", label: "集合名 / 覆盖结果" },
      { key: "count", label: "说明", align: "right", colorize: (raw) => raw === "缺" ? colorize(raw, "red") : colorize(raw, "green") },
    ]
  )

  console.log("")
  console.log(colorize("【31 条建议索引优先级与文档状态】", "cyan"))
  const prioLabel = {
    blocking: colorize("阻断", "red"),
    high: colorize("高", "yellow"),
    medium: "中",
    low: colorize("低", "gray"),
  }
  const idxRows = result.indexes.detail.map((row) => {
    const statusColor =
      row.status === "文档+定义"
        ? colorize(row.status, "green")
        : row.status === "待确认"
        ? colorize(row.status, "yellow")
        : colorize(row.status, "cyan")
    return {
      ...row,
      priority: prioLabel[row.priority] || row.priority,
      declared: row.declared === "是" ? colorize(row.declared, "green") : colorize(row.declared, "gray"),
      status: statusColor,
    }
  })
  printTable(idxRows, [
    { key: "collection", label: "集合" },
    { key: "fields", label: "字段组合" },
    { key: "unique", label: "唯一" },
    { key: "category", label: "目的" },
    { key: "priority", label: "优先级" },
    { key: "declared", label: "定义文件" },
    { key: "status", label: "同步状态" },
  ])

  if (result.warnings.length > 0) {
    console.log("")
    console.log(colorize("【警告（非阻断）】", "yellow"))
    result.warnings.forEach((w) => {
      console.log(`  ⚠  ${w.message}`)
    })
  }

  if (result.violations.length > 0) {
    console.log("")
    console.log(colorize("【阻断项（发布前必须处理）】", "red"))
    result.violations.forEach((v) => {
      console.log(`  ✖  [${v.severity}] ${v.message}`)
    })
  }

  summarize(
    "巡检汇总",
    result.counts.total,
    result.counts.passed,
    result.counts.blocking,
    result.counts.warning > 0 ? colorize(`警告 ${result.counts.warning}`, "yellow") : null
  )

  console.log("")
  const statusLabel =
    result.status === "pass"
      ? colorize("✅ PASS", "green")
      : result.status === "warn"
      ? colorize("⚠  WARN（可发布，建议补索引）", "yellow")
      : colorize("✖ FAIL（存在阻断项，禁止发布）", "red")
  console.log(`最终结论：${statusLabel}`)
  if (result.status === "warn") {
    console.log(colorize("  提示：推荐索引属于性能建议，缺少唯一索引的正确性阻断项会单独判定为 FAIL。", "gray"))
  }
}

if (require.main === module) {
  const result = checkDatabaseIndexes(PROJECT_ROOT)
  printReport(result)
  process.exitCode = result.status === "fail" ? 1 : 0
}

module.exports = {
  EXPECTED_COLLECTIONS,
  RECOMMENDED_INDEXES,
  checkDatabaseIndexes,
  printReport,
}
