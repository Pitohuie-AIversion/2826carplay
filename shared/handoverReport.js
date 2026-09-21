/**
 * 极境车库 - 交接留证报告与车况凭证生成器
 */

const ANGLE_LABELS = {
  front: "车头",
  rear: "车尾",
  left: "左侧",
  right: "右侧"
}

function escapeCsvCell(value) {
  const text = String(value === undefined || value === null ? "" : value).replace(/\r\n/g, " ").replace(/[\r\n]/g, " ")
  if (text.includes(",") || text.includes('"')) {
    return `"${text.replace(/"/g, '""')}"`
  }
  return text
}

function formatTime(timestamp) {
  if (!timestamp) return ""
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return String(timestamp)
  const pad = (n) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function buildHandoverReport(bookingInput, handoverInput) {
  const booking = bookingInput && typeof bookingInput === "object" ? bookingInput : {}
  const handover = handoverInput && typeof handoverInput === "object" ? handoverInput : {}
  const stage = String(handover.stage || "pickup") === "return" ? "return" : "pickup"
  const stageText = stage === "return" ? "还车交验" : "取车交验"

  const photos = (Array.isArray(handover.photos) ? handover.photos : []).map((p) => ({
    angle: p.angle || "unknown",
    label: ANGLE_LABELS[p.angle] || p.angle || "其他视角",
    fileId: p.fileId || "",
    url: p.url || ""
  }))

  const energyType = handover.energyType === "electric" ? "electric" : "fuel"
  const energyTypeText = energyType === "electric" ? "纯电" : "燃油"

  return {
    bookingId: String(booking.id || booking.bookingId || "—"),
    vehicleName: String(booking.vehicleName || "极境座驾"),
    plateNumber: String(booking.plateNumber || "车牌保密"),
    userName: String(booking.userName || "体验客户"),
    phone: String(booking.phone || "—"),
    stage,
    stageText,
    submittedAt: handover.submittedAt || null,
    submittedAtText: formatTime(handover.submittedAt) || "待提交",
    confirmedAt: handover.confirmedAt || null,
    confirmedAtText: formatTime(handover.confirmedAt) || "待确认",
    mileageKm: Number.isFinite(Number(handover.mileageKm)) ? Number(handover.mileageKm) : 0,
    energyType,
    energyTypeText,
    energyLevelPercent: Math.max(0, Math.min(100, Number(handover.energyLevelPercent) || 0)),
    damageNote: String(handover.damageNote || "无明显新增划痕或外观损伤"),
    additionalNote: String(handover.additionalNote || "无特殊补充约定"),
    photos,
    disclaimer: "本验车留证单为车况及交接事实记录，双方核验留存。"
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
    "右侧留证照片"
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
    String(report.mileageKm),
    report.energyTypeText,
    `${report.energyLevelPercent}%`,
    report.damageNote,
    report.additionalNote,
    getPhotoLocation("front"),
    getPhotoLocation("rear"),
    getPhotoLocation("left"),
    getPhotoLocation("right")
  ]

  const bom = "\uFEFF"
  return bom + header.map(escapeCsvCell).join(",") + "\r\n" + row.map(escapeCsvCell).join(",") + "\r\n"
}

function getHandoverFileName(bookingInput, handoverInput) {
  const booking = bookingInput && typeof bookingInput === "object" ? bookingInput : {}
  const handover = handoverInput && typeof handoverInput === "object" ? handoverInput : {}
  const stage = String(handover.stage || "pickup") === "return" ? "还车" : "取车"
  const bookingId = String(booking.id || "bk").slice(-6).toUpperCase()
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  return `验车留证单_${stage}_${bookingId}_${today}.csv`
}

module.exports = {
  buildHandoverReport,
  formatHandoverCsvContent,
  getHandoverFileName
}
