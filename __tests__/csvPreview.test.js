const { openCsvFile, parseCsvPreview, CSV_PREVIEW_MAX_BYTES } = require("../shared/csvFile")

describe("bounded local CSV preview", () => {
  afterEach(() => { jest.useRealTimers(); delete global.wx })

  test("parses BOM, quoted commas, escaped quotes and multiline fields without evaluating formulas", () => {
    const result = parseCsvPreview('\ufeff"姓名","备注"\r\n"李,女士","第一行\r\n第二行"\r\n"""昵称""","=1+1"')
    expect(result.rows).toEqual([["姓名", "备注"], ["李,女士", "第一行\r\n第二行"], ['"昵称"', "=1+1"]])
    expect(result.truncated).toBe(false)
  })

  test("limits rows, columns and cell length and reports partial content", () => {
    const rowLimited = parseCsvPreview(Array.from({ length: 101 }, (_, i) => `${i},x`).join("\n"))
    expect(rowLimited.rows).toHaveLength(100)
    expect(rowLimited.truncated).toBe(true)
    const columnLimited = parseCsvPreview(Array.from({ length: 31 }, (_, i) => String(i)).join(","))
    expect(columnLimited.rows[0]).toHaveLength(30)
    expect(columnLimited.truncated).toBe(true)
    const cellLimited = parseCsvPreview('"' + "长".repeat(2500) + '"')
    expect(cellLimited.rows[0][0].length).toBeLessThanOrEqual(2001)
    expect(cellLimited.truncated).toBe(true)
  })

  test("a byte-limited prefix never displays an unfinished quoted record", () => {
    expect(parseCsvPreview('a,b\n"部分\n内容', { partial: true })).toEqual({ rows: [["a", "b"]], truncated: true })
    expect(parseCsvPreview("a,b\nlast,part", { partial: true }).rows).toEqual([["a", "b"]])
    expect(parseCsvPreview("a,b\nlast,complete").rows).toEqual([["a", "b"], ["last", "complete"]])
  })

  test.each([0, 8, 500000])("uses file size %s to bound the native read, never openDocument", async (size) => {
    const readFile = jest.fn(({ success }) => success({ data: "a,b\nc,d\n" }))
    global.wx = { env: { USER_DATA_PATH: "/data" }, openDocument: jest.fn(), getFileSystemManager: () => ({ stat: ({ success }) => success({ stats: { size } }), readFile }) }
    const result = await openCsvFile("/data/export.csv")
    if (size) expect(readFile).toHaveBeenCalledWith(expect.objectContaining({ filePath: "/data/export.csv", encoding: "utf8", position: 0, length: Math.min(size, CSV_PREVIEW_MAX_BYTES) }))
    else expect(readFile).not.toHaveBeenCalled()
    expect(result.truncated).toBe(size > CSV_PREVIEW_MAX_BYTES)
    expect(wx.openDocument).not.toHaveBeenCalled()
  })

  test("rejects traversal and external paths before reading", async () => {
    const stat = jest.fn()
    global.wx = { env: { USER_DATA_PATH: "/data" }, getFileSystemManager: () => ({ stat }) }
    for (const filePath of ["/other/export.csv", "/data/../private.csv", "https://example.com/a.csv", "/data/file.pdf"]) {
      await expect(openCsvFile(filePath)).rejects.toThrow()
    }
    expect(stat).not.toHaveBeenCalled()
  })

  test("a stalled filesystem request times out without opening a native document", async () => {
    jest.useFakeTimers()
    global.wx = { env: { USER_DATA_PATH: "/data" }, getFileSystemManager: () => ({ stat: jest.fn(), readFile: jest.fn() }) }
    const result = openCsvFile("/data/export.csv")
    const rejection = expect(result).rejects.toThrow("预览读取超时")
    jest.advanceTimersByTime(10000)
    await rejection
  })
})
