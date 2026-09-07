const fs = require("fs")
const path = require("path")

const SEARCH_PAGES = [
  "privacy-request-manage",
  "audit-log-manage",
  "error-log-manage",
  "booking-manage",
  "vehicle-manage"
]

const ADMIN_PAGES = new Set([
  "analytics-manage", "role-manage", "config-manage", "audit-log-manage",
  "error-log-manage", "system-health", "vehicle-manage", "vehicle-create",
  "vehicle-edit", "vehicle-detail-manage", "operations-overview",
  "privacy-request-manage", "privacy-data-inventory"
])

function pageRootFor(pageName) {
  return ADMIN_PAGES.has(pageName) ? "pages-admin" : "pages"
}

describe("后台列表搜索入口", () => {
  test("共享放大镜、清除图标和按压反馈样式", () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, "../shared/management-shell.wxss"),
      "utf8"
    )

    expect(source).toContain(".management-page .management-search-icon")
    expect(source).toContain(".management-page .management-search-clear")
    expect(source).toContain(".management-page .management-search-clear-icon::before")
    expect(source).toContain(".management-page .management-search-clear-pressed")
  })

  test.each(SEARCH_PAGES)("%s 使用统一搜索结构并支持即时清空", (pageName) => {
    const pageDir = path.resolve(__dirname, `../${pageRootFor(pageName)}/${pageName}`)
    const wxmlSource = fs.readFileSync(path.join(pageDir, `${pageName}.wxml`), "utf8")
    const jsSource = fs.readFileSync(path.join(pageDir, `${pageName}.js`), "utf8")

    expect(wxmlSource).toContain('class="management-search"')
    expect(wxmlSource).toContain("management-search-icon")
    expect(wxmlSource).toContain('wx:if="{{keyword}}"')
    expect(wxmlSource).toContain('bindtap="handleClearKeyword"')
    expect(wxmlSource).toContain('aria-label="清空搜索关键词"')
    expect(jsSource).toMatch(/handleClearKeyword\(\)\s*\{[\s\S]*keyword:\s*""[\s\S]*this\.fetchList\(\)/)
  })
})
