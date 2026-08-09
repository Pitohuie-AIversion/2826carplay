const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const OPERATION_CONFIG_FIELDS = {
  value: true
}
const CONFIG_KEY = "operation_settings"
const LEGACY_GARAGE_SUBTITLE = "后台车辆资料已接入首页展示，上传封面后会同步展示到车库首页"
const DEFAULT_RENTAL_TERMS = {
  includedText: "基础日租仅包含车辆使用费，其他项目会在正式报价前单独列明。",
  protectionText: "基础保障内容根据车型与租期确认，不默认包含额外保障服务。",
  serviceFeeText: "如有车辆整备或门店服务费，将在报价明细中单独列示。",
  deliveryFeeText: "取送车服务及费用按城市、距离和时段确认，无该服务时不收费。",
  depositText: "车辆押金与违章押金的金额、支付方式和退还时间会在确认前明确告知。",
  cancellationText: "预约提交后可取消；顾问确认后的取消或改期规则以有效报价说明为准。",
  overtimeText: "超时用车费用按最终确认的计费规则执行，产生前由顾问说明。",
  energyText: "取还车油量或电量标准会在交付前确认，并以交接记录为准。",
  estimateDisclaimer: "页面价格为基础日租参考，不是正式报价，提交预约也不会自动锁定车辆。"
}
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
    rentalTerms: normalizeRentalTerms(input.rentalTerms),
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
