/**
 * 爱迦租车 - 交接留证报告与车况凭证生成器
 */

const ANGLE_LABELS = {
  front: "车头",
  rear: "车尾",
  left: "左侧",
  right: "右侧"
}

const DAMAGE_TYPE_LABELS = {
  scratch: "划痕/擦伤",
  dent: "凹坑/变形",
  wear: "正常磨损",
  paint: "漆面损伤",
  glass: "玻璃破损",
  wheel: "轮毂损伤",
  other: "其他损伤"
}

const PART_LABELS = {
  front: "车头/前保险杠",
  rear: "车尾/后保险杠",
  left: "车身左侧/车门",
  right: "车身右侧/车门",
  roof: "车顶/天窗",
  wheel_fl: "左前轮毂",
  wheel_fr: "右前轮毂",
  wheel_rl: "左后轮毂",
  wheel_rr: "右后轮毂",
  interior: "座舱内饰",
  other: "其他部位"
}

const REPORT_SESSION_ID = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
let reportExportSerial = 0

function escapeCsvCell(value) {
  const text = String(value === undefined || value === null ? "" : value).replace(/\r\n/g, "\n").replace(/\r/g, "\n")
  const formulaPrefix = /^[\t\n\u0000]|^[\s\u0000]*[=+\-@\uFF1D\uFF0B\uFF0D\uFF20]/
  const safeText = formulaPrefix.test(text) ? `'${text}` : text
  const escaped = safeText.replace(/"/g, '""')
  return /[",\n]/.test(escaped) ? `"${escaped}"` : escaped
}

function formatTime(timestamp) {
  if (!timestamp) return ""
  const d = new Date(timestamp)
  if (typeof timestamp === "boolean" || Number.isNaN(d.getTime())) return ""
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function recordedNumber(value, max) {
  if ((typeof value !== "number" && typeof value !== "string") || (typeof value === "string" && !value.trim())) return null
  const number = Number(value)
  return Number.isInteger(number) && number >= 0 && number <= max ? number : null
}

function buildHandoverReport(bookingInput, handoverInput) {
  const booking = bookingInput && typeof bookingInput === "object" ? bookingInput : {}
  const handover = handoverInput && typeof handoverInput === "object" ? handoverInput : {}
  const stage = String(handover.stage || "pickup") === "return" ? "return" : "pickup"
  const stageText = stage === "return" ? "还车交验" : "取车交验"

  const photos = (Array.isArray(handover.photos) ? handover.photos : []).filter((p) => p && typeof p === "object" && !Array.isArray(p)).map((p) => ({
    angle: p.angle || "unknown",
    label: ANGLE_LABELS[p.angle] || p.angle || "其他视角",
    fileId: p.fileId || "",
    url: p.url || ""
  }))

  const energyType = ["electric", "fuel"].includes(handover.energyType) ? handover.energyType : ""
  const energyTypeText = energyType === "electric" ? "纯电" : energyType === "fuel" ? "燃油" : "未记录"

  const scratchItems = (Array.isArray(handover.scratchItems) ? handover.scratchItems : []).filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((item) => ({
    part: item.part || "other",
    partLabel: PART_LABELS[item.part] || item.part || "其他部位",
    type: item.type || "scratch",
    typeLabel: DAMAGE_TYPE_LABELS[item.type] || item.type || "损伤",
    description: String(item.description || item.desc || "").trim()
  }))

  const scratchSummary = scratchItems.length > 0
    ? scratchItems.map((s) => `[${s.partLabel}] ${s.typeLabel}${s.description ? `(${s.description})` : ""}`).join("; ")
    : ""

  const inspectorName = String(handover.inspectorName || "").trim()
  const customerConfirmed = Boolean(formatTime(handover.confirmedAt)) || handover.status === "confirmed"

  return {
    bookingId: String(booking.id || booking.bookingId || "—"),
    vehicleName: String(booking.vehicleName || "爱迦座驾"),
    plateNumber: String(booking.plateNumber || "车牌保密"),
    userName: String(booking.userName || "未记录"),
    phone: String(booking.phone || "—"),
    stage,
    stageText,
    submittedAt: handover.submittedAt || null,
    submittedAtText: formatTime(handover.submittedAt) || "待提交",
    confirmedAt: handover.confirmedAt || null,
    confirmedAtText: formatTime(handover.confirmedAt) || "待确认",
    mileageKm: recordedNumber(handover.mileageKm, 5000000),
    energyType,
    energyTypeText,
    energyLevelPercent: recordedNumber(handover.energyLevelPercent, 100),
    damageNote: String(handover.damageNote || "").trim() || scratchSummary || "车况未记录",
    scratchItems,
    scratchSummary,
    inspectorName,
    customerConfirmed,
    additionalNote: String(handover.additionalNote || "").trim(),
    photos,
    disclaimer: "本验车留证单为车况及交接事实记录，确认仅表示内容核对，不是电子签章或合同签署。"
  }
}

function formatHandoverCsvContent(bookingInput, handoverInput) {
  const report = buildHandoverReport(bookingInput, handoverInput)
  const header = [
    "预约单号",
    "车辆名称",
    "车牌号码",
    "交接阶段",
    "客户姓名",
    "联系电话",
    "交接登记时间",
    "客户确认时间",
    "仪表里程(km)",
    "能源形式",
    "剩余油量电量(%)",
    "车身损伤检查记录",
    "补充交接约定",
    "车头留证照片",
    "车尾留证照片",
    "左侧留证照片",
    "右侧留证照片",
    "验车服务专员",
    "客户内容核对状态"
  ]

  const getPhotoLocation = (angle) => {
    const item = report.photos.find((p) => p.angle === angle)
    return item ? (item.fileId || item.url || "已存证") : "未采集"
  }

  const row = [
    report.bookingId,
    report.vehicleName,
    report.plateNumber,
    report.stageText,
    report.userName,
    report.phone,
    report.submittedAtText,
    report.confirmedAtText,
    report.mileageKm === null ? "未记录" : String(report.mileageKm),
    report.energyTypeText,
    report.energyLevelPercent === null ? "未记录" : `${report.energyLevelPercent}%`,
    report.damageNote,
    report.additionalNote || "未记录",
    getPhotoLocation("front"),
    getPhotoLocation("rear"),
    getPhotoLocation("left"),
    getPhotoLocation("right"),
    report.inspectorName || "未记录",
    report.customerConfirmed ? "已核对" : "待核对"
  ]

  const bom = "\uFEFF"
  return bom + header.map(escapeCsvCell).join(",") + "\r\n" + row.map(escapeCsvCell).join(",") + "\r\n"
}

function getHandoverFileName(bookingInput, handoverInput) {
  const booking = bookingInput && typeof bookingInput === "object" ? bookingInput : {}
  const handover = handoverInput && typeof handoverInput === "object" ? handoverInput : {}
  const stage = String(handover.stage || "pickup") === "return" ? "还车" : "取车"
  const bookingId = String(booking.id || "bk").replace(/[^a-z0-9_-]/gi, "").slice(-6).toUpperCase() || "BK"
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  reportExportSerial += 1
  return `验车留证单_${stage}_${bookingId}_${today}_${REPORT_SESSION_ID}_${reportExportSerial}.csv`
}

/**
 * 微信支付分「免押租车」官方标准 8 类后付费收费项目规范
 * 微信官方《免押租车业务类目接入指南》严格约束：完结免押租车订单后付费项目必须属于以下 8 类标准化费用名称之一，严禁自创非法费用项
 */
const WECHAT_PAY_SCORE_RENTAL_FEE_CATEGORIES = Object.freeze([
  "租车相关费用",
  "延迟还车费用",
  "加油费用",
  "ETC高速费用",
  "车损费用",
  "折旧费用",
  "停运费用",
  "闯红灯违章"
])

/**
 * 辅助映射函数：将验车/还车产生的各类结算费用项，安全归一化对齐到微信支付分官方 8 类收费项目白名单
 * @param {string} rawCategory - 原始业务费用名称或关键字
 * @returns {string} 归一化后的微信官方标准费用项名称
 */
function normalizeRentalFeeCategory(rawCategory) {
  if (!rawCategory || typeof rawCategory !== "string") {
    return "租车相关费用"
  }
  const clean = rawCategory.trim()
  if (WECHAT_PAY_SCORE_RENTAL_FEE_CATEGORIES.includes(clean)) {
    return clean
  }
  if (/违章|罚款|闯红灯|超速|违停/i.test(clean)) return "闯红灯违章"
  if (/停运|误工|停工/i.test(clean)) return "停运费用"
  if (/折旧|贬值/i.test(clean)) return "折旧费用"
  if (/延|超时|续租|迟/i.test(clean)) return "延迟还车费用"
  if (/油|电|充|补能/i.test(clean)) return "加油费用"
  if (/etc|通行|高速|路桥/i.test(clean)) return "ETC高速费用"
  if (/损|划痕|擦碰|玻璃|钣金|维修/i.test(clean)) return "车损费用"
  return "租车相关费用"
}

module.exports = {
  buildHandoverReport,
  formatHandoverCsvContent,
  getHandoverFileName,
  DAMAGE_TYPE_LABELS,
  PART_LABELS,
  WECHAT_PAY_SCORE_RENTAL_FEE_CATEGORIES,
  normalizeRentalFeeCategory
}
