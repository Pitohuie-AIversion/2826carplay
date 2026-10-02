/**
 * 极境车库 - 个人隐私合规与数据权利领域模型 (Privacy Domain Model)
 *
 * 规范化管理用户个人信息主体权利申请 (查询 access、更正 correction、删除 deletion)
 * 及其生命周期状态机、展示字典、文案提示与阶段流程计算。
 */

const PRIVACY_TYPES = ["access", "correction", "deletion"]

const PRIVACY_STATUSES = ["pending", "processing", "completed", "rejected", "cancelled"]

const TYPE_OPTIONS = [
  { value: "access", label: "查询信息", desc: "申请了解平台当前保存的个人信息" },
  { value: "correction", label: "更正信息", desc: "申请修正不准确或已变化的个人信息" },
  { value: "deletion", label: "删除信息", desc: "申请删除符合法律与业务条件的个人信息" }
]

const TYPE_FILTER_OPTIONS = [
  { value: "all", label: "全部类型" },
  { value: "access", label: "查询" },
  { value: "correction", label: "更正" },
  { value: "deletion", label: "删除" }
]

const TYPE_LABELS = {
  access: "查询信息",
  correction: "更正信息",
  deletion: "删除信息"
}

const TYPE_META = {
  access: {
    label: "查询信息",
    className: "request-type-access",
    iconClass: "request-type-icon-access"
  },
  correction: {
    label: "更正信息",
    className: "request-type-correction",
    iconClass: "request-type-icon-correction"
  },
  deletion: {
    label: "删除信息",
    className: "request-type-deletion",
    iconClass: "request-type-icon-deletion"
  }
}

const STATUS_META = {
  pending: {
    label: "待处理",
    className: "status-pending",
    stageHint: "申请已进入队列，开始处理前可随时撤回"
  },
  processing: {
    label: "处理中",
    className: "status-processing",
    stageHint: "工作人员正在核验相关信息，请留意处理反馈"
  },
  completed: {
    label: "已完成",
    className: "status-completed",
    stageHint: "本次申请已处理完成，请查看下方反馈"
  },
  rejected: {
    label: "未通过",
    className: "status-rejected",
    stageHint: "本次申请未通过，请根据反馈调整后再提交"
  },
  cancelled: {
    label: "已撤回",
    className: "status-cancelled",
    stageHint: "本次申请已撤回，如仍有需要可重新提交"
  }
}

const STATUS_OPTIONS = [
  { value: "all", label: "全部状态" },
  { value: "pending", label: "待处理" },
  { value: "processing", label: "处理中" },
  { value: "completed", label: "已完成" },
  { value: "rejected", label: "未通过" },
  { value: "cancelled", label: "已撤回" }
]

const ACTIVE_STATUSES = new Set(["pending", "processing"])

function getPrivacyTypeLabel(type, fallback = "隐私申请") {
  return (type && TYPE_LABELS[type]) || fallback
}

function getPrivacyStatusLabel(status, fallback = "未知状态") {
  return (status && STATUS_META[status] && STATUS_META[status].label) || fallback
}

function getPrivacyStatusClass(status, fallback = "status-pending") {
  return (status && STATUS_META[status] && STATUS_META[status].className) || fallback
}

function canCancelPrivacyRequest(status) {
  return status === "pending"
}

function isPrivacyRequestActive(status) {
  return ACTIVE_STATUSES.has(status)
}

function buildRequestJourney(statusInput) {
  const status = String(statusInput || "pending")
  if (status === "processing") {
    return {
      journeyStage: 2,
      journeyProgress: 67,
      journeyClass: "request-journey-processing",
      journeyHint: "正在核实中"
    }
  }
  if (status === "completed") {
    return {
      journeyStage: 3,
      journeyProgress: 100,
      journeyClass: "request-journey-completed",
      journeyHint: "已完成处理"
    }
  }
  if (status === "rejected") {
    return {
      journeyStage: 3,
      journeyProgress: 100,
      journeyClass: "request-journey-rejected",
      journeyHint: "申请未通过"
    }
  }
  if (status === "cancelled") {
    return {
      journeyStage: 1,
      journeyProgress: 0,
      journeyClass: "request-journey-cancelled",
      journeyHint: "用户已撤回"
    }
  }
  return {
    journeyStage: 1,
    journeyProgress: 33,
    journeyClass: "request-journey-pending",
    journeyHint: "排队待处理"
  }
}

module.exports = {
  PRIVACY_TYPES,
  PRIVACY_STATUSES,
  TYPE_OPTIONS,
  TYPE_FILTER_OPTIONS,
  TYPE_LABELS,
  TYPE_META,
  STATUS_META,
  STATUS_OPTIONS,
  ACTIVE_STATUSES,
  getPrivacyTypeLabel,
  getPrivacyStatusLabel,
  getPrivacyStatusClass,
  canCancelPrivacyRequest,
  isPrivacyRequestActive,
  buildRequestJourney
}
