jest.mock("wx-server-sdk")

function createMockDb({ rolesData, currentData, currentError = null, removeResult, bookingsData = [] }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const currentGet = currentError
    ? jest.fn().mockRejectedValue(currentError)
    : jest.fn().mockResolvedValue({ data: currentData })
  const remove = jest.fn().mockResolvedValue(removeResult)
  const bookingsGet = jest.fn().mockResolvedValue({ data: bookingsData })

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const vehiclesDoc = jest.fn(() => ({
    get: currentGet,
    remove
  }))
  const bookingsLimit = jest.fn(() => ({ get: bookingsGet }))
  const bookingsWhere = jest.fn(() => ({ limit: bookingsLimit }))

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "vehicles") {
        return { doc: vehiclesDoc }
      }
      if (name === "bookings") {
        return { where: bookingsWhere }
      }
      throw new Error(`Unexpected collection: ${name}`)
    })
  }

  return {
    db,
    rolesWhere,
    rolesLimit,
    vehiclesDoc,
    currentGet,
    remove,
    bookingsWhere,
    bookingsLimit,
    bookingsGet
  }
}

async function loadVehicleDeleteWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleDelete/index")
  })

  return mod
}

describe("cloudfunctions/vehicleDelete integration", () => {
  test("admin 合法删除车辆", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "car_1",
        plateNumber: "京A12345",
        imageList: ["cloud://img1", "cloud://img2"],
        coverImage: "cloud://img2"
      },
      removeResult: { stats: { removed: 1 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDelete.main({ id: "car_1" })

    const cloud = require("wx-server-sdk")

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      message: "车辆已删除"
    })
    expect(mocks.rolesWhere).toHaveBeenCalledWith({ openid: "admin_openid" })
    expect(mocks.vehiclesDoc).toHaveBeenCalledWith("car_1")
    expect(mocks.bookingsWhere).toHaveBeenCalledWith({ vehicleId: "car_1" })
    expect(mocks.bookingsLimit).toHaveBeenCalledWith(1)
    expect(mocks.remove).toHaveBeenCalledTimes(1)
    expect(cloud.deleteFile).toHaveBeenCalledWith({
      fileList: ["cloud://img1", "cloud://img2"]
    })
  })

  test("缺少 id 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", plateNumber: "京A12345" },
      removeResult: { stats: { removed: 1 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDelete.main({})

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  test("车辆不存在时返回 NOT_FOUND", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: null,
      removeResult: { stats: { removed: 1 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDelete.main({ id: "car_missing" })

    expect(res).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "车辆不存在"
    })
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  test("云数据库以异常表示文档不存在时仍返回 NOT_FOUND", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: null,
      currentError: Object.assign(new Error("document not found"), {
        code: "DATABASE_DOCUMENT_NOT_EXIST"
      }),
      removeResult: { stats: { removed: 0 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await vehicleDelete.main({ id: "car_missing" })

    expect(res).toEqual({
      ok: false,
      code: "NOT_FOUND",
      message: "车辆不存在或已被删除"
    })
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  test("数据库实际删除数为零时不误报删除成功", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", imageList: [], coverImage: "" },
      removeResult: { stats: { removed: 0 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "admin_openid", mockDb: mocks.db })
    const res = await vehicleDelete.main({ id: "car_1" })
    const cloud = require("wx-server-sdk")

    expect(res).toEqual({
      ok: false,
      code: "DELETE_CONFLICT",
      message: "车辆未能删除，可能已被其他管理员处理，请刷新后重试"
    })
    expect(cloud.deleteFile).not.toHaveBeenCalled()
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      currentData: { _id: "car_1", plateNumber: "京A12345" },
      removeResult: { stats: { removed: 1 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await vehicleDelete.main({ id: "car_1" })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.remove).not.toHaveBeenCalled()
  })

  test("存在预约历史时禁止物理删除车辆", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", plateNumber: "京A12345" },
      bookingsData: [{ _id: "booking_1", vehicleId: "car_1", status: "cancelled" }],
      removeResult: { stats: { removed: 1 } }
    })

    const vehicleDelete = await loadVehicleDeleteWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleDelete.main({ id: "car_1" })
    const cloud = require("wx-server-sdk")

    expect(res).toEqual({
      ok: false,
      code: "VEHICLE_HAS_BOOKINGS",
      message: "车辆存在预约记录，请改为停用车辆"
    })
    expect(mocks.bookingsWhere).toHaveBeenCalledWith({ vehicleId: "car_1" })
    expect(mocks.remove).not.toHaveBeenCalled()
    expect(cloud.deleteFile).not.toHaveBeenCalled()
  })
})
