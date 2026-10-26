const fs = require("fs")
const path = require("path")
const routes = ["pages/booking-manage", "pages/booking-detail", "pages/booking-manage-detail", "pages-admin/audit-log-manage", "pages-admin/error-log-manage", "pages-admin/privacy-data-inventory"]

function loadPage(route) {
  let definition
  global.Page = (value) => { definition = value }
  require(`../${route}/${path.basename(route)}`)
  const page = { ...definition, data: JSON.parse(JSON.stringify(definition.data)) }
  page.setData = jest.fn((patch) => Object.assign(page.data, patch))
  global.getCurrentPages = () => [page]
  return page
}
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

describe("CSV preview page integration", () => {
  let reads
  beforeEach(() => {
    jest.resetModules()
    reads = []
    global.wx = { env: { USER_DATA_PATH: "/data" }, showToast: jest.fn(), openDocument: jest.fn(), getFileSystemManager: () => ({ stat: ({ success }) => success({ stats: { size: 20 } }), readFile: (options) => reads.push(options) }) }
  })
  afterEach(() => { delete global.Page; delete global.wx; delete global.getCurrentPages; delete global.getApp })

  test.each(routes)("%s opens actual CSV content in a registered preview and clears it on hide", async (route) => {
    const page = loadPage(route)
    const handover = route.endsWith("-detail")
    const field = handover ? "exportedHandoverPath" : "exportFilePath"
    page.data[field] = "/data/export.csv"
    page.data[handover ? "exportedHandoverFileName" : "exportFileName"] = "导出.csv"
    page[handover ? "handleOpenExportedHandover" : "handleOpenExportedFile"]()
    expect(reads).toHaveLength(1)
    reads[0].success({ data: '姓名,备注\n客户,"第一行\n第二行"' })
    await settle()
    expect(page.data.csvPreview.rows).toEqual([["姓名", "备注"], ["客户", "第一行\n第二行"]])
    expect(page.data.csvPreview.fileName).toBe("导出.csv")
    expect(wx.openDocument).not.toHaveBeenCalled()
    const sourcePath = path.resolve(__dirname, "..", route, path.basename(route))
    expect(JSON.parse(fs.readFileSync(`${sourcePath}.json`, "utf8")).usingComponents["csv-preview"]).toBe("/components/csv-preview/csv-preview")
    expect(fs.readFileSync(`${sourcePath}.wxml`, "utf8")).toContain('bindclose="handleCloseCsvPreview"')
    page.onHide()
    expect(page.data.csvPreview).toBeNull()
    page.onUnload()
  })

  test.each(["close", "hide", "unload", "replace", "switch-page"])("late reading cannot disclose content after %s", async (action) => {
    const page = loadPage("pages/booking-detail")
    page.data.exportedHandoverPath = "/data/export.csv"
    page.handleOpenExportedHandover()
    expect(reads).toHaveLength(1)
    if (action === "close") page.handleCloseCsvPreview()
    if (action === "hide") page.onHide()
    if (action === "unload") page.onUnload()
    if (action === "replace") page.data.exportedHandoverPath = "/data/other.csv"
    if (action === "switch-page") global.getCurrentPages = () => [{}]
    reads[0].success({ data: "private,content" })
    await settle()
    expect(page.data.csvPreview && page.data.csvPreview.rows || []).toEqual([])
    expect(wx.showToast).not.toHaveBeenCalled()
    if (action !== "unload") page.onUnload()
  })

  test.each(["pages/booking-detail", "pages/booking-manage-detail"])("%s explains unavailable file sharing", (route) => {
    const page = loadPage(route)
    page.data.exportedHandoverPath = "/data/export.csv"
    page.handleShareExportedHandover()
    expect(wx.showToast).toHaveBeenCalledWith(expect.objectContaining({ title: "请升级微信后分享" }))
    page.onUnload()
  })
})
