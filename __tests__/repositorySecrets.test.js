const fs = require("fs")
const path = require("path")
const {
  findContentViolations,
  scanRepository
} = require("../scripts/checkRepositorySecrets")

const PROJECT_ROOT = path.resolve(__dirname, "..")

describe("repository secret hygiene", () => {
  test("仓库不包含敏感文件、私钥或硬编码生产凭据", () => {
    expect(scanRepository(PROJECT_ROOT).violations).toEqual([])
  })

  test("密钥扫描能识别私钥和硬编码配置", () => {
    const source = [
      "const config = { appSecret: \"0123456789abcdef0123456789abcdef\" }",
      "-----BEGIN PRIVATE KEY-----"
    ].join("\n")

    expect(findContentViolations(source, "unsafe.js")).toEqual([
      {
        path: "unsafe.js",
        reason: "包含私钥正文"
      },
      {
        path: "unsafe.js",
        reason: "疑似硬编码敏感配置：appSecret"
      }
    ])
  })

  test("本地敏感文件类型已加入忽略清单", () => {
    const gitignore = fs.readFileSync(
      path.join(PROJECT_ROOT, ".gitignore"),
      "utf8"
    )

    expect(gitignore).toContain(".env")
    expect(gitignore).toContain(".env.*")
    expect(gitignore).toContain("*.pem")
    expect(gitignore).toContain("*.key")
    expect(gitignore).toContain("*.p12")
    expect(gitignore).toContain("*.pfx")
  })
})
