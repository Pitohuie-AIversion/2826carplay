const fs = require("fs")
const os = require("os")
const path = require("path")
const {
  checkProjectStructure
} = require("../scripts/checkProjectStructure")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const temporaryRoots = []

function writeFile(root, relativePath, content) {
  const absolutePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true })
  fs.writeFileSync(absolutePath, content)
}

describe("project structure check", () => {
  afterEach(() => {
    while (temporaryRoots.length) {
      fs.rmSync(temporaryRoots.pop(), { recursive: true, force: true })
    }
  })

  test("当前页面和云函数清单完整一致", () => {
    const result = checkProjectStructure(PROJECT_ROOT)

    expect(result.ok).toBe(true)
    expect(result.pageCount).toBe(26)
    expect(result.functionCount).toBe(49)
    expect(result.violations).toEqual([])
  })

  test("管理页面使用明确的系统导航标题", () => {
    const expectedTitles = {
      "audit-log-manage": "审计日志",
      "config-manage": "运营配置",
      "error-log-manage": "错误日志",
      "role-manage": "权限管理"
    }

    Object.entries(expectedTitles).forEach(([pageName, title]) => {
      const config = JSON.parse(fs.readFileSync(
        path.join(PROJECT_ROOT, "pages", pageName, `${pageName}.json`),
        "utf8"
      ))

      expect(config.navigationBarTitleText).toBe(title)
    })
  })

  test("全部页面配置完整且下拉刷新能力与生命周期一致", () => {
    const appConfig = JSON.parse(fs.readFileSync(
      path.join(PROJECT_ROOT, "app.json"),
      "utf8"
    ))

    expect(appConfig.pages).toHaveLength(26)

    appConfig.pages.forEach((route) => {
      const configPath = path.join(PROJECT_ROOT, `${route}.json`)
      const pagePath = path.join(PROJECT_ROOT, `${route}.js`)

      expect(fs.existsSync(configPath)).toBe(true)
      const config = JSON.parse(fs.readFileSync(configPath, "utf8"))
      const pageSource = fs.readFileSync(pagePath, "utf8")
      const hasPullDownHandler = /\bonPullDownRefresh\s*\(/.test(pageSource)

      expect(config.enablePullDownRefresh === true).toBe(hasPullDownHandler)
      if (hasPullDownHandler) {
        expect(config.backgroundColor).toMatch(/^#[0-9a-f]{6}$/i)
        expect(config.backgroundTextStyle).toBe("light")
      }
    })

    const contentConfig = JSON.parse(fs.readFileSync(
      path.join(PROJECT_ROOT, "pages/content-page/content-page.json"),
      "utf8"
    ))
    expect(contentConfig.navigationBarTitleText).toBe("服务指南")
  })

  test("能发现重复路由、缺失页面和漏配云函数", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "jijing-structure-"))
    temporaryRoots.push(root)
    writeFile(
      root,
      "app.json",
      JSON.stringify({
        pages: ["pages/home/home", "pages/home/home"]
      })
    )
    writeFile(root, "pages/home/home.wxml", "<view />")
    writeFile(root, "pages/orphan/orphan.wxml", "<view />")
    writeFile(
      root,
      "cloudbaserc.json",
      JSON.stringify({
        functionRoot: "./cloudfunctions",
        functions: [
          { name: "configuredOnly", installDependency: true },
          { name: "configuredOnly" }
        ]
      })
    )
    writeFile(root, "cloudfunctions/localOnly/index.js", "exports.main = () => {}")

    const result = checkProjectStructure(root)
    const types = result.violations.map((item) => item.type)

    expect(result.ok).toBe(false)
    expect(types).toEqual(expect.arrayContaining([
      "duplicate_page",
      "missing_page_file",
      "undeclared_page",
      "duplicate_function",
      "unsafe_function_package",
      "missing_function",
      "undeclared_function"
    ]))
  })
})
