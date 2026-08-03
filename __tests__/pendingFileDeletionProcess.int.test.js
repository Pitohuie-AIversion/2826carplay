jest.mock("wx-server-sdk")

function createMockDb({ rolesData, queueData, vehicleData = null, vehicleError = null }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const queueGet = jest.fn().mockResolvedValue({ data: queueData })
  const queueRemove = jest.fn().mockResolvedValue({ stats: { removed: 1 } })
  const queueUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })
  const vehicleGet = vehicleError
    ? jest.fn().mockRejectedValue(vehicleError)
    : jest.fn().mockResolvedValue({ data: vehicleData })
  const vehicleField = jest.fn(() => ({ get: vehicleGet }))
  const vehicleDoc = jest.fn(() => ({ field: vehicleField }))

  const rolesWhere = jest.fn(() => ({
    limit: jest.fn(() => ({ get: rolesGet }))
  }))
  const queueLimit = jest.fn(() => ({ get: queueGet }))
  const queueField = jest.fn(() => ({ limit: queueLimit }))
  const queueDoc = jest.fn(() => ({
    remove: queueRemove,
    update: queueUpdate
  }))
  const serverDateValue = { __type: "serverDate" }
  const serverDate = jest.fn(() => serverDateValue)

  const db = {
    collection: jest.fn((name) => {
      if (name === "roles") {
        return { where: rolesWhere }
      }
      if (name === "pending_file_deletions") {
        return {
          field: queueField,
          limit: queueLimit,
          doc: queueDoc
        }
      }
      if (name === "audit_logs") {
        return { add: auditAdd }
      }
      if (name === "vehicles") {
        return { doc: vehicleDoc }
      }
      throw new Error(`Unexpected collection: ${name}`)
    }),
    serverDate
  }

  return {
    db,
    rolesWhere,
    queueGet,
    queueField,
    queueLimit,
    queueDoc,
    queueRemove,
    queueUpdate,
    auditAdd,
    vehicleDoc,
    vehicleField,
    vehicleGet,
    serverDateValue
  }
}

async function loadFunctionWith({ openid, mockDb }) {
  jest.resetModules()
  const freshCloud = require("wx-server-sdk")
  freshCloud.__reset()
  freshCloud.__setMockContext({ OPENID: openid })
  freshCloud.__setMockDb(mockDb)

  let mod = null
  jest.isolateModules(() => {
    mod = require("../cloudfunctions/pendingFileDeletionProcess/index")
  })
  return mod
}

describe("cloudfunctions/pendingFileDeletionProcess integration", () => {
  test("管理员可清理成功记录和空队列记录", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      queueData: [
        { _id: "queue_1", fileList: ["cloud://img1"] },
        { _id: "queue_2", fileList: [] }
      ]
    })
    const mod = await loadFunctionWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    cloud.deleteFile.mockResolvedValue({ fileList: [] })

    const res = await mod.main({ limit: 20 })

    expect(res).toEqual({
      ok: true,
      processed: 2,
      deleted: 1,
      failed: 0,
      invalid: 1,
      deferred: 0,
      preserved: 0,
      hasMore: false,
      message: "存储清理队列已处理"
    })
    expect(mocks.queueLimit).toHaveBeenCalledWith(100)
    expect(mocks.queueField).toHaveBeenCalledWith({
      _id: true,
      fileList: true,
      attemptCount: true,
      context: true,
      source: true,
      notBeforeAt: true
    })
    const fieldSpec = mocks.queueField.mock.calls[0][0]
    expect(fieldSpec).not.toHaveProperty("lastError")
    expect(fieldSpec).not.toHaveProperty("lastAttemptAt")
    expect(fieldSpec).not.toHaveProperty("createdAt")
    expect(cloud.deleteFile).toHaveBeenCalledWith({ fileList: ["cloud://img1"] })
    expect(mocks.queueRemove).toHaveBeenCalledTimes(2)
    expect(mocks.auditAdd).toHaveBeenCalledWith({
      data: {
        openid: "admin_openid",
        action: "pendingFileDeletionProcess",
        processed: 2,
        deleted: 1,
        failed: 0,
        invalid: 1,
        deferred: 0,
        preserved: 0,
        createdAt: mocks.serverDateValue
      }
    })
  })

  test("删除失败时保留队列并增加重试次数", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      queueData: [{ _id: "queue_1", fileList: ["cloud://img1"], attemptCount: 2 }]
    })
    const mod = await loadFunctionWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    cloud.deleteFile.mockRejectedValue(
      Object.assign(new Error("storage unavailable cloud://env/private/file.jpg"), {
        code: "STORAGE_UNAVAILABLE"
      })
    )

    const res = await mod.main()

    expect(res.failed).toBe(1)
    expect(res.deleted).toBe(0)
    expect(mocks.queueRemove).not.toHaveBeenCalled()
    expect(mocks.queueUpdate).toHaveBeenCalledWith({
      data: {
        attemptCount: 3,
        lastError: "云存储删除失败（错误码 STORAGE_UNAVAILABLE）",
        lastAttemptAt: mocks.serverDateValue
      }
    })
    expect(JSON.stringify(mocks.queueUpdate.mock.calls)).not.toContain("cloud://")
  })

  test("部分文件失败时只保留失败文件", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "admin_openid", role: "admin" }],
      queueData: [{ _id: "queue_1", fileList: ["cloud://img1", "cloud://img2"] }]
    })
    const mod = await loadFunctionWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    cloud.deleteFile.mockResolvedValue({
      fileList: [
        { fileID: "cloud://img1", status: 0 },
        { fileID: "cloud://img2", status: -1, errMsg: "delete failed" }
      ]
    })

    const res = await mod.main()

    expect(res.failed).toBe(1)
    expect(mocks.queueRemove).not.toHaveBeenCalled()
    expect(mocks.queueUpdate).toHaveBeenCalledWith({
      data: {
        fileList: ["cloud://img2"],
        attemptCount: 1,
        lastError: "部分文件删除失败",
        lastAttemptAt: mocks.serverDateValue
      }
    })
  })

  test("云存储确认文件已不存在时直接完成清理任务", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      queueData: [{ _id: "queue_1", fileList: ["cloud://missing.jpg"] }]
    })
    const mod = await loadFunctionWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    cloud.deleteFile.mockResolvedValue({
      fileList: [{
        fileID: "cloud://missing.jpg",
        status: -1,
        errMsg: "file not found"
      }]
    })

    const res = await mod.main()

    expect(res.deleted).toBe(1)
    expect(res.failed).toBe(0)
    expect(mocks.queueRemove).toHaveBeenCalledWith()
    expect(mocks.queueUpdate).not.toHaveBeenCalled()
  })

  test("整批删除返回文件不存在错误时同样移除任务", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      queueData: [{ _id: "queue_1", fileList: ["cloud://missing.jpg"] }]
    })
    const mod = await loadFunctionWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    cloud.deleteFile.mockRejectedValue(
      Object.assign(new Error("file does not exist"), {
        code: "STORAGE_FILE_NOT_EXIST"
      })
    )

    const res = await mod.main()

    expect(res.deleted).toBe(1)
    expect(res.failed).toBe(0)
    expect(mocks.queueRemove).toHaveBeenCalledWith()
    expect(mocks.queueUpdate).not.toHaveBeenCalled()
  })

  test("未到安全核验时间的上传清理任务不会提前删除", async () => {
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      queueData: [{
        _id: "queue_1",
        fileList: ["cloud://orphan.jpg"],
        context: { vehicleId: "car_1", action: "cleanupUpload" },
        source: "vehicleImageUploadCleanup",
        notBeforeAt: new Date(Date.now() + 60 * 1000)
      }]
    })
    const mod = await loadFunctionWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")

    const res = await mod.main()

    expect(res.deferred).toBe(1)
    expect(res.message).toBe("图片仍在安全核验期，请稍后重试")
    expect(cloud.deleteFile).not.toHaveBeenCalled()
    expect(mocks.vehicleDoc).not.toHaveBeenCalled()
    expect(mocks.queueRemove).not.toHaveBeenCalled()
  })

  test("等待中的图片任务不会阻塞后续已到期任务", async () => {
    const deferredTasks = Array.from({ length: 5 }, (_, index) => ({
      _id: `deferred_${index}`,
      fileList: [`cloud://deferred_${index}.jpg`],
      context: { vehicleId: "car_1", action: "cleanupUpload" },
      source: "vehicleImageUploadCleanup",
      notBeforeAt: new Date(Date.now() + 60 * 1000)
    }))
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      queueData: [
        ...deferredTasks,
        { _id: "ready_1", fileList: ["cloud://ready.jpg"], source: "vehicleDelete" }
      ]
    })
    const mod = await loadFunctionWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    cloud.deleteFile.mockResolvedValue({ fileList: [] })

    const res = await mod.main()

    expect(cloud.deleteFile).toHaveBeenCalledTimes(1)
    expect(cloud.deleteFile).toHaveBeenCalledWith({ fileList: ["cloud://ready.jpg"] })
    expect(res.processed).toBe(1)
    expect(res.deleted).toBe(1)
    expect(res.deferred).toBe(0)
    expect(res.hasMore).toBe(true)
    expect(res.message).toBe("存储清理队列已处理")
  })

  test("核验后只删除未被车辆引用的上传文件", async () => {
    const referenced = "cloud://env/vehicle-images/car_1/active.jpg"
    const orphan = "cloud://env/vehicle-images/car_1/orphan.jpg"
    const mocks = createMockDb({
      rolesData: [{ role: "admin" }],
      vehicleData: { imageList: [referenced] },
      queueData: [{
        _id: "queue_1",
        fileList: [referenced, orphan],
        context: { vehicleId: "car_1", action: "cleanupUpload" },
        source: "vehicleImageUploadCleanup",
        notBeforeAt: new Date(Date.now() - 1000)
      }]
    })
    const mod = await loadFunctionWith({ openid: "admin_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")
    cloud.deleteFile.mockResolvedValue({ fileList: [] })

    const res = await mod.main()

    expect(cloud.deleteFile).toHaveBeenCalledWith({ fileList: [orphan] })
    expect(mocks.vehicleField).toHaveBeenCalledWith({ imageList: true })
    expect(mocks.queueRemove).toHaveBeenCalledWith()
    expect(res.deleted).toBe(1)
    expect(res.preserved).toBe(1)
  })

  test("非管理员不能处理存储清理队列", async () => {
    const mocks = createMockDb({
      rolesData: [{ openid: "user_openid", role: "member" }],
      queueData: [{ _id: "queue_1", fileList: ["cloud://img1"] }]
    })
    const mod = await loadFunctionWith({ openid: "user_openid", mockDb: mocks.db })
    const cloud = require("wx-server-sdk")

    const res = await mod.main()

    expect(res).toEqual({
      ok: false,
      code: "FORBIDDEN",
      message: "权限不足"
    })
    expect(mocks.queueGet).not.toHaveBeenCalled()
    expect(cloud.deleteFile).not.toHaveBeenCalled()
  })
})
