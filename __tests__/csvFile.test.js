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

  test.each(["late-fail", "throw-after-success"])("写入已交付后 %s 不删除已导出的文件", async (mode) => {
    const files = new Set()
    let write
    const unlink = jest.fn(({ filePath, success }) => { files.delete(filePath); success() })
    global.wx = {
      env: { USER_DATA_PATH: "/user-data" },
      getFileSystemManager: () => ({
        unlink,
        writeFile: (options) => {
          write = options
          files.add(options.filePath)
          options.success()
          if (mode === "throw-after-success") throw new Error("bridge completed then threw")
        }
      })
    }
    const helper = loadModule()
    const result = await helper.saveCsvFile({ fileName: "saved.csv", csvText: "private,content" })
    if (mode === "late-fail") write.fail(new Error("duplicate failure"))
    expect(files.has(result.filePath)).toBe(true)
    expect(unlink).not.toHaveBeenCalled()
  })

  test("文件系统初始化异常作为 Promise 失败返回", async () => {
    global.wx = { getFileSystemManager: () => { throw new Error("fs unavailable") } }
    const helper = loadModule()
    await expect(helper.saveCsvFile({ fileName: "same.csv" })).rejects.toThrow("fs unavailable")
  })

  test("取消待写文件立即结算并回收迟到成功产生的内容", async () => {
    let write
    const files = new Set()
    const unlink = jest.fn(({ filePath, success }) => { files.delete(filePath); success() })
    global.wx = {
      env: { USER_DATA_PATH: "/user-data" },
      getFileSystemManager: () => ({ unlink, writeFile: (options) => { write = options; files.add(options.filePath) } })
    }
    const pending = loadModule().saveCsvFile({ fileName: "private.csv", csvText: "private" })
    const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" })
    pending.cancel()
    pending.cancel()
    await rejected
    expect(files.has(write.filePath)).toBe(false)
    expect(unlink).toHaveBeenCalledTimes(1)
    files.add(write.filePath)
    write.success()
    expect(files.has(write.filePath)).toBe(false)
    expect(unlink).toHaveBeenCalledTimes(2)
  })

  test("成功写入后取消不能删除已交付文件", async () => {
    const unlink = jest.fn()
    global.wx = {
      env: { USER_DATA_PATH: "/user-data" },
      getFileSystemManager: () => ({ unlink, writeFile: ({ success }) => success() })
    }
    const saved = loadModule().saveCsvFile({ fileName: "saved.csv", csvText: "content" })
    await expect(saved).resolves.toMatchObject({ fileName: "saved.csv" })
    saved.cancel()
    expect(unlink).not.toHaveBeenCalled()
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
