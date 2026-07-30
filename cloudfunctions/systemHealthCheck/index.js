const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()
const CONFIG_KEY = "operation_settings"
const REQUIRED_COLLECTIONS = [
  { key: "vehicles", label: "车辆数据" },
  { key: "bookings", label: "预约数据" },
  { key: "roles", label: "权限数据" },
  { key: "app_configs", label: "运营配置" },
  { key: "audit_logs", label: "审计日志" },
  { key: "error_logs", label: "错误日志" },
  { key: "favorites", label: "用户收藏" },
  { key: "pending_file_deletions", label: "存储清理队列" },
  { key: "privacy_requests", label: "隐私申请" },
  { key: "analytics_events", label: "匿名分析事件" }
]
const VOLUME_CHECKS = [
  {
    key: "vehicles",
    label: "车辆记录规模",
    warningAt: 1800,
    featureLimit: 2000,
    recommendation: "请规划历史归档或管理端游标分页"
  },
  {
    key: "bookings",
    label: "预约记录规模",
    warningAt: 1800,
    featureLimit: 2000,
    recommendation: "请规划历史归档或管理端游标分页"
  },
  {
    key: "audit_logs",
    label: "审计日志规模",
    warningAt: 1800,
    featureLimit: 2000,
    recommendation: "请安排日志导出与归档"
  },
  {
    key: "error_logs",
    label: "错误日志规模",
    warningAt: 1800,
    featureLimit: 2000,
    recommendation: "请安排日志导出与归档"
  },
  {
    key: "privacy_requests",
    label: "隐私申请规模",
    warningAt: 1800,
    featureLimit: 2000,
    recommendation: "请规划合规归档并保留处理依据"
  },
  {
    key: "analytics_events",
    label: "匿名分析规模",
    warningAt: 4500,
    featureLimit: 5000,
    recommendation: "请在数据分析页执行匿名数据清理"
  }
]

function hasAdminRole(record) {
  return Boolean(
    record &&
      (record.role === "admin" ||
        (Array.isArray(record.roles) && record.roles.includes("admin")) ||
        record.isAdmin === true ||
        record.admin === true)
  )
}

async function requireAdmin(openid) {
  const res = await db.collection("roles").where({ openid }).limit(20).get()
  const list = res && Array.isArray(res.data) ? res.data : []
  return list.some(hasAdminRole)
}

function sanitizeErrorMessage(error) {
  const raw =
    error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error || "")
  if (/collection|database|not exist|不存在/i.test(raw)) {
    return "集合不存在或当前环境不可访问"
  }
  return "集合检查失败，请查看云函数日志"
}

async function inspectCollection(item) {
  try {
    await db.collection(item.key).limit(1).get()
    return {
      key: `collection_${item.key}`,
      category: "database",
      label: item.label,
      status: "pass",
      message: "集合可正常访问"
    }
  } catch (error) {
    console.warn({
      function: "systemHealthCheck",
      stage: "collection",
      collection: item.key,
      errorMessage:
        error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return {
      key: `collection_${item.key}`,
      category: "database",
      label: item.label,
      status: "fail",
      message: sanitizeErrorMessage(error)
    }
  }
}

function normalizeCount(result) {
  const total = Number(result && result.total)
  return Number.isFinite(total) && total > 0 ? Math.floor(total) : 0
}

async function inspectVolume(item, collectionAvailable) {
  if (!collectionAvailable) {
    return {
      key: `volume_${item.key}`,
      category: "capacity",
      label: item.label,
      status: "warning",
      message: "对应集合不可用，暂时无法读取记录数量"
    }
  }

  try {
    const countResult = await db.collection(item.key).count()
    const count = normalizeCount(countResult)
    const nearLimit = count >= item.warningAt
    return {
      key: `volume_${item.key}`,
      category: "capacity",
      label: item.label,
      status: nearLimit ? "warning" : "pass",
      count,
      featureLimit: item.featureLimit,
      message: nearLimit
        ? `当前 ${count} 条，已接近 ${item.featureLimit} 条功能读取上限；${item.recommendation}`
        : `当前 ${count} 条，未接近 ${item.featureLimit} 条功能读取上限`
    }
  } catch (error) {
    console.warn({
      function: "systemHealthCheck",
      stage: "volume",
      collection: item.key,
      errorMessage:
        error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      createdAt: new Date().toISOString()
    })
    return {
      key: `volume_${item.key}`,
      category: "capacity",
      label: item.label,
      status: "warning",
      message: "记录数量读取失败，请到云控制台确认数据规模"
    }
  }
}

async function readOperationConfig() {
  try {
    const res = await db
      .collection("app_configs")
      .where({ key: CONFIG_KEY })
      .limit(1)
      .get()
    const list = res && Array.isArray(res.data) ? res.data : []
    return list.length ? list[0] : null
  } catch (error) {
    return null
  }
}

function buildSummary(checks) {
  const summary = {
    total: checks.length,
    passed: 0,
    warnings: 0,
    failed: 0,
    ready: true
  }

  checks.forEach((item) => {
    if (item.status === "pass") {
      summary.passed += 1
    } else if (item.status === "warning") {
      summary.warnings += 1
    } else {
      summary.failed += 1
    }
  })
  summary.ready = summary.failed === 0
  return summary
}

exports.main = async () => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""

  try {
    if (!openid) {
      return {
        ok: false,
        code: "UNAUTHORIZED",
        message: "未获取到用户身份"
      }
    }

    const isAdmin = await requireAdmin(openid)
    if (!isAdmin) {
      return {
        ok: false,
        code: "FORBIDDEN",
        message: "仅管理员可执行上线检查"
      }
    }

    const collectionChecks = await Promise.all(REQUIRED_COLLECTIONS.map(inspectCollection))
    const collectionAvailability = {}
    collectionChecks.forEach((item) => {
      collectionAvailability[item.key.replace(/^collection_/, "")] = item.status === "pass"
    })
    const volumeChecks = await Promise.all(
      VOLUME_CHECKS.map((item) => inspectVolume(item, collectionAvailability[item.key]))
    )
    const configCollection = collectionChecks.find(
      (item) => item.key === "collection_app_configs"
    )
    const configRecord =
      configCollection && configCollection.status === "pass"
        ? await readOperationConfig()
        : null
    const configValue =
      configRecord && configRecord.value && typeof configRecord.value === "object"
        ? configRecord.value
        : {}
    const templateConfigured = Boolean(
      String(process.env.BOOKING_STATUS_TEMPLATE_ID || "").trim() ||
        String(configValue.bookingStatusTemplateId || "").trim()
    )

    const checks = collectionChecks.concat(volumeChecks, [
      {
        key: "operation_settings",
        category: "configuration",
        label: "自定义运营配置",
        status: configRecord ? "pass" : "warning",
        message: configRecord
          ? "已保存当前环境的运营配置"
          : "尚未保存自定义配置，当前会使用程序默认值"
      },
      {
        key: "booking_status_template",
        category: "configuration",
        label: "预约状态订阅模板",
        status: templateConfigured ? "pass" : "warning",
        message: templateConfigured
          ? "订阅消息模板已配置"
          : "未配置模板，预约仍可使用，但不会发送状态提醒"
      }
    ])

    return {
      ok: true,
      checkedAt: new Date().toISOString(),
      summary: buildSummary(checks),
      checks
    }
  } catch (error) {
    console.error({
      function: "systemHealthCheck",
      openid,
      errorMessage:
        error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return {
      ok: false,
      code: "INTERNAL_ERROR",
      message: "上线检查失败，请稍后重试"
    }
  }
}
