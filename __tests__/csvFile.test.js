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
      filePath: "/user-data/audit-export.csv",
      fileName: "audit-export.csv"
    })
    expect(writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "/user-data/audit-export.csv",
        data: "a,b",
        encoding: "utf8"
      })
    )
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
  })
})
