const STATUS_TEXT_MAP = {
  pending: "待联系",
  contacted: "已联系",
  quoted: "已报价",
  adjustment_requested: "待调整",
  confirmed: "已确认",
  completed: "已完成",
  cancelled: "已取消"
}
const STATUS_CLASS_MAP = {
  pending: "status-pending",
  contacted: "status-contacted",
  quoted: "status-quoted",
  adjustment_requested: "status-adjustment-requested",
  confirmed: "status-confirmed",
  completed: "status-completed",
  cancelled: "status-cancelled"
}
function mapStatusText(status) {
  const value = String(status || "").trim()
  return STATUS_TEXT_MAP[value] || "待联系"
}
function mapStatusClass(status) {
  const value = String(status || "").trim()
  return STATUS_CLASS_MAP[value] || "status-pending"
}
function canCancelBooking(status) {
  const value = String(status || "").trim()
  return ["pending", "contacted", "quoted", "adjustment_requested", "confirmed"].includes(value)
}
function canEditBooking(status) {
  const value = String(status || "").trim()
  return value === "pending" || value === "contacted"
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待联系" },
  { value: "contacted", label: "已联系" },
  { value: "quoted", label: "已报价" },
  { value: "adjustment_requested", label: "待调整" },
  { value: "confirmed", label: "已确认" },
  { value: "completed", label: "已完成" },
  { value: "cancelled", label: "已取消" }
]

const PRIORITY_TEXT_MAP = {
  priority: "优先",
  normal: "常规",
  standby: "候补"
}

const PRIORITY_OPTIONS = [
  { value: "all", label: "全部级别" },
  { value: "priority", label: "优先" },
  { value: "normal", label: "常规" },
  { value: "standby", label: "候补" }
]

const COORDINATION_TEXT_MAP = {
  pending: "待协调",
  coordinating: "协调中",
  resolved: "已协调"
}

const COORDINATION_OPTIONS = [
  { value: "all", label: "全部进度" },
  { value: "pending", label: "待协调" },
  { value: "coordinating", label: "协调中" },
  { value: "resolved", label: "已协调" }
]

function mapPriorityText(priority, fallback = "常规") {
  const value = String(priority || "").trim()
  return PRIORITY_TEXT_MAP[value] || fallback
}

function mapCoordinationText(coordination, fallback = "待协调") {
  const value = String(coordination || "").trim()
  return COORDINATION_TEXT_MAP[value] || fallback
}

const WORKBENCH_PRIORITY_OPTIONS = [
  { key: "priority", label: "优先" },
  { key: "normal", label: "常规" },
  { key: "standby", label: "候补" }
]

const GUIDANCE_LIST_MAP = {
  pending: {
    title: "等待顾问联系",
    desc: "预约已提交，请保持手机畅通；联系前可修改资料或取消预约。",
    tone: "pending"
  },
  contacted: {
    title: "正在确认行程",
    desc: "顾问已联系，请按沟通结果确认档期、价格与取还车安排。",
    tone: "contacted"
  },
  quoted: { title: "报价待确认", desc: "请进入详情核对费用并确认或申请调整。", tone: "quoted" },
  adjustment_requested: { title: "报价调整中", desc: "顾问正在根据你的说明重新报价。", tone: "adjustment" },
  confirmed: { title: "报价已确认", desc: "所选档期已保留，尚未付款或签署合同，请关注后续安排。", tone: "confirmed" },
  completed: {
    title: "本次行程已完成",
    desc: "预约流程已结束，可返回车库继续浏览其他车辆。",
    tone: "completed"
  },
  cancelled: {
    title: "本次预约已取消",
    desc: "该记录已结束，如仍有用车需求可重新选择车辆提交预约。",
    tone: "cancelled"
  }
}

const GUIDANCE_DETAIL_MAP = {
  pending: {
    title: "等待顾问联系",
    desc: "预约已提交，请保持手机畅通；联系前仍可修改本次预约的联系信息。",
    tone: "pending"
  },
  contacted: {
    title: "正在确认行程",
    desc: "顾问已联系，请按沟通结果确认车辆档期、价格与取还车安排。",
    tone: "contacted"
  },
  quoted: {
    title: "报价等待确认",
    desc: "顾问已发送费用明细，请核对报价后确认或提出调整；确认不代表付款。",
    tone: "quoted"
  },
  adjustment_requested: {
    title: "顾问正在调整报价",
    desc: "调整申请已提交，顾问重新发送报价后可再次确认。",
    tone: "adjustment"
  },
  confirmed: {
    title: "报价已确认",
    desc: "报价已确认，所选档期已为你保留；尚未付款或签署合同，请与顾问确认后续安排。",
    tone: "confirmed"
  },
  completed: {
    title: "本次行程已完成",
    desc: "预约流程已经结束，感谢使用极境车库服务。",
    tone: "completed"
  },
  cancelled: {
    title: "本次预约已取消",
    desc: "该预约已结束，如仍有用车需求，可返回车库重新选择车辆。",
    tone: "cancelled"
  }
}

function buildStatusGuidance(status, options = {}) {
  const value = String(status || "pending").trim() || "pending"
  const isDetail = typeof options === "string" ? options === "detail" : Boolean(options && (options.isDetail || options.mode === "detail"))
  const map = isDetail ? GUIDANCE_DETAIL_MAP : GUIDANCE_LIST_MAP
  return map[value] || map.pending
}

function buildJourneyProgress(status) {
  const value = String(status || "pending").trim() || "pending"
  const progressMap = {
    pending: {
      stageText: "第 1 阶段 · 等待联系",
      width: "4%",
      tone: "pending",
      stepOneClass: "journey-step-current",
      stepTwoClass: "journey-step-upcoming",
      stepThreeClass: "journey-step-upcoming"
    },
    contacted: {
      stageText: "第 2 阶段 · 行程确认",
      width: "50%",
      tone: "contacted",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-current",
      stepThreeClass: "journey-step-upcoming"
    },
    quoted: {
      stageText: "第 2 阶段 · 报价确认",
      width: "67%",
      tone: "quoted",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-current",
      stepThreeClass: "journey-step-upcoming"
    },
    adjustment_requested: {
      stageText: "第 2 阶段 · 报价调整",
      width: "67%",
      tone: "adjustment",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-current",
      stepThreeClass: "journey-step-upcoming"
    },
    confirmed: {
      stageText: "第 3 阶段 · 方案已确认",
      width: "90%",
      tone: "confirmed",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-complete",
      stepThreeClass: "journey-step-current"
    },
    completed: {
      stageText: "第 3 阶段 · 行程完成",
      width: "100%",
      tone: "completed",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-complete",
      stepThreeClass: "journey-step-current"
    },
    cancelled: {
      stageText: "流程已结束",
      width: "100%",
      tone: "cancelled",
      stepOneClass: "journey-step-complete",
      stepTwoClass: "journey-step-upcoming",
      stepThreeClass: "journey-step-cancelled"
    }
  }
  return progressMap[value] || progressMap.pending
}

function buildProgressSteps(status) {
  const value = String(status || "pending").trim() || "pending"
  const cancelled = value === "cancelled"
  const indexMap = { pending: 0, contacted: 1, quoted: 2, adjustment_requested: 2, confirmed: 3, completed: 4 }
  const activeIndex = cancelled ? 1 : (indexMap[value] === undefined ? 0 : indexMap[value])
  const labels = cancelled
    ? ["预约已提交", "预约已取消", "流程已结束"]
    : ["预约已提交", "顾问联系", "收到报价", "确认方案", "行程完成"]
  return labels.map((label, index) => {
    let stateClass = "progress-upcoming"
    if (index < activeIndex) {
      stateClass = "progress-done"
    } else if (index === activeIndex) {
      stateClass = cancelled ? "progress-cancelled" : "progress-current"
    }
    return {
      key: `${value}-${index}`,
      label,
      marker: `${index + 1}`,
      showCheck: index < activeIndex,
      showCancelledMark: cancelled && index === activeIndex,
      stateClass,
      isLast: index === labels.length - 1
    }
  })
}

function buildListSummary(list) {
  return (Array.isArray(list) ? list : []).reduce(
    (summary, item) => {
      const status = String((item && item.status) || "pending").trim()
      if (status === "completed") {
        summary.completed += 1
      } else if (status === "cancelled") {
        summary.cancelled += 1
      } else {
        summary.ongoing += 1
      }
      return summary
    },
    {
      ongoing: 0,
      completed: 0,
      cancelled: 0
    }
  )
}

function filterBookings(list, filter) {
  const source = Array.isArray(list) ? list : []
  if (filter === "ongoing") {
    return source.filter((item) => !["completed", "cancelled"].includes(item.status))
  }
  if (filter === "completed") {
    return source.filter((item) => item.status === "completed")
  }
  if (filter === "cancelled") {
    return source.filter((item) => item.status === "cancelled")
  }
  return source
}

module.exports = {
  STATUS_TEXT_MAP,
  STATUS_CLASS_MAP,
  STATUS_OPTIONS,
  PRIORITY_TEXT_MAP,
  PRIORITY_OPTIONS,
  WORKBENCH_PRIORITY_OPTIONS,
  COORDINATION_TEXT_MAP,
  COORDINATION_OPTIONS,
  mapStatusText,
  mapStatusClass,
  mapPriorityText,
  mapCoordinationText,
  canCancelBooking,
  canEditBooking,
  buildStatusGuidance,
  buildJourneyProgress,
  buildProgressSteps,
  buildListSummary,
  filterBookings
}
