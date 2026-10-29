const cloudbase = require("@cloudbase/node-sdk")
const {
  loadAndValidateSeeds,
  summarize,
  ID_PATTERN
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

function validId(id) {
  return typeof id === "string" && ID_PATTERN.test(id)
}

async function findGuides(db, slug) {
  const result = await db.collection("content_guides").where({ slug })
    .field({ _id: true, slug: true, status: true }).limit(2).get()
  if (!result || result.code || !Array.isArray(result.data)) {
    throw new Error(`Invalid content query result: slug=${slug}`)
  }
  return result.data
}

async function updateGuide(db, id, data) {
  const result = await db.collection("content_guides").doc(id).update(data)
  if (!result || result.code || result.updated !== 1) {
    throw new Error(`Content update was not confirmed: id=${id}`)
  }
}

async function audit(db, action, contentId) {
  try {
    await db.collection("audit_logs").add({
      openid: ADMIN_OPENID, action: `contentGuide.${action}`, contentId, createdAt: db.serverDate()
    })
  } catch (auditErr) {
    console.warn(`  - AUDIT WARN (non-fatal): action=${action} id=${contentId} ${auditErr.message}`)
  }
}

async function main(argv = process.argv) {
  const opts = parseArgs(argv)
  console.log(`[runContentDraftsUpload] env=${ENV_ID} region=${REGION} dryRun=${opts.dryRun} overwrite=${opts.overwrite} cleanupJunk=${opts.cleanupJunk}`)

  if (!opts.dryRun && (!opts.secretId || !opts.secretKey)) {
    console.error("[runContentDraftsUpload] FAIL: SecretId/SecretKey missing. Provide via --secret-id/--secret-key or env TENCENT_SECRET_ID/TENCENT_SECRET_KEY.")
    return 1
  }

  const seedResults = loadAndValidateSeeds()
  const summary = summarize(seedResults)
  if (summary.failed > 0) {
    console.error(`[runContentDraftsUpload] FAIL: ${summary.failed} seeds invalid or duplicated.`)
    summary.items.forEach((it) => {
      if (it.invalidFields.length) console.error(`  - ${it.fileName}: invalid=${it.invalidFields.join(",")}`)
    })
    if (summary.duplicates.length) console.error(`  - DUPLICATE_SLUG: ${summary.duplicates.join(",")}`)
    return 1
  }
  const validItems = summary.items.filter((it) => !it.invalidFields.length && !summary.duplicates.includes(it.guide.slug))
  console.log(`[runContentDraftsUpload] OK: ${validItems.length}/${summary.total} seeds valid.`)

  if (opts.dryRun) {
    for (const { guide } of validItems) {
      console.log(`  - [DRY-RUN] slug=${guide.slug}: CREATE if absent; ${opts.overwrite ? "UPDATE existing; PUBLISH" : "PUBLISH unless already published"}`)
    }
    if (opts.cleanupJunk) console.log(`  - [DRY-RUN] would request cleanup of ${JUNK_IDS_TO_CLEANUP.length} configured debug rows`)
    console.log("[runContentDraftsUpload] DRY-RUN done. Cloud state was not queried. Re-run with --apply to execute.")
    return 0
  }

  let db
  try {
    const cloudApp = cloudbase.init({ env: ENV_ID, region: REGION, secretId: opts.secretId, secretKey: opts.secretKey })
    db = cloudApp.database()
  } catch (e) {
    console.error(`[runContentDraftsUpload] FAIL: CloudBase init error: ${e.message}`)
    return 1
  }

  if (opts.cleanupJunk) {
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

    const matches = await findGuides(db, guide.slug)
    if (matches.length > 1) throw new Error(`Multiple content records found: slug=${guide.slug}`)
    const existing = matches[0]
    if (matches.length && (!existing || !validId(existing._id) || existing.slug !== guide.slug)) {
      throw new Error(`Invalid existing content record: slug=${guide.slug}`)
    }
    if (existing) console.log(`  - existing found: _id=${existing._id} slug=${existing.slug} status=${existing.status}`)
    else console.log(`  - no existing, will create new`)

    let contentId = existing ? existing._id : null

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
      const addRes = await db.collection("content_guides").add(createData)
      contentId = addRes && (addRes.id === undefined ? addRes._id : addRes.id)
      if (!addRes || addRes.code || !validId(contentId)) {
        throw new Error(`Content creation was not confirmed: slug=${guide.slug}`)
      }
      console.log(`  - CREATE ok: id=${contentId}`)
      await audit(db, "create", contentId)
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
      await updateGuide(db, contentId, updateData)
      console.log(`  - UPDATE ok (--force-overwrite): id=${contentId}`)
      await audit(db, "update", contentId)
    } else {
      console.log(`  - SKIP create/update: existing and no --force-overwrite`)
    }

    const needsPublish = !existing || existing.status !== "published" || opts.overwrite
    if (!needsPublish) {
      console.log("  - SKIP publish: already status=published")
    } else {
      await updateGuide(db, contentId, {
        status: "published",
        updatedAt: db.serverDate(),
        publishedAt: db.serverDate()
      })
      console.log(`  - PUBLISH ok: id=${contentId} status=published`)
      await audit(db, "publish", contentId)
    }

    results.push({
      seq,
      slug: guide.slug,
      contentType: guide.contentType,
      scenario: guide.scenario,
      id: contentId,
      status: "published"
    })
  }

  console.log(`\n========== SUMMARY ==========`)
  results.forEach((r) => console.log(`  [${r.seq}] ${r.slug} -> id=${r.id || "???"} status=${r.status}`))

  console.log("\n========== VERIFY (query each target slug) ==========")
  let verified = 0
  for (const result of results) {
    const rows = await findGuides(db, result.slug)
    const row = rows[0]
    const ok = rows.length === 1 && row && row._id === result.id &&
      row.slug === result.slug && row.status === "published"
    if (ok) verified++
    console.log(`  ${ok ? "OK" : "FAIL"} slug=${result.slug} expectedId=${result.id} matches=${rows.length}`)
  }
  const allVerified = verified === results.length
  console.log(`\n[runContentDraftsUpload] ${allVerified ? "ALL SUCCESS" : "PARTIAL"}: ${verified}/${results.length} records verified as published.`)
  return allVerified ? 0 : 2
}

if (require.main === module) {
  main().then((code) => { process.exitCode = code }).catch((e) => {
    console.error(`[runContentDraftsUpload] FATAL: ${e.message}`)
    console.error(e.stack)
    process.exitCode = 1
  })
}

module.exports = { ENV_ID, REGION, ADMIN_OPENID, main }
