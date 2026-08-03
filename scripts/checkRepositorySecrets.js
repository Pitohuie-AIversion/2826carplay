const fs = require("fs")
const path = require("path")

const IGNORED_DIRECTORIES = new Set([
  ".git",
  "node_modules",
  "miniprogram_npm",
  "log"
])
const TEXT_EXTENSIONS = new Set([
  "",
  ".js",
  ".json",
  ".md",
  ".txt",
  ".wxml",
  ".wxss",
  ".ts",
  ".yaml",
  ".yml"
])
const SENSITIVE_FILE_PATTERN = /(^|\/)\.env(?:\.|$)|\.(?:pem|key|p12|pfx)$/i
const PRIVATE_KEY_PATTERN = /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/
const SECRET_ASSIGNMENT_PATTERN =
  /["']?(appsecret|app_secret|secretkey|secret_key|private_key|apikey|api_key|access_token|bootstrap_token)["']?\s*[:=]\s*["']([^"'\r\n]+)["']/gi
const PLACEHOLDER_PATTERN =
  /(?:example|sample|dummy|test|placeholder|replace|your[_-]|change[_-]?me|not[_-]?a[_-]?secret)/i

function normalizeRelativePath(value) {
  return String(value || "").replace(/\\/g, "/")
}

function shouldInspectContent(relativePath) {
  const normalized = normalizeRelativePath(relativePath)
  if (
    normalized.startsWith("__tests__/") ||
    normalized === "scripts/checkRepositorySecrets.js"
  ) {
    return false
  }
  return TEXT_EXTENSIONS.has(path.extname(normalized).toLowerCase())
}

function findContentViolations(source, relativePath) {
  const violations = []
  if (PRIVATE_KEY_PATTERN.test(source)) {
    violations.push({
      path: relativePath,
      reason: "包含私钥正文"
    })
  }

  SECRET_ASSIGNMENT_PATTERN.lastIndex = 0
  let match = SECRET_ASSIGNMENT_PATTERN.exec(source)
  while (match) {
    const value = String(match[2] || "").trim()
    if (value && !PLACEHOLDER_PATTERN.test(value)) {
      violations.push({
        path: relativePath,
        reason: `疑似硬编码敏感配置：${match[1]}`
      })
    }
    match = SECRET_ASSIGNMENT_PATTERN.exec(source)
  }
  return violations
}

function scanRepository(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot)
  const violations = []

  const walk = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) {
        return
      }

      const absolutePath = path.join(directory, entry.name)
      const relativePath = normalizeRelativePath(
        path.relative(resolvedRoot, absolutePath)
      )

      if (entry.isDirectory()) {
        walk(absolutePath)
        return
      }
      if (!entry.isFile()) {
        return
      }

      if (
        SENSITIVE_FILE_PATTERN.test(relativePath) &&
        relativePath !== ".env.example"
      ) {
        violations.push({
          path: relativePath,
          reason: "敏感文件不应进入仓库"
        })
        return
      }

      if (!shouldInspectContent(relativePath)) {
        return
      }

      const source = fs.readFileSync(absolutePath, "utf8")
      violations.push(...findContentViolations(source, relativePath))
    })
  }

  walk(resolvedRoot)
  return { violations }
}

function runCli() {
  const projectRoot = path.resolve(__dirname, "..")
  const result = scanRepository(projectRoot)
  if (result.violations.length === 0) {
    process.stdout.write("密钥扫描通过：未发现私钥、环境文件或硬编码生产凭据。\n")
    return
  }

  process.stderr.write("密钥扫描未通过：\n")
  result.violations.forEach((item) => {
    process.stderr.write(`- ${item.path}：${item.reason}\n`)
  })
  process.exitCode = 1
}

if (require.main === module) {
  runCli()
}

module.exports = {
  findContentViolations,
  scanRepository,
  shouldInspectContent
}
