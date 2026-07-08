jest.mock("wx-server-sdk")

function createMockDb({ rolesData, currentData, updateResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = jest.fn().mockResolvedValue(updateResult)

  const rolesLimit = jest.fn(() => ({ get: rolesGet }))
  const rolesWhere = jest.fn(() => ({ limit: rolesLimit }))

  const vehiclesDoc = jest.fn(() => ({
    get: currentGet,
    update
  }))

  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "vehicles") {
        return { doc: vehiclesDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesWhere,
    rolesLimit,
    vehiclesDoc,
    currentGet,
    update,
    serverDateValue
  }
}

async function loadVehicleImageUpdateWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/vehicleImageUpdate/index")
  })

  return mod
}

describe("cloudfunctions/vehicleImageUpdate integration", () => {
  test("admin 新增图片并自动设置首张为封面", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "car_1",
        imageList: [],
        coverImage: ""
      },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleImageUpdate = await loadVehicleImageUpdateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleImageUpdate.main({
      id: "car_1",
      action: "add",
      fileIds: ["cloud://img1", "cloud://img2"]
    })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      action: "add",
      imageList: ["cloud://img1", "cloud://img2"],
      coverImage: "cloud://img1",
      imageCount: 2
    })
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        imageList: ["cloud://img1", "cloud://img2"],
        coverImage: "cloud://img1",
        updatedAt: mocks.serverDateValue
      }
    })
  })

  test("admin 设置封面成功", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "car_1",
        imageList: ["cloud://img1", "cloud://img2"],
        coverImage: "cloud://img1"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleImageUpdate = await loadVehicleImageUpdateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleImageUpdate.main({
      id: "car_1",
      action: "setCover",
      fileId: "cloud://img2"
    })

    expect(res.coverImage).toBe("cloud://img2")
    expect(mocks.update).toHaveBeenCalled()
  })

  test("admin 移除当前封面后自动切换下一张", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "car_1",
        imageList: ["cloud://img1", "cloud://img2"],
        coverImage: "cloud://img1"
      },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleImageUpdate = await loadVehicleImageUpdateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleImageUpdate.main({
      id: "car_1",
      action: "remove",
      fileId: "cloud://img1"
    })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      action: "remove",
      imageList: ["cloud://img2"],
      coverImage: "cloud://img2",
      imageCount: 1
    })
  })

  test("非法 action 返回 VALIDATION_ERROR", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: { _id: "car_1", imageList: [], coverImage: "" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleImageUpdate = await loadVehicleImageUpdateWith({ openid: "admin_openid", mockDb: mocks.db })

    const res = await vehicleImageUpdate.main({
      id: "car_1",
      action: "invalid"
    })

    expect(res.ok).toBe(false)
    expect(res.code).toBe("VALIDATION_ERROR")
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
  })

  test("非 admin 返回 FORBIDDEN", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "user" }],
      currentData: { _id: "car_1", imageList: [], coverImage: "" },
      updateResult: { stats: { updated: 1 } }
    })

    const vehicleImageUpdate = await loadVehicleImageUpdateWith({ openid: "user_openid", mockDb: mocks.db })

    const res = await vehicleImageUpdate.main({
      id: "car_1",
      action: "add",
      fileIds: ["cloud://img1"]
    })

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
  })
})
