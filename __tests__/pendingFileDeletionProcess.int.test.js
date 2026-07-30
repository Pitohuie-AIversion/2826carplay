jest.mock("wx-server-sdk")

function createMockDb({ rolesData, queueData }) {
  const rolesGet = jest.fn().mockResolvedValue({ data: rolesData })
  const queueGet = jest.fn().mockResolvedValue({ data: queueData })
  const queueRemove = jest.fn().mockResolvedValue({ stats: { removed: 1 } })
  const queueUpdate = jest.fn().mockResolvedValue({ stats: { updated: 1 } })
  const auditAdd = jest.fn().mockResolvedValue({ _id: "audit_1" })

  const rolesWhere = jest.fn(() => ({
    limit: jest.fn(() => ({ get: rolesGet }))
  }))
  const queueLimit = jest.fn(() => ({ get: queueGet }))
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
          limit: queueLimit,
          doc: queueDoc
        }
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
    queueGet,
    queueLimit,
    queueDoc,
    queueRemove,
    queueUpdate,
    auditAdd,
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
      hasMore: false,
      message: "存储清理队列已处理"
    })
    expect(mocks.queueLimit).toHaveBeenCalledWith(5)
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
    cloud.deleteFile.mockRejectedValue(new Error("storage unavailable"))

    const res = await mod.main()

    expect(res.failed).toBe(1)
    expect(res.deleted).toBe(0)
    expect(mocks.queueRemove).not.toHaveBeenCalled()
    expect(mocks.queueUpdate).toHaveBeenCalledWith({
      data: {
        attemptCount: 3,
        lastError: "storage unavailable",
        lastAttemptAt: mocks.serverDateValue
      }
    })
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
