const cloud = require("wx-server-sdk")
const { normalizeServiceConfig, validateServiceConfig, validateCityOptions } = require("./serviceConfig")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const AUTH_ROLE_FIELDS = {
  role: true,
  roles: true,
  permissions: true,
  isAdmin: true,
  admin: true
}
const OPERATION_CONFIG_UPDATE_FIELDS = {
  _id: true,
  key: true,
  value: true,
  revision: true
}
const CONFIG_KEY = "operation_settings"
const DEFAULT_RENTAL_TERMS = {
  includedText: "",
  protectionText: "",
  serviceFeeText: "",
  deliveryFeeText: "",
  depositText: "",
  cancellationText: "",
  overtimeText: "",
  energyText: "",
  estimateDisclaimer: ""
}
const DEFAULT_CONFIG = {
  ...normalizeServiceConfig({}),
  brandName: "极境车库",
  servicePhone: "",
  mineUserDesc: "查看预约、个人信息申请与车库服务",
  garagePageTitle: "极境车库",
  garagePageSubtitle: "甄选座驾，为每一次出发预留专属席位",
  cityOptions: ["杭州", "上海"],
  faqContent: "",
  rulesContent: "",
  bookingStatusTemplateId: "",
  rentalTerms: DEFAULT_RENTAL_TERMS,
  bookingPrivacyTip:
    "提交预约即表示您同意我们仅将所填信息用于本次车辆预约沟通与联系确认。您可在【我的预约】查看、修改联系信息与取消；如需查询、更正或删除其他个人信息，请前往【个人信息申请】。车辆档期、价格、押金及取还车规则以客服最终确认为准。"
}

function normalizeText(value, maxLen) {
  const text = String(value || "").trim()
  if (!text) {
    return ""
  }

  return maxLen && text.length > maxLen ? text.slice(0, maxLen) : text
}

function isValidServicePhone(value) {
  const phone = String(value || "").trim()
  const digitCount = phone.replace(/\D/g, "").length
  return /^\+?[0-9-]{6,20}$/.test(phone) && digitCount >= 6 && digitCount <= 15
}

function normalizeRentalTerms(raw) {
  const input = raw && typeof raw === "object" ? raw : {}
  return Object.keys(DEFAULT_RENTAL_TERMS).reduce((result, key) => {
    result[key] = normalizeText(input[key], 200) || DEFAULT_RENTAL_TERMS[key]
    return result
  }, {})
}

function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {}
  const garagePageSubtitle = normalizeText(input.garagePageSubtitle, 80)
  const cityOptions = Array.isArray(input.cityOptions)
    ? input.cityOptions
        .map((item) => normalizeText(item, 20))
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index)
        .slice(0, 20)
    : DEFAULT_CONFIG.cityOptions.slice()

  return {
    ...normalizeServiceConfig(input),
    brandName: normalizeText(input.brandName, 20) || DEFAULT_CONFIG.brandName,
    servicePhone: normalizeText(input.servicePhone, 20),
    mineUserDesc: normalizeText(input.mineUserDesc, 80) || DEFAULT_CONFIG.mineUserDesc,
    garagePageTitle: normalizeText(input.garagePageTitle, 20) || DEFAULT_CONFIG.garagePageTitle,
    garagePageSubtitle:
      !garagePageSubtitle
        ? DEFAULT_CONFIG.garagePageSubtitle
        : garagePageSubtitle,
    cityOptions,
    faqContent: normalizeText(input.faqContent, 1000) || DEFAULT_CONFIG.faqContent,
    rulesContent: normalizeText(input.rulesContent, 1000) || DEFAULT_CONFIG.rulesContent,
    bookingStatusTemplateId: normalizeText(input.bookingStatusTemplateId, 128),
    rentalTerms: normalizeRentalTerms(input.rentalTerms),
    bookingPrivacyTip: normalizeText(input.bookingPrivacyTip, 300) || DEFAULT_CONFIG.bookingPrivacyTip
  }
}

function diffConfig(prev, next) {
  const before = prev && typeof prev === "object" ? prev : {}
  const after = next && typeof next === "object" ? next : {}
  const keys = Object.keys(DEFAULT_CONFIG)
  const changedKeys = keys.filter((key) => {
    const prevValue = before[key]
    const nextValue = after[key]
    return JSON.stringify(prevValue) !== JSON.stringify(nextValue)
  })

  return changedKeys
}

function hasAdminRole(record) {
  if (!record || typeof record !== "object") {
    return false
  }

  if (record.role === "admin") {
    return true
  }

  if (Array.isArray(record.roles) && record.roles.includes("admin")) {
    return true
  }

  if (record.isAdmin === true || record.admin === true) {
    return true
  }

  return false
}

async function isAdminOpenid(openid) {
  if (!openid) {
    return false
  }

  const res = await db
    .collection("roles")
    .where({ openid })
    .field(AUTH_ROLE_FIELDS)
    .limit(20)
    .get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some((item) => hasAdminRole(item))
}

async function writeAuditLogBestEffort(payload) {
  try {
    await db.collection("audit_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "operationConfigUpdate",
      stage: "auditLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

async function writeErrorLogBestEffort(payload) {
  try {
    await db.collection("error_logs").add({
      data: {
        ...payload,
        createdAt: db.serverDate()
      }
    })
  } catch (error) {
    const message = error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error)
    if (String(message).includes("Unexpected collection:")) {
      return
    }
    console.error({
      function: "operationConfigUpdate",
      stage: "errorLog",
      errorMessage: message,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const input = event && event.config

  try {
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "权限不足"
      }
    }

    if (!input || typeof input !== "object" || Array.isArray(input)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "配置格式不正确" }
    }
    const expectedRevision = event.expectedRevision
    if (expectedRevision !== undefined && (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)) {
      return { ok: false, code: "VALIDATION_ERROR", message: "配置版本不正确，请重新加载" }
    }
    const existedRes = await db.collection("app_configs").where({ key: CONFIG_KEY })
      .field(OPERATION_CONFIG_UPDATE_FIELDS).limit(2).get()
    const existedList = existedRes && Array.isArray(existedRes.data) ? existedRes.data : []
    if (existedList.length > 1) {
      return { ok: false, code: "CONFIG_CONFLICT", message: "存在重复运营配置，请管理员核对后重试" }
    }
    // Keep an existing legacy document ID; only a genuinely empty collection uses the stable ID.
    const configId = existedList.length ? existedList[0]._id : CONFIG_KEY
    const outcome = await db.runTransaction(async (transaction) => {
      const ref = transaction.collection("app_configs").doc(configId)
      let existed = null
      try {
        const currentResult = await ref.field(OPERATION_CONFIG_UPDATE_FIELDS).get()
        existed = currentResult && currentResult.data || null
      } catch (error) {
        const message = String(error && (error.errMsg || error.message || error.code) || error)
        if (!/document.*(?:not found|not exist)|DOCUMENT_NOT_FOUND|DATABASE_DOCUMENT_NOT_EXIST/i.test(message)) throw error
      }
      if (existed && existed.key !== CONFIG_KEY) {
        return { ok: false, code: "CONFIG_CONFLICT", message: "配置记录已变化，请重新加载" }
      }
      if (!existed && existedList.length) {
        return { ok: false, code: "CONFIG_CONFLICT", message: "配置记录已变化，请重新加载" }
      }
      const revision = Number.isSafeInteger(existed && existed.revision) ? existed.revision : 0
      const previous = existed && existed.value || {}
      // Preserve omitted fields for older clients; an explicit empty value clears optional fields.
      const merged = { ...previous, ...input, rentalTerms: { ...previous.rentalTerms, ...input.rentalTerms } }
      const serviceError = validateServiceConfig(merged) || validateCityOptions(merged.cityOptions)
      if (serviceError) {
        return { ok: false, code: "VALIDATION_ERROR", message: serviceError.message, details: { errors: [serviceError] } }
      }
      const config = normalizeConfig(merged)
      // A successful save must also persist normalization of legacy values and missing fields.
      // Comparing two normalized copies would report success while leaving the old record intact.
      const changedKeys = diffConfig(previous, config)
      if (existed && changedKeys.length === 0) {
        return { ok: true, config, revision, updated: false, message: "运营配置已保存" }
      }
      if (expectedRevision === undefined && revision > 0) {
        return { ok: false, code: "CONFIG_VERSION_REQUIRED", message: "请更新小程序并重新加载配置后保存" }
      }
      if (expectedRevision !== undefined && expectedRevision !== revision) {
        return { ok: false, code: "CONFIG_CONFLICT", message: "配置已被其他管理员修改，请重新加载后核对" }
      }

      if (config.servicePhone && !isValidServicePhone(config.servicePhone)) {
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          message: "客服电话格式不正确",
          details: {
            errors: [
              {
                field: "servicePhone",
                message: "客服电话仅支持数字、连字符和可选的国际区号"
              }
            ]
          }
        }
      }

      if (
        config.bookingStatusTemplateId &&
        !/^[A-Za-z0-9_-]{10,128}$/.test(config.bookingStatusTemplateId)
      ) {
        return {
          ok: false,
          code: "VALIDATION_ERROR",
          message: "订阅消息模板 ID 格式不正确",
          details: {
            errors: [
              {
                field: "bookingStatusTemplateId",
                message: "模板 ID 仅支持 10-128 位字母、数字、下划线和连字符"
              }
            ]
          }
        }
      }

      const now = db.serverDate()
      const payload = {
        key: CONFIG_KEY,
        value: config,
        revision: revision + 1,
        updatedAt: now,
        updatedByOpenid: openid
      }

      if (existed) {
        await ref.update({
          data: { ...payload, value: db.command.set(config) }
        })
      } else {
        await ref.set({
          data: {
            ...payload,
            createdAt: now,
            createdByOpenid: openid
          }
        })
      }
      return { ok: true, config, revision: revision + 1, updated: true, changedKeys, message: "运营配置已保存" }
    })
    if (!outcome.ok || !outcome.updated) return outcome
    await writeAuditLogBestEffort({
      openid,
      action: "operationConfigUpdate",
      changedKeys: outcome.changedKeys
    })

    return {
      ok: true,
      config: outcome.config,
      revision: outcome.revision,
      updated: true,
      message: "运营配置已保存"
    }
  } catch (error) {
    const errorMessage = String(
      error && (error.message || error.errMsg) ? error.message || error.errMsg : error
    ).slice(0, 300)
    console.error({
      function: "operationConfigUpdate",
      authenticated: Boolean(openid),
      errorMessage,
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    await writeErrorLogBestEffort({
      function: "operationConfigUpdate",
      stage: "main",
      authenticated: Boolean(openid),
      errorMessage,
      occurredAt: new Date().toISOString()
    })

    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "保存运营配置失败，请稍后重试"
    }
  }
}
