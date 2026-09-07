const fs = require("fs")
const path = require("path")

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/^\.?\//, "")
}

function readJson(projectRoot, relativePath, violations) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(projectRoot, relativePath), "utf8")
    )
  } catch (error) {
    violations.push({
      type: "invalid_json",
      path: relativePath,
      message: `JSON 无法读取：${error.message}`
    })
    return null
  }
}

function findDuplicates(values) {
  const seen = new Set()
  const duplicates = new Set()
  values.forEach((value) => {
    if (seen.has(value)) {
      duplicates.add(value)
    }
    seen.add(value)
  })
  return Array.from(duplicates).sort()
}

function collectPageRoutes(projectRoot, extraRootDirs) {
  const routes = []
  const rootDirs = ["pages"].concat(Array.isArray(extraRootDirs) ? extraRootDirs : [])
  rootDirs.forEach((dirName) => {
    const pagesRoot = path.join(projectRoot, dirName)
    if (!fs.existsSync(pagesRoot)) {
      return
    }
    const walk = (directory) => {
      fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
        const absolutePath = path.join(directory, entry.name)
        if (entry.isDirectory()) {
          walk(absolutePath)
        } else if (entry.isFile() && entry.name.endsWith(".wxml")) {
          routes.push(
            normalizePath(
              path.relative(projectRoot, absolutePath).replace(/\.wxml$/, "")
            )
          )
        }
      })
    }
    walk(pagesRoot)
  })
  return routes.sort()
}

function collectCloudFunctionNames(projectRoot, functionRoot) {
  const absoluteRoot = path.resolve(projectRoot, functionRoot || "cloudfunctions")
  if (!fs.existsSync(absoluteRoot)) {
    return []
  }
  return fs
    .readdirSync(absoluteRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(absoluteRoot, entry.name, "index.js"))
    )
    .map((entry) => entry.name)
    .sort()
}

function checkProjectStructure(projectRoot) {
  const resolvedRoot = path.resolve(projectRoot)
  const violations = []
  const appConfig = readJson(resolvedRoot, "app.json", violations)
  const cloudbaseConfig = readJson(resolvedRoot, "cloudbaserc.json", violations)
  const declaredPages =
    appConfig && Array.isArray(appConfig.pages)
      ? appConfig.pages.map(normalizePath)
      : []
  const subRoots = []
  if (appConfig && Array.isArray(appConfig.subPackages)) {
    appConfig.subPackages.forEach((sub) => {
      const root = normalizePath((sub && sub.root) || "")
      if (!root) return
      subRoots.push(root)
      if (Array.isArray(sub.pages)) {
        sub.pages.forEach((p) => declaredPages.push(normalizePath(`${root}/${p}`)))
      }
    })
  }
  const discoveredPages = collectPageRoutes(resolvedRoot, subRoots)

  if (appConfig && !Array.isArray(appConfig.pages)) {
    violations.push({
      type: "invalid_pages",
      path: "app.json",
      message: "pages 必须是数组"
    })
  }

  findDuplicates(declaredPages).forEach((route) => {
    violations.push({
      type: "duplicate_page",
      path: route,
      message: "app.json 存在重复页面路由"
    })
  })

  declaredPages.forEach((route) => {
    const requiredExtensions = ["js", "wxml", "wxss"]
    requiredExtensions.forEach((extension) => {
      const relativePath = `${route}.${extension}`
      if (!fs.existsSync(path.join(resolvedRoot, relativePath))) {
        violations.push({
          type: "missing_page_file",
          path: relativePath,
          message: "页面声明缺少必要文件"
        })
      }
    })
  })

  discoveredPages
    .filter((route) => !declaredPages.includes(route))
    .forEach((route) => {
      violations.push({
        type: "undeclared_page",
        path: route,
        message: "页面目录存在，但未在 app.json 中声明"
      })
    })

  const configuredFunctions =
    cloudbaseConfig && Array.isArray(cloudbaseConfig.functions)
      ? cloudbaseConfig.functions
          .map((item) => String((item && item.name) || "").trim())
          .filter(Boolean)
      : []
  const functionRoot = normalizePath(
    (cloudbaseConfig && cloudbaseConfig.functionRoot) || "cloudfunctions"
  )
  const discoveredFunctions = collectCloudFunctionNames(
    resolvedRoot,
    functionRoot
  )

  if (cloudbaseConfig && !Array.isArray(cloudbaseConfig.functions)) {
    violations.push({
      type: "invalid_functions",
      path: "cloudbaserc.json",
      message: "functions 必须是数组"
    })
  }

  findDuplicates(configuredFunctions).forEach((name) => {
    violations.push({
      type: "duplicate_function",
      path: name,
      message: "cloudbaserc.json 存在重复云函数"
    })
  })

  if (cloudbaseConfig && Array.isArray(cloudbaseConfig.functions)) {
    cloudbaseConfig.functions.forEach((item) => {
      if (!item || item.installDependency !== true) {
        return
      }
      const ignored = Array.isArray(item.ignore)
        ? item.ignore.map((value) => String(value || "").replace(/\\/g, "/"))
        : [String(item.ignore || "").replace(/\\/g, "/")]
      const ignoresNodeModules = ignored.some(
        (value) => value === "node_modules" || value.startsWith("node_modules/")
      )
      if (!ignoresNodeModules) {
        violations.push({
          type: "unsafe_function_package",
          path: `${functionRoot}/${String(item.name || "").trim()}`,
          message: "启用云端安装依赖时必须排除本地 node_modules"
        })
      }
    })
  }

  configuredFunctions
    .filter((name) => !discoveredFunctions.includes(name))
    .forEach((name) => {
      violations.push({
        type: "missing_function",
        path: `${functionRoot}/${name}`,
        message: "部署清单中的云函数目录或 index.js 不存在"
      })
    })

  discoveredFunctions
    .filter((name) => !configuredFunctions.includes(name))
    .forEach((name) => {
      violations.push({
        type: "undeclared_function",
        path: `${functionRoot}/${name}`,
        message: "云函数目录存在，但未加入 cloudbaserc.json"
      })
    })

  return {
    ok: violations.length === 0,
    pageCount: declaredPages.length,
    functionCount: configuredFunctions.length,
    violations
  }
}

function runCli() {
  const projectRoot = path.resolve(__dirname, "..")
  const result = checkProjectStructure(projectRoot)
  if (result.ok) {
    process.stdout.write(
      `结构检查通过：${result.pageCount} 个页面，${result.functionCount} 个云函数。\n`
    )
    return
  }
  process.stderr.write(`结构检查失败：发现 ${result.violations.length} 项问题。\n`)
  result.violations.forEach((item) => {
    process.stderr.write(`- ${item.path}：${item.message}\n`)
  })
  process.exitCode = 1
}

if (require.main === module) {
  runCli()
}

module.exports = {
  checkProjectStructure,
  collectCloudFunctionNames,
  collectPageRoutes,
  findDuplicates,
  normalizePath
}
