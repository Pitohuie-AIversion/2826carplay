function loadModule() {
  jest.resetModules()
  return require("../shared/csvFile")
}

describe("shared/csvFile", () => {
  afterEach(() => {
    delete global.wx
  })

  test("保存 CSV 时补充扩展名并使用用户目录", async () => {
    const writeFile = jest.fn(({ success }) => success())
    global.wx = {
      env: { USER_DATA_PATH: "/user-data" },
      getFileSystemManager: jest.fn(() => ({ writeFile }))
    }
    const helper = loadModule()

    const result = await helper.saveCsvFile({
      fileName: "audit-export",
      csvText: "a,b"
    })

    expect(result).toEqual({
      filePath: expect.stringMatching(/^\/user-data\/csv_[a-z0-9_]+\.csv$/),
      fileName: "audit-export.csv"
    })
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: result.filePath,
        data: "a,b",
        encoding: "utf8"
      })
    )
  })

  test("同名并发保存分别拥有文件路径且保留分享文件名", async () => {
    const writes = []
    global.wx = {
      env: { USER_DATA_PATH: "/user-data" },
      getFileSystemManager: () => ({ writeFile: (options) => writes.push(options) })
    }
    const helper = loadModule()
    const first = helper.saveCsvFile({ fileName: "same.csv", csvText: "old" })
    const second = helper.saveCsvFile({ fileName: "same.csv", csvText: "new" })
    expect(writes[0].filePath).not.toBe(writes[1].filePath)
    writes[1].success()
    writes[0].success()
    expect((await first).fileName).toBe("same.csv")
    expect((await second).fileName).toBe("same.csv")
  })

  test("写入失败清理自己的部分文件并保留原始错误", async () => {
    const failure = new Error("disk full")
    const unlink = jest.fn(({ success }) => success())
    const writeFile = jest.fn(({ fail }) => fail(failure))
    global.wx = {
      env: { USER_DATA_PATH: "/user-data" },
      getFileSystemManager: () => ({ writeFile, unlink })
    }
    const helper = loadModule()
    await expect(helper.saveCsvFile({ fileName: "same.csv", csvText: "partial" })).rejects.toBe(failure)
    expect(unlink).toHaveBeenCalledWith(expect.objectContaining({
      filePath: writeFile.mock.calls[0][0].filePath
    }))
  })

  test("文件系统初始化异常作为 Promise 失败返回", async () => {
    global.wx = { getFileSystemManager: () => { throw new Error("fs unavailable") } }
    const helper = loadModule()
    await expect(helper.saveCsvFile({ fileName: "same.csv" })).rejects.toThrow("fs unavailable")
  })

  test("开发者工具不显示直接分享能力", () => {
    global.wx = {
      getSystemInfoSync: jest.fn(() => ({ platform: "devtools" })),
      shareFileMessage: jest.fn()
    }
    const helper = loadModule()

    expect(helper.canShareCsvFile()).toBe(false)
  })

  test("区分用户主动取消与真实文件错误", () => {
    global.wx = {}
    const helper = loadModule()

    expect(helper.isUserCancelError({ errMsg: "shareFileMessage:fail cancel" })).toBe(true)
    expect(helper.isUserCancelError({ message: "openDocument:fail unavailable" })).toBe(false)
  })

  test("只允许删除小程序目录内的 CSV 文件", async () => {
    const unlink = jest.fn(({ success }) => success())
    global.wx = {
      env: { USER_DATA_PATH: "/user-data" },
      getFileSystemManager: jest.fn(() => ({ unlink }))
    }
    const helper = loadModule()

    await helper.removeCsvFile("/user-data/audit-logs.csv")

    expect(unlink).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/user-data/audit-logs.csv"
      })
    )
    await expect(helper.removeCsvFile("/other/private.csv")).rejects.toThrow(
      "仅允许删除小程序目录内的 CSV 文件"
    )
    await expect(helper.removeCsvFile("/user-data/not-csv.txt")).rejects.toThrow(
      "仅允许删除小程序目录内的 CSV 文件"
    )
    await expect(helper.removeCsvFile("/user-data/../private.csv")).rejects.toThrow(
      "仅允许删除小程序目录内的 CSV 文件"
    )
  })
})
