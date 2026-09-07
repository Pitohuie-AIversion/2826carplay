const fs = require("fs")
const path = require("path")

const HARD_LIMIT_BYTES = 2 * 1024 * 1024
const WARNING_LIMIT_BYTES = Math.floor(1.75 * 1024 * 1024)
const TOOLING_FILES = new Set([
  ".gitignore",
  "project.config.json",
  "project.private.config.json"
])
const TOOLING_DIRECTORIES = new Set([".git", ".codex", ".agents", ".trae"])

function normalizeRelativePath(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "")
}

function readProjectConfig(projectRoot) {
  return JSON.parse(
    fs.readFileSync(path.join(projectRoot, "project.config.json"), "utf8")
  )
}

function buildIgnoreState(projectRoot, projectConfig) {
  const ignoredFiles = new Set(TOOLING_FILES)
  const ignoredDirectories = new Set(TOOLING_DIRECTORIES)
  const configuredIgnores =
    projectConfig &&
    projectConfig.packOptions &&
    Array.isArray(projectConfig.packOptions.ignore)
      ? projectConfig.packOptions.ignore
      : []

  configuredIgnores.forEach((item) => {
    const value = normalizeRelativePath(item && item.value)
    if (!value) {
      return
    }
    if (item.type === "folder") {
      ignoredDirectories.add(value)
    } else if (item.type === "file") {
      ignoredFiles.add(value)
    }
  })

  const cloudfunctionRoot = normalizeRelativePath(
    projectConfig && projectConfig.cloudfunctionRoot
  )
  if (cloudfunctionRoot) {
    ignoredDirectories.add(cloudfunctionRoot)
  }

  return {
    projectRoot,
    ignoredFiles,
    ignoredDirectories
  }
}

function shouldIgnore(relativePath, isDirectory, ignoreState) {
  const normalized = normalizeRelativePath(relativePath)
  if (!normalized) {
    return false
  }
  if (isDirectory) {
    return Array.from(ignoreState.ignoredDirectories).some(
      (directory) => normalized === directory || normalized.startsWith(`${directory}/`)
    )
  }
  if (ignoreState.ignoredFiles.has(normalized)) {
    return true
  }
  return Array.from(ignoreState.ignoredDirectories).some((directory) =>
    normalized.startsWith(`${directory}/`)
  )
}

function calculatePackageFootprint(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot)
  const projectConfig = readProjectConfig(resolvedRoot)
  const ignoreState = buildIgnoreState(resolvedRoot, projectConfig)
  const files = []

  const walk = (directory) => {
    fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
      const absolutePath = path.join(directory, entry.name)
      const relativePath = normalizeRelativePath(path.relative(resolvedRoot, absolutePath))
      if (shouldIgnore(relativePath, entry.isDirectory(), ignoreState)) {
        return
      }
      if (entry.isDirectory()) {
        walk(absolutePath)
        return
      }
      if (!entry.isFile()) {
        return
      }
      files.push({
        path: relativePath,
        bytes: fs.statSync(absolutePath).size
      })
    })
  }

  walk(resolvedRoot)
  files.sort((left, right) => right.bytes - left.bytes)
  const totalBytes = files.reduce((sum, item) => sum + item.bytes, 0)

  return {
    totalBytes,
    fileCount: files.length,
    remainingBytes: HARD_LIMIT_BYTES - totalBytes,
    hardLimitBytes: HARD_LIMIT_BYTES,
    warningLimitBytes: WARNING_LIMIT_BYTES,
    status:
      totalBytes >= HARD_LIMIT_BYTES
        ? "fail"
        : totalBytes >= WARNING_LIMIT_BYTES
          ? "warning"
          : "pass",
    largestFiles: files.slice(0, 10),
    files
  }
}

function formatMiB(bytes) {
  return `${(Number(bytes || 0) / 1024 / 1024).toFixed(2)} MiB`
}

function runCli() {
  const projectRoot = path.resolve(__dirname, "..")
  const result = calculatePackageFootprint(projectRoot)
  const summary = [
    `估算主包：${formatMiB(result.totalBytes)}`,
    `文件数量：${result.fileCount}`,
    `2 MiB 余量：${formatMiB(Math.max(0, result.remainingBytes))}`,
    `状态：${result.status}`
  ]
  process.stdout.write(`${summary.join("\n")}\n`)
  process.stdout.write("最大文件：\n")
  result.largestFiles.forEach((item) => {
    process.stdout.write(`- ${formatMiB(item.bytes)}  ${item.path}\n`)
  })
  if (result.status === "warning") {
    process.stderr.write("主包已超过 1.75 MiB 预警线，请压缩资源或规划分包。\n")
  }
  if (result.status === "fail") {
    process.stderr.write("主包估算已达到 2 MiB 阻断线，不能继续上传。\n")
    process.exitCode = 1
  }
}

if (require.main === module) {
  runCli()
}

module.exports = {
  HARD_LIMIT_BYTES,
  WARNING_LIMIT_BYTES,
  calculatePackageFootprint,
  formatMiB,
  normalizeRelativePath,
  shouldIgnore
}
