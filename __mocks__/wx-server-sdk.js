function createCloud() {
  let mockContext = { OPENID: "" }
  let mockDb = null

  const cloud = {
    DYNAMIC_CURRENT_ENV: "mock",
    init: jest.fn(),
    database: jest.fn(() => mockDb),
    getWXContext: jest.fn(() => mockContext),
    deleteFile: jest.fn().mockResolvedValue({ fileList: [] }),
    openapi: {
      subscribeMessage: {
        send: jest.fn().mockResolvedValue({})
      }
    },
    __setMockContext: (ctx) => {
      mockContext = ctx
    },
    __setMockDb: (db) => {
      mockDb = db
    },
    __reset: () => {
      mockContext = { OPENID: "" }
      mockDb = null
      cloud.init.mockClear()
      cloud.database.mockClear()
      cloud.getWXContext.mockClear()
      cloud.deleteFile.mockClear()
      cloud.openapi.subscribeMessage.send.mockReset()
      cloud.openapi.subscribeMessage.send.mockResolvedValue({})
    }
  }

  return cloud
}

module.exports = createCloud()
