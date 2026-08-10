const {
  isValidPlateNumber,
  buildVehicleDisplayIdentity,
  isValidYmdDate,
  validateVehicle,
  normalizePlateNumber,
  TRANSMISSION_TYPES,
  FUEL_TYPES
} = require("../shared/vehicle")

beforeAll(() => {
  jest.useFakeTimers()
  jest.setSystemTime(new Date(2026, 6, 8, 12, 0, 0))
})

afterAll(() => {
  jest.useRealTimers()
})

describe("shared/vehicle.js plateNumber", () => {
  test("isValidPlateNumber accepts common plate", () => {
    expect(isValidPlateNumber("京A12345")).toBe(true)
  })

  test("isValidPlateNumber accepts common plate with special end", () => {
    expect(isValidPlateNumber("京A1234挂")).toBe(true)
  })

  test("isValidPlateNumber accepts new energy small plate", () => {
    expect(isValidPlateNumber("粤BD12345")).toBe(true)
  })

  test("isValidPlateNumber accepts new energy large plate", () => {
    expect(isValidPlateNumber("粤B12345D")).toBe(true)
  })

  test("isValidPlateNumber rejects empty and whitespace", () => {
    expect(isValidPlateNumber("")).toBe(false)
    expect(isValidPlateNumber("   ")).toBe(false)
    expect(isValidPlateNumber("京A 2345")).toBe(false)
  })

  test("isValidPlateNumber rejects invalid pattern", () => {
    expect(isValidPlateNumber("京A1234")).toBe(false)
    expect(isValidPlateNumber("京A1234@")).toBe(false)
    expect(isValidPlateNumber("A12345")).toBe(false)
  })

  test("normalizePlateNumber uppercases and trims", () => {
    expect(normalizePlateNumber("  京a12345 ")).toBe("京A12345")
  })

  test("预约展示隐藏完整车牌并保留车型名称", () => {
    expect(buildVehicleDisplayIdentity("粤A12345")).toEqual({
      vehicleName: "预约车辆",
      vehicleReference: "车牌尾号 45"
    })
    expect(buildVehicleDisplayIdentity("奥迪 A6")).toEqual({
      vehicleName: "奥迪 A6",
      vehicleReference: ""
    })
  })
})

describe("shared/vehicle.js registerDate", () => {
  test("isValidYmdDate accepts today and past date", () => {
    expect(isValidYmdDate("2026-07-08")).toEqual({ ok: true })
    expect(isValidYmdDate("2025-12-31")).toEqual({ ok: true })
  })

  test("isValidYmdDate rejects future date", () => {
    expect(isValidYmdDate("2026-07-09")).toEqual({ ok: false, reason: "FUTURE" })
  })

  test("isValidYmdDate rejects invalid format", () => {
    expect(isValidYmdDate("2026/07/08")).toEqual({ ok: false, reason: "FORMAT" })
  })

  test("isValidYmdDate rejects invalid date value", () => {
    expect(isValidYmdDate("2026-02-30")).toEqual({ ok: false, reason: "INVALID_DATE" })
  })
})

describe("shared/vehicle.js validateVehicle", () => {
  test("validateVehicle rejects missing required fields", () => {
    const res = validateVehicle({})
    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(res.details.errors.some((e) => e.field === "plateNumber")).toBe(true)
    expect(res.details.errors.some((e) => e.field === "vehicleType")).toBe(true)
  })

  test("validateVehicle rejects invalid enums", () => {
    const res = validateVehicle({
      plateNumber: "京A12345",
      vehicleType: "invalid_type",
      brandModel: "Brand",
      registerDate: "2026-07-08",
      status: "invalid_status"
    })
    expect(res.ok).toBe(false)
    expect(res.details.errors.some((e) => e.field === "vehicleType")).toBe(true)
    expect(res.details.errors.some((e) => e.field === "status")).toBe(true)
  })

  test("validateVehicle rejects invalid plate/date", () => {
    const res = validateVehicle({
      plateNumber: "京A1234@",
      vehicleType: "sedan",
      brandModel: "Brand",
      registerDate: "2026-07-09",
      status: "active"
    })
    expect(res.ok).toBe(false)
    expect(res.details.errors.some((e) => e.field === "plateNumber")).toBe(true)
    expect(res.details.errors.some((e) => e.field === "registerDate")).toBe(true)
  })

  test("validateVehicle returns normalized value on success", () => {
    const res = validateVehicle({
      plateNumber: "  京a12345 ",
      vehicleType: "sedan",
      brandModel: "  Toyota  ",
      registerDate: "2026-07-08",
      status: "active",
      location: "  杭州  ",
      transmission: "automatic",
      fuelType: "gasoline",
      seats: "5",
      priceDay: "699",
      publicDescription: "  公开亮点 ",
      note: "  ok "
    })
    expect(res.ok).toBe(true)
    expect(TRANSMISSION_TYPES).toContain("automatic")
    expect(FUEL_TYPES).toContain("gasoline")
    expect(res.value.plateNumber).toBe("京A12345")
    expect(res.value.brandModel).toBe("Toyota")
    expect(res.value.location).toBe("杭州")
    expect(res.value.transmission).toBe("automatic")
    expect(res.value.fuelType).toBe("gasoline")
    expect(res.value.seats).toBe(5)
    expect(res.value.priceDay).toBe(699)
    expect(res.value.publicDescription).toBe("公开亮点")
    expect(res.value.note).toBe("ok")
  })

  test("validateVehicle rejects invalid optional display fields", () => {
    const res = validateVehicle({
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "Toyota",
      registerDate: "2026-07-08",
      status: "active",
      transmission: "cvt",
      fuelType: "diesel",
      seats: "10",
      priceDay: "abc",
      publicDescription: "x".repeat(201)
    })

    expect(res.ok).toBe(false)
    expect(res.details.errors.some((e) => e.field === "transmission")).toBe(true)
    expect(res.details.errors.some((e) => e.field === "fuelType")).toBe(true)
    expect(res.details.errors.some((e) => e.field === "seats")).toBe(true)
    expect(res.details.errors.some((e) => e.field === "priceDay")).toBe(true)
    expect(res.details.errors.some((e) => e.field === "publicDescription")).toBe(true)
  })

  test("validateVehicle preserves explicit empty optional fields for clearing", () => {
    const res = validateVehicle({
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "Toyota",
      registerDate: "2026-07-08",
      status: "active",
      location: "",
      transmission: "",
      fuelType: "",
      seats: "",
      priceDay: "",
      publicDescription: "",
      vin: "",
      engineNumber: "",
      note: ""
    })

    expect(res.ok).toBe(true)
    expect(res.value).toMatchObject({
      location: "",
      transmission: "",
      fuelType: "",
      seats: null,
      priceDay: null,
      publicDescription: "",
      vin: "",
      engineNumber: "",
      note: ""
    })
  })

  test("可信档案字段区分公开摘要与内部记录并执行长度和日期校验", () => {
    const valid = validateVehicle({
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "Toyota",
      registerDate: "2026-07-08",
      status: "idle",
      publicMaterialsUpdatedDate: "2026-07-01",
      publicInspectionDate: "2026-06-30",
      publicInspectionSummary: "已完成常规检查",
      publicExteriorSummary: "右前轮毂有轻微使用痕迹",
      publicInsuranceSummary: "商业保险范围以有效保单为准",
      publicAssistanceSummary: "支持人工协调道路救援",
      publicArchiveReviewStatus: "reviewed",
      internalMaintenanceRecord: "内部工单编号 M-001",
      internalArchiveNote: "内部复核说明"
    })

    expect(valid.ok).toBe(true)
    expect(valid.value.publicInspectionSummary).toBe("已完成常规检查")
    expect(valid.value.internalMaintenanceRecord).toBe("内部工单编号 M-001")

    const invalid = validateVehicle({
      plateNumber: "京A12345",
      vehicleType: "sedan",
      brandModel: "Toyota",
      registerDate: "2026-07-08",
      status: "idle",
      publicMaterialsUpdatedDate: "2026-07-09",
      publicArchiveReviewStatus: "certified",
      publicExteriorSummary: "x".repeat(201),
      internalArchiveNote: "x".repeat(501)
    })
    expect(invalid.ok).toBe(false)
    expect(invalid.details.errors.map((item) => item.field)).toEqual(
      expect.arrayContaining([
        "publicMaterialsUpdatedDate",
        "publicArchiveReviewStatus",
        "publicExteriorSummary",
        "internalArchiveNote"
      ])
    )
  })
})
