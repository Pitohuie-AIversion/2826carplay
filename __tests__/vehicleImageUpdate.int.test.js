jest.mock("wx-server-sdk")

function createMockDb({ rolesData, currentData, updateResult }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const currentGet = jest.fn().mockResolvedValue({ data: currentData })
  const update = jest.fn().mockResolvedValue(updateResult)
  const queueAdd = jest.fn().mockResolvedValue({ _id: "queue_1" })
  const queueSet = jest.fn().mockResolvedValue({ stats: { created: 1, updated: 1 } })
  const queueDoc = jest.fn(() => ({ set: queueSet }))
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

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
      if (name === "pending_file_deletions") {
        return { add: queueAdd, doc: queueDoc }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
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
    queueAdd,
    queueDoc,
    queueSet,
    auditAdd,
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
      fileIds: [
        "cloud://env.bucket/vehicle-images/car_1/img1.jpg",
        "cloud://env.bucket/vehicle-images/car_1/img2.jpg"
      ]
    })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      action: "add",
      imageList: [
        "cloud://env.bucket/vehicle-images/car_1/img1.jpg",
        "cloud://env.bucket/vehicle-images/car_1/img2.jpg"
      ],
      coverImage: "cloud://env.bucket/vehicle-images/car_1/img1.jpg",
      imageCount: 2
    })
    expect(mocks.update).toHaveBeenCalledWith({
      data: {
        imageList: [
          "cloud://env.bucket/vehicle-images/car_1/img1.jpg",
          "cloud://env.bucket/vehicle-images/car_1/img2.jpg"
        ],
        coverImage: "cloud://env.bucket/vehicle-images/car_1/img1.jpg",
        updatedAt: mocks.serverDateValue
      }
    })
  })

  test("admin 可一次新增 9 张图片", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "car_1",
        imageList: [],
        coverImage: ""
      },
      updateResult: { stats: { updated: 1 } }
    })
    const vehicleImageUpdate = await loadVehicleImageUpdateWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })
    const fileIds = Array.from(
      { length: 9 },
      (_, index) => `cloud://env.bucket/vehicle-images/car_1/img${index + 1}.jpg`
    )

    const res = await vehicleImageUpdate.main({
      id: "car_1",
      action: "add",
      fileIds
    })

    expect(res).toMatchObject({
      ok: true,
      id: "car_1",
      action: "add",
      imageList: fileIds,
      coverImage: fileIds[0],
      imageCount: 9
    })
    expect(mocks.update).toHaveBeenCalled()
  })

  test("admin 一次新增 10 张图片时被后端拒绝", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: {
        _id: "car_1",
        imageList: [],
        coverImage: ""
      },
      updateResult: { stats: { updated: 1 } }
    })
    const vehicleImageUpdate = await loadVehicleImageUpdateWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })
    const fileIds = Array.from(
      { length: 10 },
      (_, index) => `cloud://env.bucket/vehicle-images/car_1/img${index + 1}.jpg`
    )

    const res = await vehicleImageUpdate.main({
      id: "car_1",
      action: "add",
      fileIds
    })

    expect(res).toMatchObject({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "最多只能上传 9 张图片"
    })
    expect(mocks.update).not.toHaveBeenCalled()
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

    const cloud = require("wx-server-sdk")

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      action: "remove",
      imageList: ["cloud://img2"],
      coverImage: "cloud://img2",
      imageCount: 1
    })
    expect(cloud.deleteFile).toHaveBeenCalledWith({
      fileList: ["cloud://img1"]
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

  test("不能把其他车辆目录的云图片添加到当前车辆", async () => {
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
      fileIds: ["cloud://env.bucket/vehicle-images/car_2/img1.jpg"]
    })

    expect(res).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "图片不属于当前车辆目录",
      details: {
        errors: [{ field: "fileIds", message: "只能添加当前车辆目录下的云图片" }]
      }
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })

  test("资料保存失败后登记延迟核验清理且不立即删除文件", async () => {
    const mocks = createMockDb({
      rolesData: [{ permissions: ["vehicle_manage"] }],
      currentData: null,
      updateResult: { stats: { updated: 0 } }
    })
    const vehicleImageUpdate = await loadVehicleImageUpdateWith({
      openid: "manager_openid",
      mockDb: mocks.db
    })
    const cloud = require("wx-server-sdk")
    const fileIds = ["cloud://env.bucket/vehicle-images/car_1/orphan.jpg"]

    const res = await vehicleImageUpdate.main({
      id: "car_1",
      action: "cleanupUpload",
      fileIds
    })

    expect(res).toEqual({
      ok: true,
      id: "car_1",
      action: "cleanupUpload",
      requestedCount: 1,
      queuedCount: 1,
      message: "已提交未入库图片核验清理"
    })
    expect(cloud.deleteFile).not.toHaveBeenCalled()
    expect(mocks.vehiclesDoc).not.toHaveBeenCalled()
    expect(mocks.queueDoc).toHaveBeenCalledWith(
      expect.stringMatching(/^pending_image_cleanup_[a-f0-9]{32}$/)
    )
    expect(mocks.queueSet).toHaveBeenCalledWith({
      data: {
        fileList: [fileIds[0]],
        context: {
          vehicleId: "car_1",
          action: "cleanupUpload"
        },
        source: "vehicleImageUploadCleanup",
        notBeforeAt: expect.any(Date),
        createdAt: mocks.serverDateValue
      }
    })
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "manager_openid",
        action: "vehicleImageUpdate",
        vehicleId: "car_1",
        imageAction: "cleanupUpload",
        fileIdsCount: 1,
        createdAt: mocks.serverDateValue
      }
    })
  })

  test("清理动作拒绝其他车辆目录的图片", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: null,
      updateResult: { stats: { updated: 0 } }
    })
    const vehicleImageUpdate = await loadVehicleImageUpdateWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })
    const fileIds = ["cloud://env.bucket/vehicle-images/car_2/orphan.jpg"]

    const res = await vehicleImageUpdate.main({
      id: "car_1",
      action: "cleanupUpload",
      fileIds
    })

    expect(res).toEqual({
      ok: false,
      code: "VALIDATION_ERROR",
      message: "图片不属于当前车辆目录",
      details: {
        errors: [{ field: "fileIds", message: "只能清理当前车辆目录下的云图片" }]
      }
    })
    expect(mocks.queueDoc).not.toHaveBeenCalled()
  })

  test("重复提交同一图片时复用确定性清理任务编号", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      currentData: null,
      updateResult: { stats: { updated: 0 } }
    })
    const vehicleImageUpdate = await loadVehicleImageUpdateWith({
      openid: "admin_openid",
      mockDb: mocks.db
    })
    const event = {
      id: "car_1",
      action: "cleanupUpload",
      fileIds: ["cloud://env.bucket/vehicle-images/car_1/1700000000000_0.jpg"]
    }

    await vehicleImageUpdate.main(event)
    await vehicleImageUpdate.main(event)

    const taskIds = mocks.queueDoc.mock.calls.map((call) => call[0])
    expect(taskIds).toHaveLength(2)
    expect(new Set(taskIds).size).toBe(1)
    expect(mocks.queueSet).toHaveBeenCalledTimes(2)
    const notBeforeTimes = mocks.queueSet.mock.calls.map(
      (call) => call[0].data.notBeforeAt.getTime()
    )
    expect(new Set(notBeforeTimes)).toEqual(new Set([1700000030000]))
  })
})
