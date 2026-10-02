const { isDeepStrictEqual } = require("util")

function revisionOf(vehicle) {
  const value = Number(vehicle && vehicle.vehicleVersion)
  return Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function revisionError(code, message) {
  return Object.assign(new Error(message), { code, vehicleRevisionError: true })
}

async function updateVehicle(db, id, payload, expectedVersion, expectedStatus) {
  const baseline = expectedVersion === undefined ? 0 : expectedVersion
  if (!Number.isSafeInteger(baseline) || baseline < 0) {
    throw revisionError("VALIDATION_ERROR", "车辆版本无效，请刷新后重试")
  }
  return db.runTransaction(async (transaction) => {
    const ref = transaction.collection("vehicles").doc(id)
    let current
    try {
      const res = await ref.get()
      current = res && res.data
    } catch (error) {
      if (!/document_not_found|document.*(?:not found|not exist)/i.test(String(error && (error.errMsg || error.message || error.code) || ""))) throw error
    }
    if (!current) throw revisionError("NOT_FOUND", "车辆不存在")
    if (revisionOf(current) === baseline + 1 &&
        Object.keys(payload).every((key) => isDeepStrictEqual(current[key], payload[key]))) {
      return { updated: false, vehicleVersion: baseline + 1 }
    }
    if (revisionOf(current) !== baseline || current.status !== expectedStatus) {
      throw revisionError("VERSION_CONFLICT", "车辆资料已被更新，请刷新后重新确认修改")
    }
    await ref.update({ data: { ...payload, vehicleVersion: baseline + 1, updatedAt: db.serverDate() } })
    return { updated: true, vehicleVersion: baseline + 1 }
  })
}

module.exports = { revisionOf, updateVehicle }
