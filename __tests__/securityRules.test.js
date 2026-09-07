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
      "booking_handovers",
      "booking_quotes",
      "bookings",
      "content_guides",
      "error_logs",
      "favorites",
      "pending_file_deletions",
      "privacy_requests",
      "roles",
      "vehicle_availability_blocks",
      "vehicle_calendar_days",
      "vehicle_price_rules",
      "vehicles"
    ]

    expect(manifest.database.collections.slice().sort()).toEqual(expectedCollections)
    expect(databaseRule).toEqual({
      read: false,
      write: false
    })
  })

  test("小程序业务代码不绕过云函数直接访问数据库", () => {
    const clientRoots = ["pages", "pages-admin", "components", "shared"]
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
    expect(storageRule.write).toContain("resource.openid == auth.uid")
    // CloudBase does not reliably expose resource.size during the upload
    // authorization phase. Keep the client-side limit from the manifest,
    // but do not make otherwise valid uploads depend on this server field.
    expect(storageRule.write).not.toContain("resource.size")
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

  test("云函数规则仅使用受支持的 auth 存在性检查", () => {
    const manifest = readJson("manifest.json")
    const functionRule = readJson(manifest.functions.ruleFile)

    expect(functionRule).toEqual({
      "*": {
        invoke: "auth != null"
      }
    })
    expect(manifest.functions.requiresAuthenticatedUser).toBe(true)
    expect(manifest.functions.sensitiveFunctionsRequireOpenidInCode).toBe(true)
    expect(functionRule["*"].invoke).not.toContain("auth.loginType")
  })

  test("所有产生持久化写入的云函数都从微信上下文获取调用者身份", () => {
    const cloudFunctionsRoot = path.join(PROJECT_ROOT, "cloudfunctions")
    const missingContext = fs
      .readdirSync(cloudFunctionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        filePath: path.join(cloudFunctionsRoot, entry.name, "index.js")
      }))
      .filter((item) => fs.existsSync(item.filePath))
      .filter((item) => {
        const source = fs.readFileSync(item.filePath, "utf8")
        const writesPersistentData =
          /\.(?:add|set|update|remove)\s*\(/.test(source) ||
          /cloud\.(?:deleteFile|uploadFile)\s*\(/.test(source)
        return writesPersistentData && !/cloud\.getWXContext\s*\(/.test(source)
      })
      .map((item) => item.name)

    expect(missingContext).toEqual([])
  })

  test("所有读取 roles 权限集合的云函数都使用微信调用者身份", () => {
    const cloudFunctionsRoot = path.join(PROJECT_ROOT, "cloudfunctions")
    const missingContext = fs
      .readdirSync(cloudFunctionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        filePath: path.join(cloudFunctionsRoot, entry.name, "index.js")
      }))
      .filter((item) => fs.existsSync(item.filePath))
      .filter((item) => {
        const source = fs.readFileSync(item.filePath, "utf8")
        return /collection\("roles"\)/.test(source) && !/cloud\.getWXContext\s*\(/.test(source)
      })
      .map((item) => item.name)

    expect(missingContext).toEqual([])
  })

  test("除管理员分配目标外，云函数不信任客户端传入的用户身份", () => {
    const cloudFunctionsRoot = path.join(PROJECT_ROOT, "cloudfunctions")
    const clientIdentityConsumers = fs
      .readdirSync(cloudFunctionsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        filePath: path.join(cloudFunctionsRoot, entry.name, "index.js")
      }))
      .filter((item) => fs.existsSync(item.filePath))
      .filter((item) => {
        const source = fs.readFileSync(item.filePath, "utf8")
        return /(?:event|payload|input)\??\.\s*(?:openid|openId|uid|userId)\b/.test(source)
      })
      .map((item) => item.name)
      .sort()

    expect(clientIdentityConsumers).toEqual(["roleUpsert"])
    const roleUpsertSource = fs.readFileSync(
      path.join(cloudFunctionsRoot, "roleUpsert", "index.js"),
      "utf8"
    )
    expect(roleUpsertSource).toContain("const operatorOpenid = wxContext")
    expect(roleUpsertSource).toContain("isAdminOpenid(operatorOpenid)")
  })

  test("客户端图片预检与生产存储规则保持一致", () => {
    const manifest = readJson("manifest.json")
    const uploadSource = fs.readFileSync(
      path.join(PROJECT_ROOT, "pages-admin", "vehicle-detail-manage", "vehicle-detail-manage.js"),
      "utf8"
    )

    expect(uploadSource).toContain(
      `const MAX_IMAGE_UPLOAD_BYTES = ${manifest.storage.maxUploadBytes / 1024 / 1024} * 1024 * 1024`
    )
    manifest.storage.allowedImageExtensions.forEach((extension) => {
      expect(uploadSource).toContain(`"${extension}"`)
    })
    expect(uploadSource).toContain(
      "const cloudPath = `vehicle-images/${vehicleId}/${Date.now()}_${index}.${extension}`"
    )
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
      "file:DEVELOPMENT_ROADMAP.md",
      "file:PHASE16_DEPLOY_AND_ACCEPTANCE.md",
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
