const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const AUTH_ROLE_FIELDS = { role: true, roles: true, permissions: true, isAdmin: true, admin: true }
const CONTENT_TYPES = ["route", "guide", "vehicle_advice", "handover_guide", "vehicle_tip"]
const SCENARIOS = ["weekend_trip", "business_reception", "group_travel", "ev_experience", "handover_tips"]
const ACTIONS = ["create", "update", "publish", "archive"]
const ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

function error(code, message, details) {
  return { ok: false, code, message, ...(details ? { details } : {}) }
}

function text(value, max) {
  return String(value || "").trim().slice(0, max)
}

function trimmedString(value) {
  return typeof value === "string" ? value.trim() : ""
}

function strings(value, maxItems, maxLength) {
  return Array.from(new Set((Array.isArray(value) ? value : [])
    .map((item) => text(item, maxLength)).filter(Boolean))).slice(0, maxItems)
}

function isAdmin(record) {
  return Boolean(record && (record.role === "admin" || record.isAdmin === true || record.admin === true ||
    (Array.isArray(record.roles) && record.roles.includes("admin")) ||
    (Array.isArray(record.permissions) && record.permissions.includes("admin"))))
}

async function canManage(openid) {
  if (!openid) return false
  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  return (res && Array.isArray(res.data) ? res.data : []).some(isAdmin)
}

function normalizeGuide(input) {
  input = input && typeof input === "object" && !Array.isArray(input) ? input : {}
  return {
    slug: trimmedString(input.slug),
    title: text(input.title, 100),
    summary: text(input.summary, 300),
    body: text(input.body, 20000),
    contentType: text(input.contentType, 32),
    scenario: text(input.scenario, 32),
    vehicleIds: Array.from(new Set((Array.isArray(input.vehicleIds) ? input.vehicleIds : [])
      .map(trimmedString).filter((id) => ID_PATTERN.test(id)))).slice(0, 20),
    tags: strings(input.tags, 20, 30),
    shareTitle: text(input.shareTitle, 100)
  }
}

function validateGuide(guide) {
  const fields = []
  if (!ID_PATTERN.test(guide.slug)) fields.push(`slug(${guide.slug})`)
  if (!guide.title) fields.push("title")
  if (!guide.summary) fields.push("summary")
  if (!guide.body) fields.push("body")
  if (!CONTENT_TYPES.includes(guide.contentType)) fields.push(`contentType(${guide.contentType})`)
  if (!SCENARIOS.includes(guide.scenario)) fields.push(`scenario(${guide.scenario})`)
  return fields
}

async function slugExists(slug, excludedId) {
  const res = await db.collection("content_guides").where({ slug }).field({ _id: true }).limit(2).get()
  return (res && Array.isArray(res.data) ? res.data : []).some((item) => item._id !== excludedId)
}

async function audit(openid, action, contentId) {
  try {
    await db.collection("audit_logs").add({ data: { openid, action: `contentGuide.${action}`, contentId, createdAt: db.serverDate() } })
  } catch (ignored) {}
}

async function updateExistingGuide(id, data) {
  const result = await db.collection("content_guides").doc(id).update({ data })
  const updated = result && result.stats && result.stats.updated
  if (updated === 0) return false
  if (updated !== 1) throw new Error("Unexpected content update result")
  return true
}

module.exports._test = { normalizeGuide, text, strings, validateGuide }

exports.main = async (event) => {
  const openid = String((cloud.getWXContext() || {}).OPENID || "")
  const input = event && typeof event === "object" ? event : {}
  const action = trimmedString(input.action)
  const id = trimmedString(input.id)
  try {
    if (!(await canManage(openid))) return error("FORBIDDEN", "仅管理员可以维护内容")
    if (!ACTIONS.includes(action)) return error("VALIDATION_ERROR", "内容操作不支持")

    if (action === "create" || action === "update") {
      const guide = normalizeGuide(input.guide)
      const invalidFields = validateGuide(guide)
      if (invalidFields.length) return error("VALIDATION_ERROR", "内容字段校验失败", { fields: invalidFields })
      if (action === "update" && !ID_PATTERN.test(id)) return error("VALIDATION_ERROR", "内容 ID 格式不正确")
      if (await slugExists(guide.slug, action === "update" ? id : "")) return error("DUPLICATE_SLUG", "内容 slug 已存在")
      let contentId = id
      if (action === "create") {
        const res = await db.collection("content_guides").add({ data: { ...guide, status: "draft", createdAt: db.serverDate(), updatedAt: db.serverDate() } })
        contentId = String(res && (res._id || res.id) || "")
      } else {
        if (!(await updateExistingGuide(id, { ...guide, updatedAt: db.serverDate() }))) {
          return error("NOT_FOUND", "内容不存在或已删除")
        }
      }
      await audit(openid, action, contentId)
      return { ok: true, id: contentId, status: action === "create" ? "draft" : undefined }
    }

    if (!ID_PATTERN.test(id)) return error("VALIDATION_ERROR", "内容 ID 格式不正确")
    const nextStatus = action === "publish" ? "published" : "archived"
    const data = { status: nextStatus, updatedAt: db.serverDate() }
    if (action === "publish") data.publishedAt = db.serverDate()
    if (!(await updateExistingGuide(id, data))) {
      return error("NOT_FOUND", "内容不存在或已删除")
    }
    await audit(openid, action, id)
    return { ok: true, id, status: nextStatus }
  } catch (err) {
    console.error({
      function: "contentGuideManage",
      action: ACTIONS.includes(action) ? action : "",
      id: ID_PATTERN.test(id) ? id : "",
      authenticated: Boolean(openid),
      errorMessage: String(err && (err.message || err.errMsg) || err)
    })
    return error("INTERNAL_ERROR", "内容维护失败")
  }
}

// For testing purposes
if (process.env.NODE_ENV === 'test') {
  exports.text = text;
  exports.strings = strings;
  exports.isAdmin = isAdmin;
}
