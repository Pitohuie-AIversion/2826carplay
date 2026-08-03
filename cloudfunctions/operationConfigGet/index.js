const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const OPERATION_CONFIG_FIELDS = {
  value: true
}
const CONFIG_KEY = "operation_settings"
const LEGACY_GARAGE_SUBTITLE = "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页"
const DEFAULT_CONFIG = {
  brandName: "极境车库",
  servicePhone: "15715710090",
  mineUserDesc: "查看预约、个人信息申请与车库服务",
  garagePageTitle: "极境车库",
  garagePageSubtitle: "甄选座驾，为每一次出发预留专属席位",
  cityOptions: ["杭州", "上海"],
  faqContent:
    "1. 预约提交后，客服会尽快联系您确认档期与细节。\n2. 车辆价格、押金与取还车规则以最终沟通结果为准。\n3. 如需取消预约，可前往【我的预约】操作。",
  rulesContent:
    "1. 车辆展示信息仅供参考，具体以客服最终确认为准。\n2. 预约不代表最终成交，需以档期、资质与规则审核结果为准。\n3. 平台保留对异常预约、恶意占用档期等行为的处理权利。",
  bookingStatusTemplateId: "",
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

function normalizeConfig(raw) {
  const input = raw && typeof raw === "object" ? raw : {}
  const mineUserDesc = normalizeText(input.mineUserDesc, 80)
  const garagePageSubtitle = normalizeText(input.garagePageSubtitle, 80)
  const bookingPrivacyTip = normalizeText(input.bookingPrivacyTip, 300)
  const cityOptions = Array.isArray(input.cityOptions)
    ? input.cityOptions
        .map((item) => normalizeText(item, 20))
        .filter(Boolean)
        .slice(0, 20)
    : DEFAULT_CONFIG.cityOptions.slice()

  return {
    brandName: normalizeText(input.brandName, 20) || DEFAULT_CONFIG.brandName,
    servicePhone: normalizeText(input.servicePhone, 20) || DEFAULT_CONFIG.servicePhone,
    mineUserDesc:
      !mineUserDesc || mineUserDesc === "静态展示页，更多个人功能将在后续版本完善"
        ? DEFAULT_CONFIG.mineUserDesc
        : mineUserDesc,
    garagePageTitle: normalizeText(input.garagePageTitle, 20) || DEFAULT_CONFIG.garagePageTitle,
    garagePageSubtitle:
      !garagePageSubtitle || garagePageSubtitle === LEGACY_GARAGE_SUBTITLE
        ? DEFAULT_CONFIG.garagePageSubtitle
        : garagePageSubtitle,
    cityOptions: cityOptions.length ? cityOptions : DEFAULT_CONFIG.cityOptions.slice(),
    faqContent: normalizeText(input.faqContent, 1000) || DEFAULT_CONFIG.faqContent,
    rulesContent: normalizeText(input.rulesContent, 1000) || DEFAULT_CONFIG.rulesContent,
    bookingStatusTemplateId: normalizeText(input.bookingStatusTemplateId, 128),
    bookingPrivacyTip:
      !bookingPrivacyTip ||
      bookingPrivacyTip ===
        "提交预约即表示您同意我们仅将所填信息用于本次车辆预约沟通与联系确认。您可在【我的预约】查看与取消；如需删除预约记录或个人信息，请联系管理员处理。车辆档期、价格、押金及取还车规则以客服最终确认为准。"
        ? DEFAULT_CONFIG.bookingPrivacyTip
        : bookingPrivacyTip
  }
}

exports.main = async () => {
  try {
    const res = await db
      .collection("app_configs")
      .where({ key: CONFIG_KEY })
      .field(OPERATION_CONFIG_FIELDS)
      .limit(1)
      .get()
    const list = res && Array.isArray(res.data) ? res.data : []
    const current = list.length ? list[0] : null

    return {
      ok: true,
      config: normalizeConfig(current && current.value)
    }
  } catch (error) {
    console.error({
      function: "operationConfigGet",
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })

    return {
      ok: true,
      config: { ...DEFAULT_CONFIG }
    }
  }
}
