const fs = require("fs")
const path = require("path")

const PROJECT_ROOT = path.resolve(__dirname, "..")
const RULES_ROOT = path.join(PROJECT_ROOT, "security-rules")

function readJson(fileName) {
  return JSON.parse(fs.readFileSync(path.join(RULES_ROOT, fileName), "utf8"))
}

describe("production security rules", () => {
  test("数据库规则覆盖全部业务集合并禁止客户端直连", () => {
    const manifest = readJson("manifest.json")
    const databaseRule = readJson(manifest.database.ruleFile)
    const expectedCollections = [
      "analytics_events",
      "app_configs",
      "audit_logs",
      "bookings",
      "error_logs",
      "favorites",
      "pending_file_deletions",
      "privacy_requests",
      "roles",
      "vehicles"
    ]

    expect(manifest.database.collections.slice().sort()).toEqual(expectedCollections)
    expect(databaseRule).toEqual({
      read: false,
      write: false
    })
  })

  test("小程序业务代码不绕过云函数直接访问数据库", () => {
    const clientRoots = ["pages", "components", "shared"]
    const javascriptFiles = []
    const walk = (directory) => {
      fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
        const fullPath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          walk(fullPath)
        } else if (entry.isFile() && entry.name.endsWith(".js")) {
          javascriptFiles.push(fullPath)
        }
      })
    }
    clientRoots.forEach((root) => walk(path.join(PROJECT_ROOT, root)))

    const directDatabaseAccess = javascriptFiles.filter((filePath) =>
      /\b(?:wx\.)?cloud\.database\s*\(/.test(fs.readFileSync(filePath, "utf8"))
    )
    expect(directDatabaseAccess).toEqual([])
  })

  test("云存储仅开放车辆图片且限制登录身份、归属和大小", () => {
    const manifest = readJson("manifest.json")
    const storageRule = readJson(manifest.storage.ruleFile)

    expect(storageRule.read).toContain("vehicle-images")
    expect(storageRule.write).toContain("auth != null")
    expect(storageRule.write).toContain("auth.loginType != 'ANONYMOUS'")
    expect(storageRule.write).toContain("resource.openid == auth.openid")
    expect(storageRule.write).toContain("resource.size <= 10485760")
    expect(storageRule.write).toContain("/\\.jpg$/")
    expect(storageRule.write).toContain("/\\.jpeg$/")
    expect(storageRule.write).toContain("/\\.png$/")
    expect(storageRule.write).toContain("/\\.webp$/")
    expect(storageRule.write).not.toContain("(?:")
    expect(storageRule.write).not.toContain("$/i")
    expect(manifest.storage).toMatchObject({
      publicReadPrefix: "vehicle-images/",
      maxUploadBytes: 10485760,
      allowedImageExtensions: ["jpg", "jpeg", "png", "webp"]
    })
  })

  test("云函数规则默认拒绝未登录和匿名调用", () => {
    const manifest = readJson("manifest.json")
    const functionRule = readJson(manifest.functions.ruleFile)

    expect(functionRule).toEqual({
      "*": {
        invoke: "auth.loginType != 'ANONYMOUS' && auth != null"
      }
    })
    expect(manifest.functions.requiresAuthenticatedNonAnonymousUser).toBe(true)
  })

  test("安全规则、测试和开发文档不会进入小程序上传包", () => {
    const projectConfig = JSON.parse(
      fs.readFileSync(path.join(PROJECT_ROOT, "project.config.json"), "utf8")
    )
    const ignored = new Set(
      (projectConfig.packOptions && projectConfig.packOptions.ignore
        ? projectConfig.packOptions.ignore
        : []
      ).map((item) => `${item.type}:${item.value}`)
    )
    const requiredIgnores = [
      "folder:__tests__",
      "folder:security-rules",
      "folder:jijing_garage_project_docs_v2",
      "folder:node_modules",
      "file:README.md",
      "file:DEPLOY_CHECKLIST.md",
      "file:cloudbaserc.json",
      "file:jest.config.js",
      "file:package.json",
      "file:package-lock.json",
      "file:.trae_preview_info.json",
      "file:.trae_preview.txt",
      "file:.trae_preview.jpg",
      "folder:assets/cars",
      "file:data/cars.js",
      "file:ganlan_garage_project_docs_v2.zip",
      "file:vehicleImageUpdate.zip"
    ]
    requiredIgnores.forEach((entry) => {
      expect(ignored.has(entry)).toBe(true)
    })
  })
})
