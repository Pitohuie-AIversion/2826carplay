const fs = require("fs")
const path = require("path")
const cloudbase = require("@cloudbase/node-sdk")
const {
  loadAndValidateSeeds,
  summarize,
  SEED_DIR
} = require("./bootstrapContentDrafts.js")

const ENV_ID = "cloud1-d8gtmns36320e045e"
const REGION = "ap-shanghai"

const ADMIN_OPENID = "system_bootstrap_admin"

const JUNK_IDS_TO_CLEANUP = [
  "c1dc89f26aa247c302753c2b01d2fac6",
  "a8add1456aa2487501f1ed6e441bbcb4",
  "test_set_1789020276948"
]

function parseArgs(argv) {
  const args = argv.slice(2)
  const opts = {
    secretId: process.env.TENCENT_SECRET_ID || "",
    secretKey: process.env.TENCENT_SECRET_KEY || "",
    dryRun: true,
    overwrite: false,
    cleanupJunk: false
  }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === "--secret-id" && args[i + 1]) { opts.secretId = args[++i]; continue }
    if (a === "--secret-key" && args[i + 1]) { opts.secretKey = args[++i]; continue }
    if (a === "--apply") { opts.dryRun = false; continue }
    if (a === "--force-overwrite") { opts.overwrite = true; continue }
    if (a === "--cleanup") { opts.cleanupJunk = true; continue }
  }
  return opts
}

function mask(s) {
  if (!s || s.length < 6) return "***"
  return s.slice(0, 4) + "***" + s.slice(-3)
}

async function main() {
  const opts = parseArgs(process.argv)
  console.log(`[runContentDraftsUpload] env=${ENV_ID} region=${REGION} secretId=${mask(opts.secretId)} secretKey=${mask(opts.secretKey)} dryRun=${opts.dryRun} overwrite=${opts.overwrite} cleanupJunk=${opts.cleanupJunk}`)

  if (!opts.secretId || !opts.secretKey) {
    console.error("[runContentDraftsUpload] FAIL: SecretId/SecretKey missing. Provide via --secret-id/--secret-key or env TENCENT_SECRET_ID/TENCENT_SECRET_KEY.")
    process.exit(1)
  }

  const seedResults = loadAndValidateSeeds()
  const summary = summarize(seedResults)
  if (summary.failed > 0) {
    console.error(`[runContentDraftsUpload] FAIL: ${summary.failed} seeds invalid or duplicated.`)
    summary.items.forEach((it) => {
      if (it.invalidFields.length) console.error(`  - ${it.fileName}: invalid=${it.invalidFields.join(",")}`)
    })
    if (summary.duplicates.length) console.error(`  - DUPLICATE_SLUG: ${summary.duplicates.join(",")}`)
    process.exit(1)
  }
  const validItems = summary.items.filter((it) => !it.invalidFields.length && !summary.duplicates.includes(it.guide.slug))
  console.log(`[runContentDraftsUpload] OK: ${validItems.length}/${summary.total} seeds valid.`)

  let cloudApp
  let db
  if (!opts.dryRun) {
    try {
      cloudApp = cloudbase.init({ env: ENV_ID, region: REGION, secretId: opts.secretId, secretKey: opts.secretKey })
      db = cloudApp.database()
    } catch (e) {
      console.error(`[runContentDraftsUpload] FAIL: CloudBase init error: ${e.message}`)
      process.exit(1)
    }
  }

  if (opts.cleanupJunk && !opts.dryRun) {
    console.log(`\n========== CLEANUP JUNK (${JUNK_IDS_TO_CLEANUP.length} ids) ==========`)
    for (const id of JUNK_IDS_TO_CLEANUP) {
      try {
        await db.collection("content_guides").doc(id).remove()
        console.log(`  - removed junk doc: _id=${id}`)
      } catch (e) {
        console.warn(`  - skip (not found or err): _id=${id} err=${e.message}`)
      }
    }
  }

  const results = []
  for (let i = 0; i < validItems.length; i++) {
    const item = validItems[i]
    const guide = item.guide
    const seq = i + 1
    console.log(`\n=== [${seq}/${validItems.length}] slug=${guide.slug} scenario=${guide.scenario} type=${guide.contentType} ===`)

    let existing = null
    if (!opts.dryRun) {
      const q = await db.collection("content_guides").where({ slug: guide.slug }).field({ _id: true, slug: true, status: true }).limit(2).get()
      const list = Array.isArray(q.data) ? q.data : []
      if (Array.isArray(q)) existing = q.length ? q[0] : null
      else if (Array.isArray(list)) existing = list.length ? list[0] : null
    }
    if (existing) console.log(`  - existing found: _id=${existing._id} slug=${existing.slug} status=${existing.status}`)
    else console.log(`  - no existing, will create new`)

    let contentId = existing ? existing._id : null
    let actionWasCreate = false

    if (!existing) {
      const createData = {
        slug: guide.slug,
        title: guide.title,
        summary: guide.summary,
        body: guide.body,
        contentType: guide.contentType,
        scenario: guide.scenario,
        vehicleIds: Array.isArray(guide.vehicleIds) ? guide.vehicleIds : [],
        tags: Array.isArray(guide.tags) ? guide.tags : [],
        shareTitle: guide.shareTitle || guide.title,
        status: "draft",
        createdAt: db.serverDate(),
        updatedAt: db.serverDate()
      }
      if (!opts.dryRun) {
        const addRes = await db.collection("content_guides").add(createData)
        contentId = String(addRes && (addRes._id || addRes.id) || "")
        actionWasCreate = true
        console.log(`  - CREATE ok: id=${contentId}`)
      } else {
        console.log(`  - [DRY-RUN] would CREATE slug=${guide.slug}`)
      }
    } else if (opts.overwrite) {
      const updateData = {
        title: guide.title,
        summary: guide.summary,
        body: guide.body,
        contentType: guide.contentType,
        scenario: guide.scenario,
        vehicleIds: Array.isArray(guide.vehicleIds) ? guide.vehicleIds : [],
        tags: Array.isArray(guide.tags) ? guide.tags : [],
        shareTitle: guide.shareTitle || guide.title,
        updatedAt: db.serverDate()
      }
      if (!opts.dryRun) {
        await db.collection("content_guides").doc(contentId).update(updateData)
        console.log(`  - UPDATE ok (--force-overwrite): id=${contentId}`)
      } else {
        console.log(`  - [DRY-RUN] would UPDATE slug=${guide.slug}`)
      }
    } else {
      console.log(`  - SKIP create/update: existing and no --force-overwrite`)
    }

    const needsPublish = !existing || existing.status !== "published" || opts.overwrite
    let publishStatus = needsPublish ? "published" : (existing ? existing.status : "draft")
    if (!needsPublish) {
      console.log(`  - SKIP publish: already status=${publishStatus}`)
    } else if (!opts.dryRun && contentId) {
      await db.collection("content_guides").doc(contentId).update({
        status: "published",
        updatedAt: db.serverDate(),
        publishedAt: db.serverDate()
      })
      console.log(`  - PUBLISH ok: id=${contentId} status=published`)
      publishStatus = "published"
    } else if (opts.dryRun) {
      console.log(`  - [DRY-RUN] would PUBLISH`)
    }

    if (!opts.dryRun && contentId) {
      try {
        const createAudit = actionWasCreate || !existing
        const auditCreateData = {
          openid: ADMIN_OPENID,
          action: createAudit ? "contentGuide.create" : (opts.overwrite ? "contentGuide.update" : "contentGuide.publish"),
          contentId,
          createdAt: db.serverDate()
        }
        await db.collection("audit_logs").add(auditCreateData)
        if (needsPublish && createAudit) {
          await db.collection("audit_logs").add({
            openid: ADMIN_OPENID,
            action: "contentGuide.publish",
            contentId,
            createdAt: db.serverDate()
          })
        }
        console.log(`  - AUDIT ok`)
      } catch (auditErr) {
        console.warn(`  - AUDIT WARN (non-fatal): ${auditErr.message}`)
      }
    }

    results.push({
      seq,
      slug: guide.slug,
      contentType: guide.contentType,
      scenario: guide.scenario,
      id: contentId,
      status: publishStatus
    })
  }

  console.log(`\n========== SUMMARY ==========`)
  results.forEach((r) => console.log(`  [${r.seq}] ${r.slug} -> id=${r.id || "???"} status=${r.status}`))

  let smokeAllPublished = results.every((r) => r.status === "published")

  if (!opts.dryRun) {
    console.log(`\n========== SMOKE VERIFY (query content_guides where slug in [5 seeds]) ==========`)
    const slugs = validItems.map((it) => it.guide.slug)
    const allDocs = await db.collection("content_guides").limit(50).field({ _id: true, slug: true, status: true, contentType: true, scenario: true, publishedAt: true }).get()
    const list = Array.isArray(allDocs) ? allDocs : (Array.isArray(allDocs.data) ? allDocs.data : [])
    const targetRows = list.filter((row) => slugs.includes(row.slug))
    console.log(`  matched rows: ${targetRows.length}/${list.length}`)
    targetRows.forEach((row) => {
      const ok = row.status === "published"
      if (!ok) smokeAllPublished = false
      console.log(`    ${ok ? "✅" : "❌"} _id=${row._id} slug=${row.slug} status=${row.status} contentType=${row.contentType} scenario=${row.scenario}`)
    })
  }

  if (!opts.dryRun) {
    console.log(`\n[runContentDraftsUpload] ${smokeAllPublished ? "✅ ALL SUCCESS" : "⚠️  PARTIAL"}: ${results.filter(r => r.status === "published").length}/${results.length} published.`)
    process.exit(smokeAllPublished ? 0 : 2)
  } else {
    console.log(`\n[runContentDraftsUpload] DRY-RUN done. Re-run with --apply to actually execute. Add --cleanup first to remove junk debug rows.`)
    process.exit(0)
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[runContentDraftsUpload] FATAL: ${e.message}`)
    console.error(e.stack)
    process.exit(1)
  })
}

module.exports = { ENV_ID, REGION, ADMIN_OPENID }
