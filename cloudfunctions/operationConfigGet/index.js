const cloud = require("wx-server-sdk")
const { normalizeServiceConfig, validateServiceConfig, validateCityOptions } = require("./serviceConfig")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const OPERATION_CONFIG_FIELDS = {
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
  wxKfCorpId: "",
  wxKfExtInfo: "",
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

function normalizeRentalTerms(raw) {
  const input = raw && typeof raw === "object" ? raw : {}
  return Object.keys(DEFAULT_RENTAL_TERMS).reduce((result, key) => {
    result[key] = normalizeText(input[key], 200) || DEFAULT_RENTAL_TERMS[key]
    return result
  }, {})
}

function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {}
  const mineUserDesc = normalizeText(input.mineUserDesc, 80)
  const garagePageSubtitle = normalizeText(input.garagePageSubtitle, 80)
  const bookingPrivacyTip = normalizeText(input.bookingPrivacyTip, 300)
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
    wxKfCorpId: normalizeText(input.wxKfCorpId, 64),
    wxKfExtInfo: normalizeText(input.wxKfExtInfo, 512),
    mineUserDesc: mineUserDesc || DEFAULT_CONFIG.mineUserDesc,
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
    bookingPrivacyTip: bookingPrivacyTip || DEFAULT_CONFIG.bookingPrivacyTip
  }
}

exports.main = async (event) => {
  try {
    const res = await db
      .collection("app_configs")
      .where({ key: CONFIG_KEY })
      .field(OPERATION_CONFIG_FIELDS)
      .limit(2)
      .get()
    const list = res && Array.isArray(res.data) ? res.data : []
    if (list.length > 1) {
      return { ok: false, code: "CONFIG_CONFLICT", message: "存在重复运营配置，请管理员核对后重试" }
    }
    const current = list.length ? list[0] : null
    if (current && event && event.requireStoredConfig) {
      const stored = current.value || {}
      const error = validateServiceConfig(stored) || validateCityOptions(stored.cityOptions)
      if (error) {
        return { ok: false, code: "STORED_CONFIG_INVALID", message: "已保存配置存在无效字段，请核对后再编辑", details: { errors: [error] } }
      }
    }

    return {
      ok: true,
      revision: Number.isSafeInteger(current && current.revision) ? current.revision : 0,
      config: normalizeConfig(current && current.value)
    }
  } catch (error) {
    console.error({
      function: "operationConfigGet",
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    if (event && event.requireStoredConfig) {
      return { ok: false, code: "CONFIG_UNAVAILABLE", message: "线上配置读取失败，请重试" }
    }
    return {
      ok: true,
      config: { ...DEFAULT_CONFIG }
    }
  }
}
