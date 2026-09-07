const fs = require("fs")
const path = require("path")

const PROJECT_ROOT = path.resolve(__dirname, "..")

function readJson(relativePath) {
  return JSON.parse(
    fs.readFileSync(path.join(PROJECT_ROOT, relativePath), "utf8")
  )
}

function collectJavaScriptFiles(relativeRoot) {
  const files = []
  const walk = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(directory, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") {
          return
        }
        walk(absolutePath)
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        files.push(absolutePath)
      }
    })
  }
  walk(path.join(PROJECT_ROOT, relativeRoot))
  return files
}

describe("release hygiene", () => {
  test("提供统一的上线前检查命令", () => {
    const packageConfig = readJson("package.json")

    expect(packageConfig.scripts["check:release"]).toBe(
      "npm run check:structure && npm run check:secrets && npm run check:drafts && npm run check:package && npm test -- --runInBand"
    )
    expect(packageConfig.scripts["check:drafts"]).toBe("node scripts/contentDraftsValidate.js")
    expect(packageConfig.scripts["bootstrap:seeds"]).toBe("node scripts/bootstrapContentDrafts.js")
    expect(packageConfig.scripts["check:deploy"]).toBe("npm run check:release && npm run bootstrap:seeds")
    expect(packageConfig.scripts["audit:cloud"]).toBe(
      "npm audit --package-lock-only --omit=dev --audit-level=critical --prefix cloudfunctions/bookingCreate"
    )
  })

  test("正式编译开启合法域名校验", () => {
    const projectConfig = readJson("project.config.json")
    const privateProjectConfig = readJson("project.private.config.json")

    expect(projectConfig.setting.urlCheck).toBe(true)
    expect(privateProjectConfig.setting.urlCheck).toBe(true)
  })

  test("站点地图仅允许索引公开页面", () => {
    const sitemap = readJson("sitemap.json")
    const allowedPages = sitemap.rules
      .filter((item) => item.action === "allow")
      .map((item) => item.page)
      .sort()

    expect(allowedPages).toEqual([
      "pages/car-detail/car-detail",
      "pages/content-page/content-page",
      "pages/garage/garage"
    ])
    expect(sitemap.rules).toContainEqual({
      action: "disallow",
      page: "*"
    })
  })

  test("业务代码不包含日志输出或调试断点", () => {
    const roots = ["pages", "pages-admin", "components", "shared", "cloudfunctions"]
    const violations = []
    roots
      .flatMap(collectJavaScriptFiles)
      .forEach((filePath) => {
        const source = fs.readFileSync(filePath, "utf8")
        if (/\bconsole\.(?:log|debug|info)\s*\(|\bdebugger\s*;?/.test(source)) {
          violations.push(path.relative(PROJECT_ROOT, filePath).replace(/\\/g, "/"))
        }
      })

    expect(violations).toEqual([])
  })

  test("全部云函数使用统一的 Node.js 20 运行时和 SDK", () => {
    const cloudbaseConfig = readJson("cloudbaserc.json")
    const functionsRoot = path.join(PROJECT_ROOT, "cloudfunctions")
    const functionDirectories = fs
      .readdirSync(functionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
    const configuredNames = cloudbaseConfig.functions
      .map((item) => item.name)
      .sort()

    expect(new Set(configuredNames).size).toBe(configuredNames.length)
    expect(configuredNames).toEqual(functionDirectories)

    cloudbaseConfig.functions.forEach((item) => {
      expect(item).toMatchObject({
        type: "Event",
        handler: "index.main",
        runtime: "Nodejs20.19",
        memorySize: 256,
        installDependency: true
      })

      const functionRoot = path.join(functionsRoot, item.name)
      expect(fs.existsSync(path.join(functionRoot, "index.js"))).toBe(true)
      const packageConfig = JSON.parse(
        fs.readFileSync(path.join(functionRoot, "package.json"), "utf8")
      )
      expect(packageConfig.main).toBe("index.js")
      expect(packageConfig.dependencies["wx-server-sdk"]).toBe("4.0.2")

      const lockPath = path.join(functionRoot, "package-lock.json")
      expect(fs.existsSync(lockPath)).toBe(true)
      const lockConfig = JSON.parse(fs.readFileSync(lockPath, "utf8"))
      expect(lockConfig.packages[""].dependencies["wx-server-sdk"]).toBe("4.0.2")
      expect(lockConfig.packages["node_modules/wx-server-sdk"].version).toBe("4.0.2")
      expect(lockConfig.packages["node_modules/@cloudbase/node-sdk"].version).toBe(
        "3.17.2"
      )
      expect(lockConfig.packages["node_modules/protobufjs"].version).toBe("7.6.5")
      expect(lockConfig.packages["node_modules/request"]).toBeUndefined()
    })
  })

  test("小程序与云部署配置指向同一生产环境", () => {
    const appSource = fs.readFileSync(path.join(PROJECT_ROOT, "app.js"), "utf8")
    const cloudbaseConfig = readJson("cloudbaserc.json")

    expect(appSource).toContain(`cloudEnvId: "${cloudbaseConfig.envId}"`)
  })
})
