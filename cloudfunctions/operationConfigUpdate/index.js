const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_KEY = "operation_settings"
const DEFAULT_CONFIG = {
  brandName: "极境车库",
  servicePhone: "15715710090",
  mineUserDesc: "静态展示页，更多个人功能将在后续版本完善",
  garagePageTitle: "极境车库",
  garagePageSubtitle: "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页",
  cityOptions: ["杭州", "上海"],
  faqContent:
    "1. 预约提交后，客服会尽快联系您确认档期与细节。\n2. 车辆价格、押金与取还车规则以最终沟通结果为准。\n3. 如需取消预约，可前往【我的预约】操作。",
  rulesContent:
    "1. 车辆展示信息仅供参考，具体以客服最终确认为准。\n2. 预约不代表最终成交，需以档期、资质与规则审核结果为准。\n3. 平台保留对异常预约、恶意占用档期等行为的处理权利。",
  bookingPrivacyTip:
    "提交预约即表示您同意我们仅将所填信息用于本次车辆预约沟通与联系确认。您可在【我的预约】查看与取消；如需删除预约记录或个人信息，请联系管理员处理。车辆档期、价格、押金及取还车规则以客服最终确认为准。"
}

function normalizeText(value, maxLen) {
  const text = String(value || "").trim()
  if (!text) {
    return ""
  }

  return maxLen && text.length > maxLen ? text.slice(0, maxLen) : text
}

function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {}
  const cityOptions = Array.isArray(input.cityOptions)
    ? input.cityOptions
        .map((item) => normalizeText(item, 20))
        .filter(Boolean)
        .slice(0, 20)
    : DEFAULT_CONFIG.cityOptions.slice()

  return {
    brandName: normalizeText(input.brandName, 20) || DEFAULT_CONFIG.brandName,
    servicePhone: normalizeText(input.servicePhone, 20) || DEFAULT_CONFIG.servicePhone,
    mineUserDesc: normalizeText(input.mineUserDesc, 80) || DEFAULT_CONFIG.mineUserDesc,
    garagePageTitle: normalizeText(input.garagePageTitle, 20) || DEFAULT_CONFIG.garagePageTitle,
    garagePageSubtitle: normalizeText(input.garagePageSubtitle, 80) || DEFAULT_CONFIG.garagePageSubtitle,
    cityOptions: cityOptions.length ? cityOptions : DEFAULT_CONFIG.cityOptions.slice(),
    faqContent: normalizeText(input.faqContent, 1000) || DEFAULT_CONFIG.faqContent,
    rulesContent: normalizeText(input.rulesContent, 1000) || DEFAULT_CONFIG.rulesContent,
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

  return {
    changedKeys,
    before: changedKeys.reduce((acc, key) => ({ ...acc, [key]: before[key] }), {}),
    after: changedKeys.reduce((acc, key) => ({ ...acc, [key]: after[key] }), {})
  }
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

  const res = await db.collection("roles").where({ openid }).limit(20).get()
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

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const config = normalizeConfig(event && event.config)

  try {
    const allowed = await isAdminOpenid(openid)
    if (!allowed) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "权限不足"
      }
    }

    const existedRes = await db.collection("app_configs").where({ key: CONFIG_KEY }).limit(1).get()
    const existedList = existedRes && Array.isArray(existedRes.data) ? existedRes.data : []
    const existed = existedList.length ? existedList[0] : null
    const now = db.serverDate()
    const payload = {
      key: CONFIG_KEY,
      value: config,
      updatedAt: now,
      updatedByOpenid: openid
    }

    if (existedList.length) {
      await db.collection("app_configs").doc(existedList[0]._id).update({
        data: payload
      })
    } else {
      await db.collection("app_configs").add({
        data: {
          ...payload,
          createdAt: now,
          createdByOpenid: openid
        }
      })
    }

    const diff = diffConfig(existed && existed.value, config)
    await writeAuditLogBestEffort({
      openid,
      action: "operationConfigUpdate",
      changedKeys: diff.changedKeys,
      before: diff.before,
      after: diff.after
    })

    return {
      ok: true,
      config,
      message: "运营配置已保存"
    }
  } catch (error) {
    console.error({
      function: "operationConfigUpdate",
      openid,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "保存运营配置失败，请稍后重试"
    }
  }
}
