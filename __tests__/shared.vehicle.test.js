const {
  isValidPlateNumber,
  isValidYmdDate,
  validateVehicle,
  normalizePlateNumber
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
      note: "  ok "
    })
    expect(res.ok).toBe(true)
    expect(res.value.plateNumber).toBe("京A12345")
    expect(res.value.brandModel).toBe("Toyota")
    expect(res.value.note).toBe("ok")
  })
})
