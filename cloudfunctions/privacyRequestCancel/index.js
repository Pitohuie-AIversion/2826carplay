const cloud = require("wx-server-sdk")

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

function createError(code, message) {
  return {
    ok: false,
    code: String(code || "VALIDATION_ERROR"),
    message: String(message || "参数校验失败")
  }
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
      function: "privacyRequestCancel",
      stage: "auditLog",
      errorMessage: message,
      createdAt: new Date().toISOString()
    })
  }
}

exports.main = async (event) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? wxContext.OPENID : ""
  const id = String((event && event.id) || "").trim()

  try {
    if (!openid) {
      return createError("UNAUTHORIZED", "未获取到用户身份")
    }
    if (!id) {
      return createError("VALIDATION_ERROR", "申请 ID 不能为空")
    }

    const currentRes = await db.collection("privacy_requests").doc(id).get()
    const current = currentRes && currentRes.data ? currentRes.data : null
    if (!current) {
      return createError("NOT_FOUND", "隐私申请不存在")
    }
    if (String(current.openid || "").trim() !== openid) {
      return createError("FORBIDDEN", "只能撤回自己的隐私申请")
    }

    const currentStatus = String(current.status || "pending").trim() || "pending"
    if (currentStatus !== "pending") {
      return createError("STATUS_NOT_ALLOWED", "申请已开始处理或已结束，不能撤回")
    }

    const updateRes = await db.collection("privacy_requests").where({
      _id: id,
      openid,
      status: "pending"
    }).update({
      data: {
        status: "cancelled",
        resolutionNote: "用户已撤回申请",
        updatedAt: db.serverDate()
      }
    })
    const updatedCount = Number(updateRes && updateRes.stats && updateRes.stats.updated) || 0
    if (updatedCount < 1) {
      return createError("STATUS_CONFLICT", "申请状态已发生变化，请刷新后重试")
    }

    await writeAuditLogBestEffort({
      openid,
      action: "privacyRequestCancel",
      requestId: id,
      requestType: String(current.type || ""),
      fromStatus: "pending",
      toStatus: "cancelled"
    })

    return {
      ok: true,
      id,
      status: "cancelled",
      message: "隐私申请已撤回"
    }
  } catch (error) {
    console.error({
      function: "privacyRequestCancel",
      openid,
      requestId: id,
      errorMessage: error && (error.message || error.errMsg) ? error.message || error.errMsg : String(error),
      stack: error && error.stack ? error.stack : "",
      createdAt: new Date().toISOString()
    })
    return createError("INTERNAL_ERROR", "隐私申请撤回失败，请稍后重试")
  }
}
