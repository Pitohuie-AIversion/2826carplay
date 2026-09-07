const fs = require("fs")
const path = require("path")
const {
  normalizeGuide,
  validateGuide,
  CONTENT_TYPES,
  SCENARIOS,
  ID_PATTERN
} = require("./contentDraftsValidate.js")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const SEED_DIR = path.join(PROJECT_ROOT, "scripts", "content_drafts_seed")

function readJson(absolutePath) {
  return JSON.parse(fs.readFileSync(absolutePath, "utf8"))
}

function collectSeedGuides() {
  const fileNames = fs.readdirSync(SEED_DIR).filter((name) => name.startsWith("draft_") && name.endsWith(".json"))
  return fileNames
    .sort()
    .map((fileName) => ({ fileName, absolutePath: path.join(SEED_DIR, fileName) }))
}

function loadAndValidateSeeds() {
  const slugs = new Set()
  const duplicates = []
  const results = collectSeedGuides().map(({ fileName, absolutePath }) => {
    const raw = readJson(absolutePath)
    const guide = normalizeGuide({
      slug: raw.slug,
      title: raw.title,
      summary: raw.summary,
      body: raw.body,
      contentType: raw.contentType,
      scenario: raw.scenario,
      vehicleIds: raw.vehicleIds || [],
      tags: raw.tags || [],
      shareTitle: raw.shareTitle || raw.title
    })
    const invalidFields = validateGuide(guide)
    if (slugs.has(guide.slug)) duplicates.push(guide.slug)
    slugs.add(guide.slug)
    return { fileName, guide, invalidFields }
  })
  return { results, duplicates }
}

function summarize(seedResults) {
  const { results, duplicates } = seedResults
  const passed = results.filter((item) => item.invalidFields.length === 0 && !duplicates.includes(item.guide.slug))
  const failed = results.length - passed.length
  return {
    total: results.length,
    passed: passed.length,
    failed,
    duplicates,
    items: results
  }
}

function buildPayloads({ items, publish }) {
  return items
    .filter((item) => item.invalidFields.length === 0 && !duplicates.includes(item.guide.slug))
    .map((item) => {
      const createPayload = { action: "create", guide: item.guide }
      if (!publish) return [createPayload]
      return [createPayload, { action: "publish", id: "__PLACEHOLDER__" }]
    })
    .flat()
}

function parseArgs(argv) {
  const args = argv.slice(2)
  const flags = {
    dryRun: true,
    skipExisting: true,
    publish: false
  }
  args.forEach((arg) => {
    if (arg === "--apply") flags.dryRun = false
    if (arg === "--force-overwrite") flags.skipExisting = false
    if (arg === "--publish") flags.publish = true
  })
  return flags
}

function printReport(summary, flags) {
  const mode = flags.dryRun ? "DRY-RUN" : "APPLY"
  const publishHint = flags.publish ? " + publish" : ""
  console.log(`[bootstrapContentDrafts] mode=${mode}${publishHint} total=${summary.total} passed=${summary.passed} failed=${summary.failed}`)
  summary.items.forEach((item) => {
    const invalidHint = item.invalidFields.length ? ` invalid=${item.invalidFields.join(",")}` : ""
    const duplicateHint = summary.duplicates.includes(item.guide.slug) ? " DUPLICATE_SLUG" : ""
    console.log(`  - ${item.fileName}: slug=${item.guide.slug} scenario=${item.guide.scenario} contentType=${item.guide.contentType}${invalidHint}${duplicateHint}`)
  })
  if (summary.failed > 0) {
    console.error(`[bootstrapContentDrafts] FAIL: ${summary.failed} seeds invalid or duplicated`)
  } else {
    console.log(`[bootstrapContentDrafts] OK: all ${summary.passed} seeds valid. Use --apply to invoke contentGuideManage action=create via cloud function (local CLI only prints payloads).`)
  }
}

if (require.main === module) {
  const flags = parseArgs(process.argv)
  const seedResults = loadAndValidateSeeds()
  const summary = summarize(seedResults)
  summary.items = summary.items.map((item) => ({ ...item, guide: { ...item.guide, body: undefined } }))
  printReport(summary, flags)
  if (summary.failed > 0) {
    process.exit(1)
  }
  if (!flags.dryRun) {
    console.log("[bootstrapContentDrafts] APPLY mode will be executed by cloud call with admin openid. Local CLI outputs CREATE payloads:")
    summary.items.forEach((item) => {
      if (item.invalidFields.length || summary.duplicates.includes(item.guide.slug)) return
      console.log(JSON.stringify({ action: "create", guide: item.guide, _hint: "Invoke contentGuideManage with admin wx cloud call then record id for step 2 publish." }))
      if (flags.publish) {
        console.log(JSON.stringify({ action: "publish", id: "__REPLACE_WITH_CREATE_RESULT_ID__", _hint: "Step 2: publish after create returns valid id." }))
      }
    })
  }
  process.exit(0)
}

module.exports = {
  PROJECT_ROOT,
  SEED_DIR,
  collectSeedGuides,
  loadAndValidateSeeds,
  summarize,
  normalizeGuide,
  validateGuide,
  CONTENT_TYPES,
  SCENARIOS,
  ID_PATTERN
}
