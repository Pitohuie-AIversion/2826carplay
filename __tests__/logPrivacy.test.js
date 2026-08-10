const fs = require("fs")
const path = require("path")

function readCloudFunction(name) {
  return fs.readFileSync(
    path.join(__dirname, "..", "cloudfunctions", name, "index.js"),
    "utf8"
  )
}

function readMainErrorLogBlock(name) {
  const source = readCloudFunction(name)
  const marker = "await writeErrorLogBestEffort({"
  const start = source.lastIndexOf(marker)
  return start >= 0 ? source.slice(start) : ""
}

function readMainCatchBlock(name) {
  const source = readCloudFunction(name)
  const marker = "} catch (error) {"
  const start = source.lastIndexOf(marker)
  return start >= 0 ? source.slice(start) : ""
}

function readLastAuditCall(name) {
  const source = readCloudFunction(name)
  const marker = "await writeAuditLogBestEffort({"
  const start = source.lastIndexOf(marker)
  const end = source.indexOf("\n    })", start)
  return start >= 0 && end >= 0 ? source.slice(start, end + 7) : ""
}

function readLastErrorLogCall(name) {
  const source = readCloudFunction(name)
  const marker = "await writeErrorLogBestEffort({"
  const start = source.lastIndexOf(marker)
  const end = source.indexOf("\n    })", start)
  return start >= 0 && end >= 0 ? source.slice(start, end + 7) : ""
}

function readAllPersistentErrorCalls() {
  const cloudFunctionRoot = path.join(__dirname, "..", "cloudfunctions")
  const marker = "await writeErrorLogBestEffort({"
  const calls = []

  fs.readdirSync(cloudFunctionRoot).forEach((name) => {
    const filePath = path.join(cloudFunctionRoot, name, "index.js")
    if (!fs.existsSync(filePath)) {
      return
    }
    const source = fs.readFileSync(filePath, "utf8")
    source
      .split(marker)
      .slice(1)
      .forEach((part) => {
        const endMatch = part.match(/\n\s+\}\)/)
        calls.push({
          name,
          source: endMatch ? part.slice(0, endMatch.index) : part
        })
      })
  })

  return calls
}

function readAllConsoleLogCalls() {
  const cloudFunctionRoot = path.join(__dirname, "..", "cloudfunctions")
  const calls = []

  fs.readdirSync(cloudFunctionRoot).forEach((name) => {
    const filePath = path.join(cloudFunctionRoot, name, "index.js")
    if (!fs.existsSync(filePath)) {
      return
    }
    const source = fs.readFileSync(filePath, "utf8")
    const matches = source.match(/console\.(?:error|warn)\s*\(\s*\{[\s\S]*?\n\s*\}\)/g) || []
    matches.forEach((call) => calls.push({ name, source: call }))
  })

  return calls
}

describe("cloud function log privacy", () => {
  test("every persistent error call excludes direct identities and server stacks", () => {
    const calls = readAllPersistentErrorCalls()

    expect(calls.length).toBeGreaterThan(0)
    calls.forEach((call) => {
      expect(call.source).not.toMatch(/(?:^|\n)\s*(?:openid|operatorOpenid)\s*[:,]/)
      expect(call.source).not.toMatch(/(?:^|\n)\s*stack\s*:/)
    })
  })

  test("cloud runtime error logs never print a direct OpenID field", () => {
    const calls = readAllConsoleLogCalls()

    expect(calls.length).toBeGreaterThan(0)
    calls.forEach((call) => {
      expect(call.source).not.toMatch(/(?:^|\n)\s*[A-Za-z]*[Oo]penid\s*[:,]/)
    })
  })

  test("booking status errors do not persist the normalized request object", () => {
    const source = readCloudFunction("bookingUpdateStatus")

    expect(source).not.toMatch(/\n\s*input,\s*\n/)
  })

  test("vehicle deletion errors do not persist the raw event", () => {
    const source = readCloudFunction("vehicleDelete")

    expect(source).not.toMatch(/\binput:\s*event\b/)
  })

  test.each(["vehicleDelete", "vehicleImageUpdate"])(
    "%s does not print full file IDs when cloud deletion fails",
    (functionName) => {
      const source = readCloudFunction(functionName)

      expect(source).not.toMatch(/fileCount:\s*list\.length,\s*fileList:\s*list,/)
      expect(source).not.toMatch(/context:\s*context\s*\|\|\s*\{\}/)
      expect(source).not.toMatch(
        /stage:\s*"deleteFile"[\s\S]{0,300}?errorMessage:\s*error/
      )
    }
  )

  test.each(["vehicleCreate", "vehicleUpdate"])(
    "%s error logging does not persist or print a full plate number",
    (functionName) => {
      const errorLogBlock = readMainErrorLogBlock(functionName)

      expect(errorLogBlock).not.toMatch(/\n\s*plateNumber,\s*\n/)
      expect(errorLogBlock).not.toMatch(/\n\s*openid,\s*\n\s*plateNumber/)
    }
  )

  test("role permission errors do not persist or print the target OpenID", () => {
    const errorLogBlock = readMainCatchBlock("roleUpsert")

    expect(errorLogBlock).not.toMatch(/targetOpenid\s*:/)
    expect(errorLogBlock).toContain("targetProvided: Boolean(input.openid)")
  })

  test("booking creation audit only keeps record identifiers", () => {
    const auditCall = readLastAuditCall("bookingCreate")

    expect(auditCall).toContain("bookingId")
    expect(auditCall).toContain("vehicleId: input.vehicleId")
    expect(auditCall).not.toMatch(/vehicleName|startDate|endDate|city|userName|phone|note/)
  })

  test.each(["bookingCreate", "bookingMyDetail", "bookingUpdateMyContact", "bookingCancel"])(
    "%s persistent errors do not copy user identity, dates, or server stacks",
    (functionName) => {
      const errorCall = readLastErrorLogCall(functionName)

      expect(errorCall).toContain("authenticated: Boolean(openid)")
      expect(errorCall).not.toMatch(/\n\s*openid,|\n\s*stack:|startDate:|endDate:/)
    }
  )

  test.each([
    "bookingDetail",
    "bookingUpdateStatus",
    "bookingUpdateAdminRemark",
    "bookingUpdateCoordination",
    "bookingCalendarList",
    "bookingExportCsv"
  ])("%s persistent errors keep administrator identity and stacks out", (functionName) => {
    const errorCall = readLastErrorLogCall(functionName)

    expect(errorCall).toContain("authenticated: Boolean(openid)")
    expect(errorCall).not.toMatch(/\n\s*openid,|\n\s*stack:/)
  })

  test.each([
    "vehicleCreate",
    "vehicleUpdate",
    "vehicleUpdateStatus",
    "vehicleImageUpdate",
    "vehicleRetire",
    "vehicleRestore",
    "vehicleDelete"
  ])("%s persistent errors keep operator identity and stacks out", (functionName) => {
    const errorCall = readLastErrorLogCall(functionName)

    expect(errorCall).toContain("authenticated: Boolean(openid)")
    expect(errorCall).not.toMatch(/\n\s*openid,|\n\s*stack:|plateNumber:|fileList:/)
  })

  test.each([
    "bootstrapAdmin",
    "roleUpsert",
    "operationConfigUpdate",
    "pendingFileDeletionProcess",
    "analyticsCleanup"
  ])("%s persistent errors do not duplicate administrator identity", (functionName) => {
    const source = readCloudFunction(functionName)
    const errorCalls = source.split("await writeErrorLogBestEffort({").slice(1)

    expect(errorCalls.length).toBeGreaterThan(0)
    errorCalls.forEach((call) => {
      const end = call.indexOf("\n    })")
      const errorCall = end >= 0 ? call.slice(0, end) : call
      expect(errorCall).not.toMatch(/\n\s*openid,|openid:\s*operatorOpenid|\n\s*stack:/)
    })
  })

  test.each(["vehicleCreate", "vehicleUpdate", "vehicleRetire", "vehicleRestore"])(
    "%s audit does not duplicate the full plate number",
    (functionName) => {
      expect(readLastAuditCall(functionName)).not.toMatch(/plateNumber/)
    }
  )

  test.each(["operationConfigUpdate", "vehicleUpdate"])(
    "%s audit only records changed field names",
    (functionName) => {
      const auditCall = readLastAuditCall(functionName)

      expect(auditCall).toContain("changedKeys")
      expect(auditCall).not.toMatch(/\bbefore\b|\bafter\b/)
    }
  )

  test("audit log query never returns historical before/after snapshots", () => {
    const source = readCloudFunction("auditLogList")

    expect(source).not.toMatch(/before:\s*item\.before|after:\s*item\.after/)
    expect(source).toContain('db.collection("audit_logs").field(AUDIT_LOG_FIELDS)')
  })

  test("error log query keeps server stack traces off the client", () => {
    const source = readCloudFunction("errorLogList")

    expect(source).not.toMatch(/stack:\s*String\(item\.stack/)
    expect(source).not.toMatch(/openid:\s*normalizeText\(item\.openid/)
    expect(source).not.toMatch(/targetOpenid:\s*normalizeText\(item\.targetOpenid/)
    expect(source).toContain('db.collection("error_logs").field(ERROR_LOG_FIELDS)')
  })

  test("log CSV export reads only explicit audit and error fields", () => {
    const source = readCloudFunction("logExportCsv")

    expect(source).toContain("AUDIT_EXPORT_FIELDS")
    expect(source).toContain("ERROR_EXPORT_FIELDS")
    expect(source).toContain("db.collection(collectionName).field(fields)")
  })

  test("booking CSV export reads only explicit booking fields", () => {
    const source = readCloudFunction("bookingExportCsv")

    expect(source).toContain("BOOKING_EXPORT_FIELDS")
    expect(source).toContain('db.collection("bookings").field(BOOKING_EXPORT_FIELDS)')
  })

  test("privacy data inventory reads each category through an explicit field list", () => {
    const source = readCloudFunction("privacyRequestDataInventory")

    expect(source).toContain("REQUEST_HEADER_FIELDS")
    expect(source).toContain("INVENTORY_FIELDS")
    expect(source).toContain(".field(INVENTORY_FIELDS[collectionName])")
    expect(source).toContain(".field(REQUEST_HEADER_FIELDS)")
  })

  test("privacy request lists read only fields visible to each audience", () => {
    const adminSource = readCloudFunction("privacyRequestList")
    const userSource = readCloudFunction("privacyRequestMyList")

    expect(adminSource).toContain("PRIVACY_REQUEST_LIST_FIELDS")
    expect(adminSource).toContain('.field(PRIVACY_REQUEST_LIST_FIELDS)')
    expect(userSource).toContain("PRIVACY_REQUEST_MY_FIELDS")
    expect(userSource).toContain(".field(PRIVACY_REQUEST_MY_FIELDS)")
  })

  test("user booking queries keep internal coordination fields out of database reads", () => {
    const listSource = readCloudFunction("bookingMyList")
    const detailSource = readCloudFunction("bookingMyDetail")

    expect(listSource).toContain("BOOKING_MY_LIST_FIELDS")
    expect(listSource).toContain(".field(BOOKING_MY_LIST_FIELDS)")
    expect(detailSource).toContain("BOOKING_MY_DETAIL_FIELDS")
    expect(detailSource).toContain(".field(BOOKING_MY_DETAIL_FIELDS)")
  })

  test("booking mutation preflight reads use purpose-specific field allowlists", () => {
    const cases = [
      ["bookingCancel", "BOOKING_CANCEL_FIELDS", ["openid", "vehicleId", "status"]],
      [
        "bookingUpdateMyContact",
        "BOOKING_CONTACT_UPDATE_FIELDS",
        ["openid", "status", "userName", "phone", "city", "note"]
      ],
      [
        "bookingUpdateStatus",
        "BOOKING_STATUS_UPDATE_FIELDS",
        [
          "_id",
          "openid",
          "vehicleName",
          "status",
          "latestPickupHandoverId",
          "latestReturnHandoverId",
          "pickupHandoverConfirmedAt",
          "returnHandoverConfirmedAt"
        ]
      ],
      ["bookingUpdateAdminRemark", "BOOKING_EXISTENCE_FIELDS", ["_id"]],
      [
        "bookingUpdateCoordination",
        "BOOKING_COORDINATION_FIELDS",
        ["status", "schedulePriority", "coordinationStatus"]
      ]
    ]

    cases.forEach(([functionName, constantName, expectedFields]) => {
      const source = readCloudFunction(functionName)
      const fieldBlock = source.match(
        new RegExp(`const ${constantName} = \\{([\\s\\S]*?)\\n\\}`)
      )

      expect(fieldBlock).not.toBeNull()
      const fields = Array.from(fieldBlock[1].matchAll(/^\s+(\w+): true,?$/gm)).map(
        (match) => match[1]
      )
      expect(fields).toEqual(expectedFields)
      expect(source).toContain(`.field(${constantName})`)
    })
  })

  test("booking creation reads only duplicate and idempotency fields", () => {
    const source = readCloudFunction("bookingCreate")

    expect(source).toContain("RECENT_BOOKING_FIELDS")
    expect(source.match(/\.field\(RECENT_BOOKING_FIELDS\)/g)).toHaveLength(2)
    expect(source).toContain(".field(IDEMPOTENT_BOOKING_FIELDS)")
    expect(source).toMatch(
      /const RECENT_BOOKING_FIELDS = \{\s*status: true,\s*vehicleId: true,\s*startDate: true,\s*endDate: true,\s*createdAt: true\s*\}/
    )
    expect(source).toMatch(
      /const IDEMPOTENT_BOOKING_FIELDS = \{\s*_id: true,\s*openid: true,\s*requestId: true\s*\}/
    )
  })

  test("vehicle mutation preflight reads use purpose-specific field allowlists", () => {
    const cases = [
      ["vehicleCreate", "VEHICLE_EXISTENCE_FIELDS", ["_id"]],
      ["vehicleUpdateStatus", "VEHICLE_STATUS_FIELDS", ["status"]],
      ["vehicleRetire", "VEHICLE_STATUS_FIELDS", ["status"]],
      ["vehicleRestore", "VEHICLE_STATUS_FIELDS", ["status"]],
      ["vehicleImageUpdate", "VEHICLE_IMAGE_FIELDS", ["imageList", "coverImage"]],
      ["vehicleDelete", "VEHICLE_DELETE_FIELDS", ["imageList", "coverImage"]],
      ["vehicleDelete", "BOOKING_EXISTENCE_FIELDS", ["_id"]]
    ]

    cases.forEach(([functionName, constantName, expectedFields]) => {
      const source = readCloudFunction(functionName)
      const fieldBlock = source.match(
        new RegExp(`const ${constantName} = \\{([\\s\\S]*?)\\n\\}`)
      )

      expect(fieldBlock).not.toBeNull()
      const fields = Array.from(fieldBlock[1].matchAll(/^\s+(\w+): true,?$/gm)).map(
        (match) => match[1]
      )
      expect(fields).toEqual(expectedFields)
      expect(source).toContain(`.field(${constantName})`)
    })

    const updateSource = readCloudFunction("vehicleUpdate")
    const updateFieldBlock = updateSource.match(
      /const VEHICLE_UPDATE_FIELD_NAMES = \[([\s\S]*?)\n\]/
    )
    expect(updateFieldBlock).not.toBeNull()
    expect(Array.from(updateFieldBlock[1].matchAll(/"([^"]+)"/g)).map((match) => match[1])).toEqual([
      "plateNumber",
      "vehicleType",
      "brandModel",
      "registerDate",
      "status",
      "location",
      "transmission",
      "fuelType",
      "seats",
      "priceDay",
      "publicDescription",
      "vin",
      "engineNumber",
      "note",
      "publicMaterialsUpdatedDate",
      "publicInspectionDate",
      "publicInspectionSummary",
      "publicExteriorSummary",
      "publicInsuranceSummary",
      "publicAssistanceSummary",
      "publicArchiveReviewStatus",
      "internalMaintenanceRecord",
      "internalInspectionRecord",
      "internalInsuranceRecord",
      "internalArchiveNote"
    ])
    expect(updateSource).toContain(".field(VEHICLE_UPDATE_CURRENT_FIELDS)")
    expect(updateSource).toContain(".field(VEHICLE_ID_FIELDS)")
  })
})
